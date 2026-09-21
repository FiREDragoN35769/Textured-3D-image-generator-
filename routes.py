import os
import io
import json
import base64
import time
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from PIL import Image
import trimesh
import trimesh.visual

from fastapi import FastAPI, APIRouter, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text as sql_text


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

DB_URL = os.environ.get("DBD8870D13_DATABASE_URL", "")

def get_engine():
    if not DB_URL:
        return None
    return create_engine(DB_URL, pool_pre_ping=True)

def init_db():
    engine = get_engine()
    if not engine:
        return
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


# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------

_gemini_client = None

def get_gemini_client():
    global _gemini_client
    if _gemini_client is not None:
        return _gemini_client
    api_key = os.environ.get("GEMINI_WORKSHOP_API_KEY")
    base_url = os.environ.get("GEMINI_WORKSHOP_BASE_URL")
    if not api_key or not base_url:
        return None
    from google import genai
    _gemini_client = genai.Client(
        api_key=api_key,
        http_options={"api_version": "v1alpha", "base_url": base_url},
    )
    return _gemini_client


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
# 3D mesh generation from image (heightmap / displacement)
# ---------------------------------------------------------------------------

def image_to_heightmap_mesh(
    image: Image.Image,
    subdivisions: int = 128,
    height_scale: float = 0.3,
    smooth: bool = True,
) -> trimesh.Trimesh:
    """Convert a 2D image into a textured 3D mesh using luminance as heightmap."""
    # Convert to grayscale for height, keep original for texture
    gray = image.convert("L").resize((subdivisions, subdivisions), Image.LANCZOS)
    texture_img = image.convert("RGB").resize((subdivisions, subdivisions), Image.LANCZOS)

    height_arr = np.array(gray, dtype=np.float32) / 255.0

    if smooth:
        # Simple box blur
        kernel = np.ones((3, 3), dtype=np.float32) / 9.0
        from numpy.lib.stride_tricks import sliding_window_view
        padded = np.pad(height_arr, 1, mode="edge")
        windows = sliding_window_view(padded, (3, 3))
        height_arr = windows.mean(axis=(2, 3))

    # Create a plane grid
    xs = np.linspace(-1, 1, subdivisions)
    ys = np.linspace(-1, 1, subdivisions)
    grid_x, grid_y = np.meshgrid(xs, ys)

    # Displace Z by height
    vertices = np.stack([
        grid_x.flatten(),
        grid_y.flatten(),
        (height_arr.flatten() * height_scale),
    ], axis=-1);

    # Build faces (two triangles per quad)
    row_count = subdivisions
    faces = []
    for i in range(row_count - 1):
        for j in range(row_count - 1):
            idx = i * row_count + j
            faces.append([idx, idx + 1, idx + row_count])
            faces.append([idx + 1, idx + row_count + 1, idx + row_count])
    faces = np.array(faces, dtype=np.int64)

    # UV coordinates
    uvs = np.stack([
        grid_x.flatten() * 0.5 + 0.5,
        1.0 - (grid_y.flatten() * 0.5 + 0.5),
    ], axis=-1)

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.visual = trimesh.visual.texture.TextureVisuals(
        uv=uvs,
        material=trimesh.visual.material.SimpleMaterial(
            image=texture_img,
        ),
    )
    return mesh


def mesh_to_glb_bytes(mesh: trimesh.Trimesh) -> bytes:
    """Export a trimesh as GLB binary data, with validation."""
    export = mesh.export(file_type="glb")
    if isinstance(export, str):
        export = export.encode("utf-8")
    # Validate by re-loading
    try:
        trimesh.load(io.BytesIO(export), file_type="glb", force="mesh")
    except Exception as e:
        raise ValueError(f"GLB validation failed: {e}")
    return export


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    negative_prompt: str = ""
    model: str = "gemini-3.1-flash-image"
    width: int = 1024
    height: int = 1024
    reference_image: Optional[str] = None  # data URL

class GenerateResponse(BaseModel):
    image: str  # data URL
    prompt: str
    elapsed_ms: int

class MeshRequest(BaseModel):
    image: str  # data URL
    subdivisions: int = 128
    height_scale: float = 0.3
    smooth: bool = True

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
    backend: str = "gemini"
    model: str = "gemini-3.1-flash-image"
    subdivisions: int = 128
    height_scale: float = 0.3
    smooth: bool = True
    allow_adult_art: bool = True
    safety_mode: str = "standard"

class ChatRequest(BaseModel):
    message: str
    context: str = ""

class ChatResponse(BaseModel):
    reply: str
    elapsed_ms: int


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

# In-memory GLB cache (per session)
_glb_cache: dict[str, bytes] = {}

def create_app(static_dir: str) -> FastAPI:
    api = APIRouter()

    # -- Health --
    @api.get("/health")
    def health():
        return {"ok": True, "db": bool(DB_URL), "gemini": get_gemini_client() is not None}

    # -- Image generation --
    @api.post("/generate")
    async def generate(req: GenerateRequest):
        client = get_gemini_client()
        if client is None:
            raise HTTPException(503, "Gemini API not configured. Set GEMINI_WORKSHOP_API_KEY and GEMINI_WORKSHOP_BASE_URL.")

        safe, reason = check_safety(req.prompt)
        if not safe:
            raise HTTPException(400, reason)

        from google.genai import types

        contents = []
        if req.reference_image:
            # Parse data URL
            header, b64data = req.reference_image.split(",", 1)
            img_bytes = base64.b64decode(b64data)
            pil_img = Image.open(io.BytesIO(img_bytes))
            contents.append(pil_img)

        contents.append(req.prompt)

        t0 = time.time()
        try:
            response = client.models.generate_content(
                model=req.model,
                contents=contents,
                config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
            )
        except Exception as e:
            raise HTTPException(502, f"Generation failed: {str(e)}")

        for part in response.parts:
            if part.inline_data is not None:
                img_data = part.inline_data.data
                mime = part.inline_data.mime_type or "image/png"
                if isinstance(img_data, bytes):
                    b64 = base64.b64encode(img_data).decode()
                else:
                    b64 = img_data
                elapsed = int((time.time() - t0) * 1000)
                data_url = f"data:{mime};base64,{b64}"
                return GenerateResponse(image=data_url, prompt=req.prompt, elapsed_ms=elapsed)

        raise HTTPException(500, "No image was returned by the model.")

    # -- 3D mesh generation + GLB export --
    @api.post("/mesh")
    async def create_mesh(req: MeshRequest):
        header, b64data = req.image.split(",", 1)
        img_bytes = base64.b64decode(b64data)
        pil_img = Image.open(io.BytesIO(img_bytes))

        t0 = time.time()
        mesh = image_to_heightmap_mesh(
            pil_img,
            subdivisions=req.subdivisions,
            height_scale=req.height_scale,
            smooth=req.smooth,
        )
        glb_bytes = mesh_to_glb_bytes(mesh)
        elapsed = int((time.time() - t0) * 1000)

        glb_id = str(uuid.uuid4())
        _glb_cache[glb_id] = glb_bytes

        return MeshResponse(
            glb_available=True,
            vertices=len(mesh.vertices),
            faces=len(mesh.faces),
            elapsed_ms=elapsed,
        ).model_dump() | {"glb_id": glb_id}

    # -- Download GLB --
    @api.get("/glb/{glb_id}")
    async def download_glb(glb_id: str):
        glb_bytes = _glb_cache.get(glb_id)
        if glb_bytes is None:
            raise HTTPException(404, "GLB not found. It may have expired — regenerate the mesh.")
        return StreamingResponse(
            io.BytesIO(glb_bytes),
            media_type="model/gltf-binary",
            headers={"Content-Disposition": "attachment; filename=textured_model.glb"},
        )

    # -- Project CRUD --
    @api.get("/projects")
    async def list_projects():
        engine = get_engine()
        if not engine:
            return []
        with engine.connect() as conn:
            rows = conn.execute(sql_text(
                "SELECT id, name, prompt, negative_prompt, settings_json, image_data_url, mesh_params_json, glb_available, created_at, updated_at FROM projects ORDER BY updated_at DESC"
            )).fetchall()
        return [
            {
                "id": r[0], "name": r[1], "prompt": r[2], "negative_prompt": r[3],
                "settings_json": r[4], "image_data_url": r[5], "mesh_params_json": r[6],
                "glb_available": bool(r[7]), "created_at": r[8], "updated_at": r[9],
            }
            for r in rows
        ]

    @api.post("/projects")
    async def save_project(req: ProjectSave):
        engine = get_engine()
        if not engine:
            raise HTTPException(503, "Database not configured.")
        now = datetime.now(timezone.utc).isoformat()
        pid = req.id or str(uuid.uuid4())
        with engine.begin() as conn:
            existing = conn.execute(sql_text("SELECT id FROM projects WHERE id = :id"), {"id": pid}).fetchone()
            if existing:
                conn.execute(sql_text("""
                    UPDATE projects SET name=:name, prompt=:prompt, negative_prompt=:np,
                    settings_json=:sj, image_data_url=:img, mesh_params_json=:mp, updated_at=:ts
                    WHERE id=:id
                """), {"name": req.name, "prompt": req.prompt, "np": req.negative_prompt,
                       "sj": req.settings_json, "img": req.image_data_url, "mp": req.mesh_params_json,
                       "ts": now, "id": pid})
            else:
                conn.execute(sql_text("""
                    INSERT INTO projects (id, name, prompt, negative_prompt, settings_json, image_data_url, mesh_params_json, glb_available, created_at, updated_at)
                    VALUES (:id, :name, :prompt, :np, :sj, :img, :mp, 0, :ts, :ts)
                """), {"id": pid, "name": req.name, "prompt": req.prompt, "np": req.negative_prompt,
                       "sj": req.settings_json, "img": req.image_data_url, "mp": req.mesh_params_json,
                       "ts": now})
        return {"id": pid, "saved": True}

    @api.get("/projects/{pid}")
    async def get_project(pid: str):
        engine = get_engine()
        if not engine:
            raise HTTPException(503, "Database not configured.")
        with engine.connect() as conn:
            r = conn.execute(sql_text(
                "SELECT id, name, prompt, negative_prompt, settings_json, image_data_url, mesh_params_json, glb_available, created_at, updated_at FROM projects WHERE id=:id"
            ), {"id": pid}).fetchone()
        if not r:
            raise HTTPException(404, "Project not found.")
        return {
            "id": r[0], "name": r[1], "prompt": r[2], "negative_prompt": r[3],
            "settings_json": r[4], "image_data_url": r[5], "mesh_params_json": r[6],
            "glb_available": bool(r[7]), "created_at": r[8], "updated_at": r[9],
        }

    @api.delete("/projects/{pid}")
    async def delete_project(pid: str):
        engine = get_engine()
        if not engine:
            raise HTTPException(503, "Database not configured.")
        with engine.begin() as conn:
            conn.execute(sql_text("DELETE FROM projects WHERE id=:id"), {"id": pid})
            conn.execute(sql_text("DELETE FROM history WHERE project_id=:id"), {"id": pid})
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
            response = client.models.generate_content(
                model="gemini-3.8-flash",
                contents=full_msg,
            )
            reply = response.text or "I couldn't generate a response."
        except Exception as e:
            raise HTTPException(502, f"Chat failed: {str(e)}")

        elapsed = int((time.time() - t0) * 1000)
        return ChatResponse(reply=reply, elapsed_ms=elapsed)

    # -- Upload reference image --
    @api.post("/upload")
    async def upload_image(file: UploadFile = File(...)):
        raw = await file.read()
        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 20 MB).")
        img = Image.open(io.BytesIO(raw))
        # Re-encode as PNG to normalize
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        return {"image": f"data:image/png;base64,{b64}", "size": [img.width, img.height]}

    # -- Recovery: list unsaved/in-progress images from cache --
    @api.get("/recovery")
    async def recovery():
        """Return count of GLB meshes available in cache."""
        return {"glb_count": len(_glb_cache), "glb_ids": list(_glb_cache.keys())}

    # -----------------------------------------------------------------------
    # Build app
    # -----------------------------------------------------------------------
    init_db()
    app = FastAPI(title="Textured 3D Image Generator")
    app.include_router(api, prefix="/api")

    if os.path.isdir(static_dir):
        assets_dir = os.path.join(static_dir, "assets")
        if os.path.isdir(assets_dir):
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}")
        async def spa_fallback(request: Request, path: str):
            file_path = os.path.join(static_dir, path)
            if path and os.path.isfile(file_path):
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
