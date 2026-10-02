# Repair verification — 2026-10-02 UTC / 2026-10-01 America/Chicago

Baseline: 39115ad64e35c0065f8af247388552e4ef70c8a0 (master).

## Reproduced baseline defects

- Solid orange input yielded an open luminance plane: 256 vertices, 450 faces, zero volume, not watertight.
- Project saving without Workshop's database returned HTTP 503.
- A direct GEMINI_API_KEY was ignored without a Workshop URL.
- Invalid image upload raised an unhandled Pillow exception.
- Preview independently generated a browser heightmap instead of loading the server model.
- Models existed only in a process cache, and Save/Settings/Delete could hide HTTP failures.

## Fresh evidence

| Acceptance criterion | Evidence | Status |
| --- | --- | --- |
| Real volumetric reconstruction | Real TripoSR CPU worker with cached public weights and offline flags produced a closed colored model, 2,449 vertices / 4,898 faces | Confirmed |
| Full asynchronous API path | POST /api/mesh → worker process → progress → validation → durable GLB, with no model mock; completed in 16,982 ms | Confirmed |
| UV texture preserved | Real API result contained 3,722 atlas vertices / 4,898 faces and embedded texture; reloaded exports retained image data | Confirmed |
| Valid exports | Real reconstructed GLB (318,880 bytes), glTF ZIP (250,094), OBJ ZIP (287,003), STL (244,984), all HTTP 200 and independently reloaded by export validation | Confirmed |
| Local storage and restart recovery | Real SQLite project/model save, fresh API tests for reopening settings/project and interrupted-job recovery | Confirmed |
| Input retained on failure | Provider quota/missing provider/missing engine/worker failure tests and browser failure check preserve image, prompt, and prior model | Confirmed |
| Gemini configuration | SDK construction with direct key and existing Workshop key/URL; async request contract, both modalities, reference and negative prompt checked without spending API credits | Confirmed for configuration/contract |
| Phone interface and actual GLB preview | Chromium headless 134, 412×915 portrait and 915×412 landscape; real textured model displayed and all four formats downloaded | Confirmed in browser simulation |
| Browser refresh recovery | Reload recovered the last completed reconstruction and displayed its real GLB | Confirmed |
| Runtime error checks | Browser flow completed with zero page errors | Confirmed |
| Model setup helper | CPU installer ran against isolated cached environment/assets, fetched assets, and passed dependency import checks | Confirmed on Linux |
| Type checking and production bundle | npm run build, exit 0 | Confirmed |
| API/format regressions | python -m unittest discover -s tests -v: 18 passed | Confirmed |
| Frontend state/action regressions | node tests/frontend.mjs: 5 behavioral checks passed | Confirmed |
| Changed-file lint / diff | ESLint on modified TS/TSX files, git diff --check, Python compile checks: exit 0 | Confirmed |

The final `npm run lint` returned exit 1 with six pre-existing errors in untouched files: badge.tsx, button.tsx, form.tsx, navigation-menu.tsx, toggle.tsx (react-refresh exports), and use-toast.ts (unused actionTypes). All changed TypeScript source passes lint.

## Test boundaries

- API regression tests replace the expensive model process only for job queue/failure contracts; the separate real API run used actual TripoSR weights and inference.
- The platform uses a SOCKS proxy; the SDK constructor initially failed without socksio. Enabling the httpx socks extra and a configuration regression check fixes this without bypassing the proxy.
- The interpreter-path regression was found by the real API run: resolving a virtual-environment interpreter symlink bypassed its packages; the fix preserves the venv path and has a regression check.
- glTF image data is embedded in a binary buffer, so validation checks the document's image/bufferView entries rather than requiring a separate PNG file.
- No live Gemini image/chat request was made; an expired key, exhausted quota, or provider refusal can still require account action.
- The user's physical Android phone, Windows startup, and NVIDIA GPU are not available here; CPU inference and browser dimensions are tested.
- No live Workshop deployment was changed; the repaired source must be imported/deployed there, with an installed model environment if reconstruction runs on that host.
- Additional image views, automatic rigging, and figure/anatomy fidelity beyond TripoSR single-image reconstruction are not claimed.
