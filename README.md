# Textured 3D Image Generator

The existing Workshop app now uses **TripoSR single-image reconstruction** instead of a luminance heightmap.
Import an image or generate one, tap **3D**, rotate the reconstructed model, save the project, and export GLB, glTF, OBJ, or STL.
The phone uses the web interface; the model runs on the computer/server hosting the backend.

## Start the app

Use Python **3.12**, [uv](https://docs.astral.sh/uv/getting-started/installation/), Git, and Node.js 22 or newer (or Bun).

- Windows: `powershell -ExecutionPolicy Bypass -File start.ps1`
- Linux/macOS: `bash start.sh`

Open the address printed by Vite; another device on the same network can use the computer's address with that port.
The interface and FastAPI share one origin through Vite's `/api` proxy.
Projects, settings, source images, job metadata, and finished models use `.data/` by default.
Workshop's existing PostgreSQL connection remains supported; local use falls back to SQLite without an account.
Back up `.data/` to keep local work, and use a persistent volume for that directory when hosting in a container.
Run one backend worker: the reconstruction queue serializes model processes to limit memory use.

## Install real 3D once

```sh
python scripts/setup_local_3d.py
```

For a machine without a compatible NVIDIA GPU:

```sh
python scripts/setup_local_3d.py --cpu
```

Setup downloads the public TripoSR weights, DINO configuration, and background-removal model into `.local3d/`.
After setup, reconstruction uses only those local files, with Hugging Face/Transformers offline modes enabled.
No paid API or per-model credit service is used for reconstruction.
The engine environment is isolated from the web app's dependencies, and the pinned source uses a portable marching-cubes fallback that needs no C++ or CUDA compiler.
Auto chooses NVIDIA when at least 6 GB VRAM is present; otherwise it chooses CPU.
For the lowest memory use, choose **Draft** in Settings; higher quality extracts a denser surface.
If a job fails or is interrupted, its source image is retained, and the current image/previous model remain available for retry.

## Image generation and assistant

Importing an existing image requires no image-generation credentials.
Workshop's `GEMINI_WORKSHOP_API_KEY` and `GEMINI_WORKSHOP_BASE_URL` still work together.
Outside Workshop, copy `.env.example` to `.env` and set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`); no Workshop URL is required.
Gemini provider quotas and content rules still apply, and expired credentials must be renewed with the provider.
The assistant model is configurable with `GEMINI_CHAT_MODEL`.

For local image generation, start Stable Diffusion WebUI/Forge with `--api`, set `SD_WEBUI_URL`, and choose **Local Stable Diffusion** in Settings.
Both text-to-image and reference-image editing are supported; negative prompts are sent to the selected backend.
Local generation uses the installed checkpoint unless you enter a specific checkpoint name in the model field.
The earlier nonfunctional ComfyUI choice has been removed from the menu.

## Models, preview, and exports

- The preview loads the same validated GLB that the server exports, with embedded vertex colors or a baked UV texture.
- GLB is a single model file; glTF and OBJ downloads are ZIPs containing their required buffers/materials/textures.
- Each format is reloaded and checked after export.
- STL is offered only for a watertight, consistently wound model; it has no color/texture and does not guarantee print scale.
- Small holes/normals are repaired where possible; the app rejects empty/flat/invalid geometry and never substitutes a relief plane when the engine is unavailable.
- Single-image reconstruction infers unseen surfaces; additional views and automatic character rigging are not implemented by this patch.
- Saving/reopening a project retains its model ID; refresh recovers the last reconstruction job on the same browser.

## Checks

```sh
uv sync --frozen
uv run python -m unittest discover -s tests -v
node tests/frontend.mjs
npm run build
```

The API tests replace only the expensive model process when checking queue/failure contracts.
A real offline CPU reconstruction and browser flow are recorded in `.workshop/verification.md`.
The original repository has existing lint violations in untouched shadcn files; changed source files are checked separately.

Upstream implementation: [TripoSR](https://github.com/VAST-AI-Research/TripoSR/tree/107cefdc244c39106fa830359024f6a2f1c78871).

Additional component research: [SourceForge and Android candidates](SOURCEFORGE-NOTES.md).
