import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-frontend-'));
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
try {
  const output = path.join(directory, 'test-bundle.mjs');
  await build({ stdin: { contents: 'export { useStore, defaultSettings, defaultMeshParams } from "./src/lib/store"; export { generateImage, buildMesh } from "./src/lib/actions";', resolveDir: process.cwd(), loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm', alias: { '@': path.join(process.cwd(), 'src') } });
  const { useStore, defaultSettings, defaultMeshParams, generateImage, buildMesh } = await import(pathToFileURL(output));
  const priorMesh = { vertices: 8, faces: 12, elapsed_ms: 10, glb_available: true, glb_id: 'prior-model', watertight: true, method: 'triposr', warnings: [] };
  const reset = () => useStore.setState({ image: 'original-image', prompt: 'original prompt', negativePrompt: '', glbId: 'prior-model', meshInfo: priorMesh, viewMode: '3d', isGenerating: false, isMeshGenerating: false, generateError: null, meshError: null, undoStack: [], redoStack: [], projectId: null, meshParams: defaultMeshParams, settings: defaultSettings });
  reset();
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Provider quota exhausted' }), { status: 429 });
  await generateImage();
  assert.equal(useStore.getState().image, 'original-image');
  assert.equal(useStore.getState().prompt, 'original prompt');
  assert.equal(useStore.getState().glbId, 'prior-model');
  assert.equal(useStore.getState().generateError, 'Provider quota exhausted');
  assert.equal(useStore.getState().isGenerating, false);
  console.log('PASS provider failure preserves image, prompt, and previous model');

  reset();
  let request;
  globalThis.fetch = async (url, options) => { request = JSON.parse(options.body); return new Response(JSON.stringify({ image: 'new-image', prompt: request.prompt, elapsed_ms: 20 })); };
  await generateImage(true);
  assert.match(request.prompt, /^original prompt, highly detailed/);
  assert.equal(useStore.getState().prompt, request.prompt);
  assert.equal(useStore.getState().image, 'new-image');
  assert.equal(useStore.getState().glbId, null);
  useStore.getState().undo();
  assert.equal(useStore.getState().image, 'original-image');
  assert.equal(useStore.getState().glbId, 'prior-model');
  assert.deepEqual(useStore.getState().meshInfo, priorMesh);
  useStore.getState().redo();
  assert.equal(useStore.getState().image, 'new-image');
  assert.equal(useStore.getState().glbId, null);
  console.log('PASS enhancement sends the modified prompt; undo/redo restore matching model');

  reset();
  let calls = 0;
  useStore.setState({ isGenerating: true });
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  await generateImage();
  await buildMesh();
  assert.equal(calls, 0);
  console.log('PASS busy state prevents duplicate generation requests');

  reset();
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: '3D engine not installed' }), { status: 503 });
  await buildMesh();
  assert.equal(useStore.getState().image, 'original-image');
  assert.equal(useStore.getState().glbId, 'prior-model');
  assert.equal(useStore.getState().meshError, '3D engine not installed');
  assert.equal(useStore.getState().isMeshGenerating, false);
  console.log('PASS missing reconstruction engine preserves the previous result');

  reset();
  const result = { ...priorMesh, glb_id: 'new-model' };
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'new-model', status: 'completed', stage: 'Model ready', progress: 100, result, error: null, image_url: '/source.png' }));
  await buildMesh();
  assert.equal(useStore.getState().glbId, 'new-model');
  assert.deepEqual(useStore.getState().meshInfo, result);
  assert.equal(useStore.getState().viewMode, '3d');
  assert.equal(storage.get('studio-last-mesh-job'), 'new-model');
  console.log('PASS reconstruction result and recovery ID are retained');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
