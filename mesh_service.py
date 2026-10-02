"""Persistent reconstruction jobs; a separate Python process owns the model."""
import asyncio
import json
import os
import uuid
from pathlib import Path
from datetime import datetime, timezone

from mesh_formats import load_model, validate_model

ROOT = Path(__file__).resolve().parent


def local_configuration() -> dict:
    home = Path(os.environ.get("LOCAL_3D_HOME", ROOT / ".local3d")).resolve()
    source = Path(os.environ.get("TRIPOSR_HOME", home / "TripoSR")).resolve()
    model = Path(os.environ.get("TRIPOSR_MODEL_DIR", home / "models" / "TripoSR")).resolve()
    background = Path(os.environ.get("U2NET_HOME", home / "models" / "rembg")).resolve()
    hub_cache = Path(os.environ.get("TRIPOSR_HUB_CACHE", model.parent / "hub")).resolve()
    default_python = home / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    # Resolving a venv's interpreter symlink would bypass its site-packages.
    python = Path(os.environ.get("TRIPOSR_PYTHON", default_python)).absolute()
    missing = []
    for label, path in (
        ("TripoSR source", source / "tsr/system.py"),
        ("model environment", python),
        ("model config", model / "config.yaml"),
        ("model weights", model / "model.ckpt"),
        ("background remover", background / "u2netp.onnx"),
    ):
        if not path.is_file():
            missing.append(label)
    if not list((hub_cache / "models--facebook--dino-vitb16" / "snapshots").glob("*/config.json")):
        missing.append("DINO configuration cache")
    return {"ready": not missing, "missing": missing, "python": str(python),
            "source": str(source), "model": str(model), "background": str(background), "hub_cache": str(hub_cache)}


class ReconstructionService:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.jobs_dir = data_dir / "jobs"
        self.models_dir = data_dir / "models"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.tasks = set()
        self.lock = asyncio.Semaphore(1)
        # An interrupted job is recoverable, not a permanently spinning request.
        for manifest in self.jobs_dir.glob("*/job.json"):
            job = json.loads(manifest.read_text())
            if job["status"] in ("queued", "running"):
                job.update(status="failed", stage="Interrupted", error="The server restarted before reconstruction finished. Your source image is saved; retry the job.")
                self.write(job)

    def directory(self, job_id: str) -> Path:
        if str(uuid.UUID(job_id)) != job_id:
            raise ValueError("Invalid model ID.")
        return self.jobs_dir / job_id

    def write(self, job: dict):
        directory = self.directory(job["id"])
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / "job.json"
        temporary = directory / "job.tmp"
        temporary.write_text(json.dumps(job), encoding="utf-8")
        temporary.replace(target)

    def get(self, job_id: str) -> dict:
        return json.loads((self.directory(job_id) / "job.json").read_text())

    def model_path(self, model_id: str) -> Path:
        self.directory(model_id)
        return self.models_dir / f"{model_id}.glb"

    def recover(self) -> list[dict]:
        jobs = [json.loads(path.read_text()) for path in self.jobs_dir.glob("*/job.json")]
        return sorted(jobs, key=lambda job: job["created_at"], reverse=True)

    def start(self, image: bytes, parameters: dict) -> dict:
        config = local_configuration()
        if not config["ready"]:
            raise RuntimeError("Real 3D reconstruction is not installed: " + ", ".join(config["missing"]) + ". Run python scripts/setup_local_3d.py once; imported images and saved projects remain usable.")
        job_id = str(uuid.uuid4())
        directory = self.directory(job_id)
        directory.mkdir(parents=True)
        (directory / "input.png").write_bytes(image)
        (directory / "parameters.json").write_text(json.dumps(parameters))
        job = {"id": job_id, "status": "queued", "stage": "Waiting for the 3D engine", "progress": 0,
               "created_at": datetime.now(timezone.utc).isoformat(), "error": None, "result": None,
               "image_url": f"/api/mesh/{job_id}/image"}
        self.write(job)
        task = asyncio.create_task(self.run(job, config))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return job

    async def run(self, job: dict, config: dict):
        process = None
        temporary_model = self.models_dir / f"{job['id']}.tmp.glb"
        started = asyncio.get_running_loop().time()
        try:
            async with self.lock:
                job.update(status="running", stage="Loading reconstruction model", progress=5)
                self.write(job)
                directory = self.directory(job["id"])
                env = os.environ.copy()
                env.update(TRIPOSR_HOME=config["source"], TRIPOSR_MODEL_DIR=config["model"],
                           U2NET_HOME=config["background"], HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                           HF_HUB_CACHE=config["hub_cache"], HUGGINGFACE_HUB_CACHE=config["hub_cache"],
                           OMP_NUM_THREADS=os.environ.get("OMP_NUM_THREADS", "2"))
                process = await asyncio.create_subprocess_exec(
                    config["python"], "-u", str(ROOT / "reconstruction_worker.py"),
                    "--input", str(directory / "input.png"), "--parameters", str(directory / "parameters.json"),
                    "--output", str(temporary_model), stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT, env=env,
                )
                failure = "Reconstruction failed. Check the local model environment; your image is saved."
                async with asyncio.timeout(float(os.environ.get("MESH_TIMEOUT_SECONDS", "1800"))):
                    with (directory / "worker.log").open("wb") as log:
                        while line := await process.stdout.readline():
                            log.write(line)
                            if line.startswith(b"STUDIO_PROGRESS "):
                                update = json.loads(line[len(b"STUDIO_PROGRESS "):])
                                job.update(stage=update["stage"], progress=update["progress"])
                                self.write(job)
                            elif line.startswith(b"STUDIO_ERROR "):
                                failure = line[len(b"STUDIO_ERROR "):].decode().strip()
                        if await process.wait():
                            raise RuntimeError(failure)
                data = await asyncio.to_thread(temporary_model.read_bytes)
                scene = await asyncio.to_thread(load_model, data)
                info = await asyncio.to_thread(validate_model, scene)
                temporary_model.replace(self.model_path(job["id"]))
                job.update(status="completed", stage="Model ready", progress=100, result={
                    **info, "glb_available": True, "glb_id": job["id"],
                    "elapsed_ms": int((asyncio.get_running_loop().time() - started) * 1000),
                    "method": "triposr", "warnings": [] if info["watertight"] else ["This mesh has open surfaces; STL export requires repair."],
                })
        except asyncio.CancelledError:
            job.update(status="failed", stage="Interrupted", error="Reconstruction stopped. Your source image is saved.")
            raise
        except TimeoutError:
            job.update(status="failed", stage="Timed out", error="Reconstruction exceeded the time limit. Try Draft quality or a CUDA device; your source image is saved.")
        except Exception as error:
            job.update(status="failed", stage="Failed", error=str(error))
        finally:
            if process and process.returncode is None:
                process.kill()
                await process.wait()
            self.write(job)
            temporary_model.unlink(missing_ok=True)

    async def close(self):
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
