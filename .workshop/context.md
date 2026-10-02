# Textured 3D Image Generator — Project Context

## Current implementation (2026-10-01 repair)
- Original repository: FiREDragoN35769/Textured-3D-image-generator-, branch master.
- React 19 / Vite / Zustand frontend and FastAPI backend; app.py loads optional .env.
- Image generation: existing Workshop Gemini connection, direct GEMINI_API_KEY/GOOGLE_API_KEY, or local Stable Diffusion WebUI/Forge API.
- Actual 3D: TripoSR single-image reconstruction in a separate, pinned model environment; no luminance plane fallback.
- Model environment, weights, DINO config, and background remover installed under .local3d by scripts/setup_local_3d.py.
- Inference uses local files with HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE enabled; CPU fallback supports smaller GPUs.
- Projects/settings/history: Workshop PostgreSQL when configured, otherwise .data/studio.sqlite.
- Reconstruction source images, jobs, logs and GLB files persist under .data; use a persistent volume for container deployment.
- Preview loads the actual server GLB with embedded colors/texture, with no external studio HDR dependency.

## Important files
- routes.py: provider handling, uploads, project/settings/history APIs, reconstruction endpoints, export endpoints, recovery and SPA serving.
- mesh_service.py: serialized model-process queue, job progress, durable model/source storage, restart handling.
- reconstruction_worker.py: offline TripoSR inference, portable surface extraction, optional UV atlas, Y-up GLB.
- mesh_formats.py: finite/volumetric/topology validation, GLB/glTF/OBJ/STL export and reload checks.
- src/lib/actions.ts: shared generation, reconstruction/polling, refresh recovery and downloads.
- src/lib/store.ts: current model identity and matching undo/redo snapshots.
- src/components/viewer-3d.tsx: actual GLB preview; loaded only when needed.
- public/sw.js: network-first navigation, versioned assets, no API/POST caching.
- tests/test_app.py and tests/frontend.mjs: behavioral regression checks.
- README.md and .workshop/verification.md: setup and verified results.

## API changes
- POST /api/mesh returns 202 with a job; GET /api/mesh/{id} supplies status/progress/result.
- GET /api/mesh/{id}/image preserves the job's source for recovery.
- GET /api/glb/{id} previews/downloads the validated GLB.
- GET /api/export/{id}/{glb|gltf|obj|stl}; glTF and OBJ use ZIP bundles.
- Saved projects retain glb_id; generation failure retains the prior image/model/prompt.
- GET /api/recovery includes durable completed and failed jobs.
- Settings include mesh_quality, mesh_device, bake_texture, texture_resolution.
- Original heightmap fields remain accepted in old settings records for compatibility, but are not used for reconstruction.

## Boundaries
- No new repository, APK, or live Workshop deployment was created by this repair.
- Single-image geometry infers unseen surfaces; multiview input and character rigging remain outside this patch.
- Live Gemini credentials/quota and the user's Windows/NVIDIA setup are not verified here.
- Keep credentials in server environment or ignored .env files; do not commit them.
- Keep the interface mobile-first, dark by default, and import TypeScript types with import type.
- Preserve the existing content filter and selected providers' own rules.
