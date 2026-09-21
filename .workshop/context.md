# Textured 3D Image Generator — Project Context

## Architecture
- React 19 + Vite frontend, FastAPI backend (routes.py), app.py exports `asgi`
- Three.js via @react-three/fiber + @react-three/drei for 3D preview
- Zustand for state management (src/lib/store.ts)
- Gemini (Workshop managed) for image generation and AI chat
- Neon PostgreSQL for project persistence (DBD8870D13 prefix)
- trimesh + numpy + Pillow on backend for 3D mesh generation and GLB export

## Key Files
- routes.py — All API endpoints: /api/generate, /api/mesh, /api/glb/{id}, /api/projects (CRUD), /api/settings, /api/chat, /api/upload, /api/recovery
- src/lib/store.ts — Zustand store with undo/redo, project state, settings
- src/types.ts — All TypeScript types
- src/components/toolbar.tsx — Windows Explorer-style toolbar
- src/components/viewer-3d.tsx — Three.js heightmap mesh viewer
- src/components/viewer-2d.tsx — 2D image viewer
- src/components/prompt-bar.tsx — Prompt input with generate button
- src/components/assistant-panel.tsx — AI chat panel
- src/components/settings-dialog.tsx — Backend/model/mesh/safety settings
- src/components/history-panel.tsx — History with restore
- src/components/projects-panel.tsx — Project open/delete
- public/manifest.json + public/sw.js — PWA installability

## Conventions
- Dark mode forced by default (document.documentElement.classList.add("dark"))
- Mobile-first responsive layout
- All colors via shadcn semantic CSS variables
- import type for TypeScript types (verbatimModuleSyntax)
- Safety filter in routes.py check_safety() blocks: minors, deepfakes, nonconsensual
- GLB export validated by re-loading with trimesh before serving
- Image→3D pipeline: image luminance → heightmap displacement → textured plane mesh → GLB

## Backend Pipeline
1. POST /api/generate → Gemini image gen (gemini-3.1-flash-image default)
2. POST /api/mesh → image_to_heightmap_mesh() → mesh_to_glb_bytes() → cached in memory
3. GET /api/glb/{id} → download validated GLB file
4. Projects/history/settings persisted in Neon Postgres

## Connectors
- Gemini: GEMINI_WORKSHOP_API_KEY, GEMINI_WORKSHOP_BASE_URL
- Database: DBD8870D13_DATABASE_URL, DBD8870D13_DIRECT_URL