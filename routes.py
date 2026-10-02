import os
import io
import json
import base64
import time
import uuid
import asyncio
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal, Optional

from PIL import Image, ImageOps, UnidentifiedImageError

from fastapi import FastAPI, APIRouter, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, inspect, text as sql_text

from mesh_service import ReconstructionService, local_configuration
from mesh_formats import export_model


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

DATA_DIR = Path(os.environ.get("STUDIO_DATA_DIR", Path(__file__).resolve().parent / ".data")).resolve()
DB_URL = os.environ.get("DBD8870D13_DATABASE_URL") or os.environ.get("DATABASE_URL") or f"sqlite:///{DATA_DIR / 'studio.sqlite'}"

@lru_cache(maxsize=1)
def get_engine():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    options = {"check_same_thread": False} if DB_URL.startswith("sqlite:") else {}
    return create_engine(DB_URL, pool_pre_ping=True, connect_args=options)

def init_db():
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT 'Untitled',
                prompt TEXT,
                negative_prompt TEXT,
                settings_json TEXT NOT NULL DEFAULT '{}',
                image_data_url TEXT,
                mesh_params_json TEXT,
                glb_available INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """))
        conn.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                action TEXT NOT NULL,
                prompt TEXT,
                image_data_url TEXT,
                settings_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """))
        conn.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            )
        """))
    if "glb_id" not in {column["name"] for column in inspect(engine).get_columns("projects")}:
        with engine.begin() as conn:
            conn.execute(sql_text("ALTER TABLE projects ADD COLUMN glb_id TEXT"))



# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------

def get_gemini_client():
    api_key = os.environ.get("GEMINI_WORKSHOP_API_KEY")
    base_url = os.environ.get("GEMINI_WORKSHOP_BASE_URL")
    if not api_key or not base_url:
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        base_url = os.environ.get("GEMINI_BASE_URL")
        if not api_key:
            return None
    return configured_gemini_client(api_key, base_url)

@lru_cache(maxsize=4)
def configured_gemini_client(api_key: str, base_url: Optional[str]):
    from google import genai
    options = {"api_version": "v1alpha" if base_url else "v1beta", "timeout": 120_000}
    if base_url:
        options["base_url"] = base_url
    return genai.Client(api_key=api_key, http_options=options)

def provider_error(error: Exception) -> HTTPException:
    # Never send provider exception text (which may contain credentials) to the browser.
    status = getattr(error, "code", None)
    if status in (401, 403):
        return HTTPException(503, "The image provider rejected its credentials. Update the server's API key or Workshop connection.")
    if status == 429:
        return HTTPException(429, "The image provider's quota is exhausted. Your image and prompt are unchanged; retry after the quota resets or use a local backend.")
    if status == 404:
        return HTTPException(502, "The selected model is unavailable. Choose an image model supported by your provider.")
    return HTTPException(502, "The generation provider failed or timed out. Your image and prompt are unchanged.")

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000

def normalize_image(raw: bytes) -> tuple[bytes, Image.Image]:
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "File too large (max 20 MB).")
    try:
        image = Image.open(io.BytesIO(raw))
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise HTTPException(400, "Image is too large (max 25 million pixels).")
        image.load()
        image = ImageOps.exif_transpose(image).convert("RGBA")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        if buffer.tell() > MAX_IMAGE_BYTES:
            raise HTTPException(400, "Decoded image is too large (max 20 MB).")
        return buffer.getvalue(), image
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(400, "Upload a valid PNG, JPEG, or WebP image.") from None

def decode_image(data_url: str) -> tuple[bytes, Image.Image]:
    if len(data_url) > MAX_IMAGE_BYTES * 4 // 3 + 256:
        raise HTTPException(400, "Image too large (max 20 MB).")
    try:
        header, encoded = data_url.split(",", 1)
        if header not in ("data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"):
            raise ValueError()
        return normalize_image(base64.b64decode(encoded, validate=True))
    except (ValueError, base64.binascii.Error):
        raise HTTPException(400, "Provide a valid PNG, JPEG, or WebP data URL.") from None


# ---------------------------------------------------------------------------
# Safety / content moderation
# ---------------------------------------------------------------------------

BLOCKED_PATTERNS = [
    "minor", "child", "underage", "loli", "shota", "kid", "baby",
    "toddler", "preteen", "teenager under 18",
    "deepfake", "real person", "celebrity", "nonconsensual",
    "non-consensual", "revenge porn",
]

def check_safety(prompt: str) -> tuple[bool, str]:
    """Return (is_safe, reason). Blocks minors, deepfakes, nonconsensual content."""
    lower = prompt.lower()
    for pattern in BLOCKED_PATTERNS:
        if pattern in lower:
            return False, f"Blocked: prompt contains prohibited term '{pattern}'. This app blocks minors, age-ambiguous subjects, nonconsensual imagery, and real-person deepfakes."
    return True, ""


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    negative_prompt: str = ""
    model: str = "gemini-3.1-flash-image"
    backend: Literal["gemini", "automatic1111", "local-stable-diffusion"] = "gemini"
    width: int = Field(1024, ge=256, le=2048, multiple_of=64)
    height: int = Field(1024, ge=256, le=2048, multiple_of=64)
    reference_image: Optional[str] = None  # data URL

class GenerateResponse(BaseModel):
    image: str  # data URL
    prompt: str
    elapsed_ms: int

class MeshRequest(BaseModel):
    image: str  # data URL
    mesh_quality: Literal["draft", "balanced", "high"] = "balanced"
    mesh_device: Literal["auto", "cpu", "cuda"] = "auto"
    bake_texture: bool = False
    texture_resolution: int = Field(1024, ge=256, le=2048, multiple_of=256)

class MeshResponse(BaseModel):
    glb_available: bool
    vertices: int
    faces: int
    elapsed_ms: int

class ProjectSave(BaseModel):
    id: Optional[str] = None
    name: str = "Untitled"
    prompt: str = ""
    negative_prompt: str = ""
    settings_json: str = "{}"
    image_data_url: Optional[str] = None
    mesh_params_json: Optional[str] = None
    glb_id: Optional[str] = None

class ProjectRecord(BaseModel):
    id: str
    name: str
    prompt: str
    negative_prompt: str
    settings_json: str
    image_data_url: Optional[str] = None
    mesh_params_json: Optional[str] = None
    glb_available: bool
    created_at: str
    updated_at: str

class SettingsUpdate(BaseModel):
    backend: Literal["gemini", "automatic1111", "local-stable-diffusion"] = "gemini"
    model: str = "gemini-3.1-flash-image"
    subdivisions: int = 128
    height_scale: float = 0.3
    smooth: bool = True
    allow_adult_art: bool = True
    safety_mode: str = "standard"
    mesh_quality: Literal["draft", "balanced", "high"] = "balanced"
    mesh_device: Literal["auto", "cpu", "cuda"] = "auto"
    bake_texture: bool = False
    texture_resolution: int = Field(1024, ge=256, le=2048, multiple_of=256)

class ChatRequest(BaseModel):
    message: str
    context: str = ""

class ChatResponse(BaseModel):
    reply: str
    elapsed_ms: int


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app(static_dir: str) -> FastAPI:
    api = APIRouter()
    service = ReconstructionService(DATA_DIR)

    # -- Configuration status --
    @api.get("/health")
    def health():
        with get_engine().connect() as conn:
            conn.execute(sql_text("SELECT 1"))
        config = local_configuration()
        return {"ok": True, "db": True, "gemini": get_gemini_client() is not None,
                "image_backends": {"gemini": get_gemini_client() is not None,
                                   "automatic1111": bool(os.environ.get("SD_WEBUI_URL"))},
                "mesh": {"ready": config["ready"], "method": "triposr", "missing": config["missing"]}}

    # -- Image generation --
    @api.post("/generate")
    async def generate(req: GenerateRequest):
        safe, reason = check_safety(req.prompt)
        if not safe:
            raise HTTPException(400, reason)
        reference = decode_image(req.reference_image)[1] if req.reference_image else None
        started = time.monotonic()
        if req.backend in ("automatic1111", "local-stable-diffusion"):
            import httpx
            url = os.environ.get("SD_WEBUI_URL", "").rstrip("/")
            if not url:
                raise HTTPException(503, "Local image generation is not configured. Set SD_WEBUI_URL and start your Stable Diffusion server with --api.")
            payload = {"prompt": req.prompt, "negative_prompt": req.negative_prompt,
                       "width": req.width, "height": req.height, "steps": 20, "batch_size": 1}
            operation = "txt2img"
            if req.reference_image:
                payload.update(init_images=[req.reference_image.split(",", 1)[1]], denoising_strength=0.45)
                operation = "img2img"
            if req.model and not req.model.startswith("gemini-"):
                payload["override_settings"] = {"sd_model_checkpoint": req.model}
                payload["override_settings_restore_afterwards"] = True
            try:
                async with httpx.AsyncClient(timeout=300) as http:
                    response = await http.post(f"{url}/sdapi/v1/{operation}", json=payload)
                    response.raise_for_status()
                images = response.json().get("images") or []
                if not images:
                    raise ValueError("No image returned")
                encoded = images[0].split(",", 1)[-1]
                raw, _ = normalize_image(base64.b64decode(encoded, validate=True))
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(502, "Local image generation failed. Check that the Stable Diffusion API is running; your image and prompt are unchanged.") from None
        else:
            client = get_gemini_client()
            if client is None:
                raise HTTPException(503, "Gemini is not configured. Reconnect Gemini in Workshop, or set GEMINI_API_KEY on the server. You can still import an image and use the local 3D engine.")
            from google.genai import types
            prompt = req.prompt
            if req.negative_prompt:
                prompt += f"\nAvoid the following: {req.negative_prompt}"
            contents = [reference, prompt] if reference else [prompt]
            ratio = req.width / req.height
            supported = [(1.0, "1:1"), (2/3, "2:3"), (3/2, "3:2"), (3/4, "3:4"), (4/3, "4:3"), (9/16, "9:16"), (16/9, "16:9")]
            aspect = min(supported, key=lambda item: abs(item[0] - ratio))[1]
            try:
                response = await client.aio.models.generate_content(
                    model=req.model, contents=contents,
                    config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"],
                                                       image_config=types.ImageConfig(aspect_ratio=aspect)),
                )
                raw = None
                for part in response.parts or []:
                    if part.inline_data is not None and (part.inline_data.mime_type or "").startswith("image/"):
                        data = part.inline_data.data
                        raw, _ = normalize_image(data if isinstance(data, bytes) else base64.b64decode(data, validate=True))
                        break
            except HTTPException:
                raise
            except Exception as error:
                raise provider_error(error) from None
            if raw is None:
                raise HTTPException(502, "The provider returned no image. Its content rules or model limitations may apply; your original image and prompt are unchanged.")
        data_url = "data:image/png;base64," + base64.b64encode(raw).decode()
        return GenerateResponse(image=data_url, prompt=req.prompt, elapsed_ms=int((time.monotonic() - started) * 1000))

    # -- Actual image-to-3D reconstruction jobs --
    @api.post("/mesh", status_code=202)
    async def create_mesh(req: MeshRequest):
        raw, _ = decode_image(req.image)
        try:
            return service.start(raw, req.model_dump(exclude={"image"}))
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from None

    @api.get("/mesh/{job_id}")
    async def mesh_status(job_id: str):
        try:
            return service.get(job_id)
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, "Reconstruction job not found.") from None

    @api.get("/mesh/{job_id}/image")
    async def mesh_image(job_id: str):
        try:
            path = service.directory(job_id) / "input.png"
            if not path.is_file():
                raise FileNotFoundError()
            return FileResponse(path, media_type="image/png")
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, "Source image not found.") from None

    @api.get("/glb/{glb_id}")
    async def download_glb(glb_id: str):
        try:
            path = service.model_path(glb_id)
            if not path.is_file():
                raise FileNotFoundError()
            return FileResponse(path, media_type="model/gltf-binary", filename="textured_model.glb")
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, "Model not found.") from None

    @api.get("/export/{glb_id}/{file_format}")
    async def export_mesh(glb_id: str, file_format: Literal["glb", "gltf", "stl", "obj"]):
        try:
            data = await asyncio.to_thread(service.model_path(glb_id).read_bytes)
            result, mime, filename = await asyncio.to_thread(export_model, data, file_format)
            return StreamingResponse(io.BytesIO(result), media_type=mime,
                                     headers={"Content-Disposition": f"attachment; filename={filename}"})
        except FileNotFoundError:
            raise HTTPException(404, "Model not found.") from None
        except ValueError as error:
            raise HTTPException(400, str(error)) from None

    # -- Project CRUD --
    @api.get("/projects")
    async def list_projects():
        engine = get_engine()
        if not engine:
            return []
        with engine.connect() as conn:
            rows = conn.execute(sql_text(
                "SELECT id, name, prompt, negative_prompt, settings_json, image_data_url, mesh_params_json, glb_available, created_at, updated_at, glb_id FROM projects ORDER BY updated_at DESC"
            )).fetchall()
        return [
            {
                "id": r[0], "name": r[1], "prompt": r[2], "negative_prompt": r[3],
                "settings_json": r[4], "image_data_url": r[5], "mesh_params_json": r[6],
                "glb_available": bool(r[10] and service.model_path(r[10]).is_file()), "created_at": r[8], "updated_at": r[9], "glb_id": r[10],
            }
            for r in rows
        ]

    @api.post("/projects")
    async def save_project(req: ProjectSave):
        engine = get_engine()
        if not engine:
            raise HTTPException(503, "Database not configured.")
        try:
            json.loads(req.settings_json)
            if req.mesh_params_json:
                json.loads(req.mesh_params_json)
        except ValueError:
            raise HTTPException(400, "Project settings must contain valid JSON.") from None
        if req.glb_id:
            try:
                if not service.model_path(req.glb_id).is_file():
                    raise ValueError()
            except ValueError:
                raise HTTPException(400, "The project's model does not exist.") from None
        now = datetime.now(timezone.utc).isoformat()
        pid = req.id or str(uuid.uuid4())
        with engine.begin() as conn:
            existing = conn.execute(sql_text("SELECT id FROM projects WHERE id = :id"), {"id": pid}).fetchone()
            if existing:
                conn.execute(sql_text("""
                    UPDATE projects SET name=:name, prompt=:prompt, negative_prompt=:np,
                    settings_json=:sj, image_data_url=:img, mesh_params_json=:mp, glb_id=:glb, glb_available=:available, updated_at=:ts
                    WHERE id=:id
                """), {"name": req.name, "prompt": req.prompt, "np": req.negative_prompt,
                       "sj": req.settings_json, "img": req.image_data_url, "mp": req.mesh_params_json,
                       "ts": now, "id": pid, "glb": req.glb_id, "available": int(bool(req.glb_id))})
            else:
                conn.execute(sql_text("""
                    INSERT INTO projects (id, name, prompt, negative_prompt, settings_json, image_data_url, mesh_params_json, glb_available, created_at, updated_at, glb_id)
                    VALUES (:id, :name, :prompt, :np, :sj, :img, :mp, :available, :ts, :ts, :glb)
                """), {"id": pid, "name": req.name, "prompt": req.prompt, "np": req.negative_prompt,
                       "sj": req.settings_json, "img": req.image_data_url, "mp": req.mesh_params_json,
                       "ts": now, "glb": req.glb_id, "available": int(bool(req.glb_id))})
        return {"id": pid, "saved": True}

    @api.get("/projects/{pid}")
    async def get_project(pid: str):
        engine = get_engine()
        if not engine:
            raise HTTPException(503, "Database not configured.")
        with engine.connect() as conn:
            r = conn.execute(sql_text(
                "SELECT id, name, prompt, negative_prompt, settings_json, image_data_url, mesh_params_json, glb_available, created_at, updated_at, glb_id FROM projects WHERE id=:id"
            ), {"id": pid}).fetchone()
        if not r:
            raise HTTPException(404, "Project not found.")
        return {
            "id": r[0], "name": r[1], "prompt": r[2], "negative_prompt": r[3],
            "settings_json": r[4], "image_data_url": r[5], "mesh_params_json": r[6],
            "glb_available": bool(r[10] and service.model_path(r[10]).is_file()), "created_at": r[8], "updated_at": r[9], "glb_id": r[10],
        }

    @api.delete("/projects/{pid}")
    async def delete_project(pid: str):
        engine = get_engine()
        if not engine:
            raise HTTPException(503, "Database not configured.")
        with engine.begin() as conn:
            conn.execute(sql_text("DELETE FROM history WHERE project_id=:id"), {"id": pid})
            conn.execute(sql_text("DELETE FROM projects WHERE id=:id"), {"id": pid})
        return {"deleted": True}

    # -- History --
    @api.get("/projects/{pid}/history")
    async def get_history(pid: str):
        engine = get_engine()
        if not engine:
            return []
        with engine.connect() as conn:
            rows = conn.execute(sql_text(
                "SELECT id, project_id, action, prompt, image_data_url, settings_json, created_at FROM history WHERE project_id=:pid ORDER BY created_at DESC"
            ), {"pid": pid}).fetchall()
        return [
            {"id": r[0], "project_id": r[1], "action": r[2], "prompt": r[3],
             "image_data_url": r[4], "settings_json": r[5], "created_at": r[6]}
            for r in rows
        ]

    @api.post("/projects/{pid}/history")
    async def add_history(pid: str, action: str = Form(...), prompt: str = Form(""),
                          image_data_url: str = Form(""), settings_json: str = Form("{}")):
        engine = get_engine()
        if not engine:
            raise HTTPException(503, "Database not configured.")
        hid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        img_val = image_data_url if image_data_url else None
        with engine.begin() as conn:
            conn.execute(sql_text("""
                INSERT INTO history (id, project_id, action, prompt, image_data_url, settings_json, created_at)
                VALUES (:id, :pid, :action, :prompt, :img, :sj, :ts)
            """), {"id": hid, "pid": pid, "action": action, "prompt": prompt,
                   "img": img_val, "sj": settings_json, "ts": now})
        return {"id": hid, "saved": True}

    @api.delete("/projects/{pid}/history/{hid}")
    async def delete_history(pid: str, hid: str):
        with get_engine().begin() as conn:
            conn.execute(sql_text("DELETE FROM history WHERE id=:hid AND project_id=:pid"), {"hid": hid, "pid": pid})
        return {"deleted": True}

    # -- Settings --
    @api.get("/settings")
    async def get_settings():
        engine = get_engine()
        defaults = {
            "backend": "gemini",
            "model": "gemini-3.1-flash-image",
            "subdivisions": 128,
            "height_scale": 0.3,
            "smooth": True,
            "allow_adult_art": True,
            "safety_mode": "standard",
            "mesh_quality": "balanced",
            "mesh_device": "auto",
            "bake_texture": False,
            "texture_resolution": 1024,
        }
        if not engine:
            return defaults
        with engine.connect() as conn:
            r = conn.execute(sql_text("SELECT value_json FROM settings WHERE key='global'")).fetchone()
        if r:
            stored = json.loads(r[0])
            defaults.update(stored)
        return defaults

    @api.put("/settings")
    async def update_settings(req: SettingsUpdate):
        engine = get_engine()
        if not engine:
            raise HTTPException(503, "Database not configured.")
        val_json = json.dumps(req.model_dump())
        with engine.begin() as conn:
            conn.execute(sql_text("""
                INSERT INTO settings (key, value_json) VALUES ('global', :v)
                ON CONFLICT (key) DO UPDATE SET value_json = :v
            """), {"v": val_json})
        return {"saved": True}

    # -- AI Assistant chat --
    @api.post("/chat")
    async def chat(req: ChatRequest):
        client = get_gemini_client()
        if client is None:
            raise HTTPException(503, "Gemini API not configured.")

        system_prompt = (
            "You are an imaging AI assistant for a 3D textured image generator app. "
            "Help users craft better prompts for image generation, suggest 3D mesh parameters, "
            "and troubleshoot issues. Be concise and helpful. "
            "Safety policy: Adult artistic nudity involving clearly adult fictional or consenting subjects is permitted. "
            "Block and warn about: minors, age-ambiguous subjects, nonconsensual imagery, and real-person deepfakes. "
            "If a user asks for blocked content, refuse and explain why."
        )

        full_msg = f"{system_prompt}\n\nUser context: {req.context}\n\nUser message: {req.message}"
        t0 = time.time()
        try:
            response = await client.aio.models.generate_content(
                model=os.environ.get("GEMINI_CHAT_MODEL", "gemini-3.8-flash"),
                contents=full_msg,
            )
            reply = response.text or "I couldn't generate a response."
        except Exception as e:
            raise provider_error(e) from None

        elapsed = int((time.time() - t0) * 1000)
        return ChatResponse(reply=reply, elapsed_ms=elapsed)

    # -- Upload reference image --
    @api.post("/upload")
    async def upload_image(file: UploadFile = File(...)):
        raw = await file.read(MAX_IMAGE_BYTES + 1)
        raw, image = normalize_image(raw)
        return {"image": "data:image/png;base64," + base64.b64encode(raw).decode(), "size": [image.width, image.height]}

    # -- Recovery: list unsaved/in-progress images from cache --
    @api.get("/recovery")
    async def recovery():
        jobs = service.recover()
        ids = [job["id"] for job in jobs if job["status"] == "completed" and service.model_path(job["id"]).is_file()]
        return {"glb_count": len(ids), "glb_ids": ids, "jobs": jobs}

    # -----------------------------------------------------------------------
    # Build app
    # -----------------------------------------------------------------------
    init_db()
    @asynccontextmanager
    async def lifespan(app):
        yield
        await service.close()

    app = FastAPI(title="Textured 3D Image Generator", lifespan=lifespan)
    app.state.reconstruction = service
    app.include_router(api, prefix="/api")

    if os.path.isdir(static_dir):
        assets_dir = os.path.join(static_dir, "assets")
        if os.path.isdir(assets_dir):
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}")
        async def spa_fallback(request: Request, path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "API route not found.")
            root = Path(static_dir).resolve()
            file_path = (root / path).resolve()
            if not file_path.is_relative_to(root):
                raise HTTPException(404, "File not found.")
            if path and file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(
                os.path.join(static_dir, "index.html"),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )

    return app
