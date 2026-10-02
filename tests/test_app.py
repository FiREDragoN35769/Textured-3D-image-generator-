"""API/persistence/export contracts; job tests substitute only the model process."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import uuid
import zipfile

from fastapi.testclient import TestClient
from PIL import Image
import numpy as np
import trimesh

import mesh_service
from mesh_formats import export_model, load_model, validate_model
import routes


def data_url():
    buffer = io.BytesIO()
    Image.new('RGB', (16, 16), 'orange').save(buffer, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()


def model_data(textured=False):
    mesh = trimesh.creation.box()
    mesh.visual.vertex_colors = np.tile([25, 120, 220, 255], (len(mesh.vertices), 1))
    if textured:
        mesh.visual = trimesh.visual.texture.TextureVisuals(
            uv=np.linspace(0, 1, len(mesh.vertices) * 2).reshape(-1, 2),
            image=Image.new('RGB', (4, 4), 'blue'),
        )
    return trimesh.Scene(mesh).export(file_type='glb')


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.environ = patch.dict(os.environ, {}, clear=True)
        self.environ.start()
        routes.DATA_DIR = self.root
        routes.DB_URL = f'sqlite:///{self.root / "studio.sqlite"}'
        routes.get_engine.cache_clear()
        self.app = routes.create_app(str(self.root / 'no-static-files'))
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        routes.get_engine().dispose()
        routes.get_engine.cache_clear()
        self.environ.stop()
        self.temp.cleanup()

    def test_projects_and_settings_work_without_workshop(self):
        health = self.client.get('/api/health').json()
        self.assertTrue(health['db'])
        response = self.client.post('/api/projects', json={'name': 'My local project', 'image_data_url': data_url()})
        self.assertEqual(response.status_code, 200)
        pid = response.json()['id']
        self.assertEqual(self.client.get('/api/projects/' + pid).json()['name'], 'My local project')
        response = self.client.put('/api/settings', json={'mesh_quality': 'draft', 'bake_texture': True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/api/settings').json()['mesh_quality'], 'draft')
        routes.init_db()  # Migration must be safe on the next launch.
        self.assertEqual(len(self.client.get('/api/projects').json()), 1)

    def test_direct_gemini_key_is_recognized_without_workshop_url(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'unit-test-no-network'}):
            self.assertIsNotNone(routes.get_gemini_client())
            self.assertTrue(self.client.get('/api/health').json()['gemini'])

    def test_workshop_credentials_still_work(self):
        with patch.dict(os.environ, {'GEMINI_WORKSHOP_API_KEY': 'unit-test', 'GEMINI_WORKSHOP_BASE_URL': 'https://example.invalid'}):
            self.assertIsNotNone(routes.get_gemini_client())

    def test_gemini_configuration_works_with_a_socks_proxy(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'proxy-configuration-test', 'ALL_PROXY': 'socks5://127.0.0.1:9'}):
            response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['gemini'])

    def test_engine_keeps_the_virtual_environment_interpreter_path(self):
        environment = self.root / 'venv' / 'bin'
        environment.mkdir(parents=True)
        interpreter = environment / 'python'
        interpreter.symlink_to(sys.executable)
        with patch.dict(os.environ, {'TRIPOSR_PYTHON': str(interpreter)}):
            configuration = mesh_service.local_configuration()
        self.assertEqual(configuration['python'], str(interpreter))
        self.assertNotEqual(configuration['python'], str(interpreter.resolve()))

    def test_invalid_input_returns_actionable_errors(self):
        response = self.client.post('/api/upload', files={'file': ('bad.png', b'not an image', 'image/png')})
        self.assertEqual(response.status_code, 400)
        for image in ('wrong', 'data:image/png;base64,%%%'):
            self.assertEqual(self.client.post('/api/mesh', json={'image': image}).status_code, 400)
        self.assertEqual(self.client.post('/api/mesh', json={'image': data_url(), 'texture_resolution': 99999}).status_code, 422)
        self.assertEqual(self.client.post('/api/projects', json={'settings_json': '{'}).status_code, 400)

    def test_missing_engine_never_returns_a_fake_plane(self):
        response = self.client.post('/api/mesh', json={'image': data_url()})
        self.assertEqual(response.status_code, 503)
        self.assertIn('Real 3D reconstruction', response.json()['detail'])
        self.assertEqual(self.client.get('/api/recovery').json()['glb_count'], 0)

    def test_missing_provider_does_not_change_saved_inputs(self):
        pid = self.client.post('/api/projects', json={'name': 'Keep me', 'prompt': 'original', 'image_data_url': data_url()}).json()['id']
        response = self.client.post('/api/generate', json={'prompt': 'new image'})
        self.assertEqual(response.status_code, 503)
        stored = self.client.get('/api/projects/' + pid).json()
        self.assertEqual(stored['prompt'], 'original')
        self.assertEqual(stored['image_data_url'], data_url())

    def test_gemini_requests_negative_prompt_and_both_modalities(self):
        buffer = io.BytesIO()
        Image.new('RGB', (8, 8), 'red').save(buffer, format='PNG')
        generate = AsyncMock(return_value=SimpleNamespace(parts=[SimpleNamespace(inline_data=SimpleNamespace(data=buffer.getvalue(), mime_type='image/png'))]))
        client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
        with patch.object(routes, 'get_gemini_client', return_value=client):
            response = self.client.post('/api/generate', json={'prompt': 'red chair', 'negative_prompt': 'blur', 'reference_image': data_url()})
        self.assertEqual(response.status_code, 200)
        call = generate.call_args.kwargs
        self.assertIn('blur', call['contents'][-1])
        self.assertEqual(call['config'].response_modalities, ['TEXT', 'IMAGE'])
        self.assertEqual(call['config'].image_config.aspect_ratio, '1:1')

    def test_provider_error_never_exposes_secret_exception_text(self):
        error = RuntimeError('secret-api-key-must-not-appear')
        error.code = 429
        generate = AsyncMock(side_effect=error)
        client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
        with patch.object(routes, 'get_gemini_client', return_value=client):
            response = self.client.post('/api/generate', json={'prompt': 'chair'})
        self.assertEqual(response.status_code, 429)
        self.assertNotIn('secret-api-key', response.text)

    def test_history_delete_is_persistent(self):
        pid = self.client.post('/api/projects', json={'name': 'History project'}).json()['id']
        entry = self.client.post(f'/api/projects/{pid}/history', data={'action': 'generate'}).json()['id']
        self.assertEqual(len(self.client.get(f'/api/projects/{pid}/history').json()), 1)
        self.assertEqual(self.client.delete(f'/api/projects/{pid}/history/{entry}').status_code, 200)
        self.assertEqual(self.client.get(f'/api/projects/{pid}/history').json(), [])
        self.assertEqual(self.client.delete('/api/projects/' + pid).status_code, 200)
        self.assertEqual(self.client.get('/api/projects/' + pid).status_code, 404)

    def test_saved_model_and_exports_survive_service_restart(self):
        service = self.app.state.reconstruction
        identifier = str(uuid.uuid4())
        service.model_path(identifier).write_bytes(model_data(textured=True))
        response = self.client.post('/api/projects', json={'name': 'With mesh', 'glb_id': identifier})
        self.assertEqual(response.status_code, 200)
        project = self.client.get('/api/projects/' + response.json()['id']).json()
        self.assertTrue(project['glb_available'])
        self.assertEqual(project['glb_id'], identifier)
        restarted = mesh_service.ReconstructionService(self.root)
        self.assertEqual(restarted.model_path(identifier).read_bytes(), model_data(textured=True))
        for format in ('glb', 'gltf', 'obj', 'stl'):
            with self.subTest(format=format):
                result = self.client.get(f'/api/export/{identifier}/{format}')
                self.assertEqual(result.status_code, 200, result.text[:300] if result.status_code != 200 else '')
                self.assertIn('attachment', result.headers['content-disposition'])
        self.assertEqual(self.client.get('/api/glb/invalid').status_code, 404)

    def wait_for_job(self, identifier):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            job = self.client.get('/api/mesh/' + identifier).json()
            if job['status'] in ('completed', 'failed'):
                return job
            self.assertEqual(self.client.get('/api/health').status_code, 200)
            time.sleep(0.02)
        self.fail('Model process did not finish')

    def fake_configuration(self):
        worker_dir = self.root / 'fake-engine'
        worker_dir.mkdir(exist_ok=True)
        (worker_dir / 'reconstruction_worker.py').write_text('''import argparse, trimesh, numpy as np
p=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--parameters');p.add_argument('--output');a=p.parse_args()
print('STUDIO_PROGRESS {"stage":"Fixture reconstruction","progress":65}',flush=True)
m=trimesh.creation.box();m.visual.vertex_colors=np.tile([25,120,220,255],(len(m.vertices),1));m.export(a.output)
''')
        return worker_dir, {'ready': True, 'python': sys.executable, 'source': str(self.root), 'model': str(self.root), 'background': str(self.root), 'hub_cache': str(self.root)}

    def test_job_progress_model_result_and_recovery_contract(self):
        worker_dir, config = self.fake_configuration()
        with patch.object(mesh_service, 'local_configuration', return_value=config), patch.object(mesh_service, 'ROOT', worker_dir):
            response = self.client.post('/api/mesh', json={'image': data_url(), 'mesh_quality': 'draft'})
            self.assertEqual(response.status_code, 202)
            job = self.wait_for_job(response.json()['id'])
        self.assertEqual(job['status'], 'completed', job.get('error'))
        self.assertEqual(job['progress'], 100)
        self.assertTrue(job['result']['watertight'])
        self.assertGreater(job['result']['faces'], 0)
        self.assertEqual(self.client.get('/api/glb/' + job['id']).status_code, 200)
        self.assertEqual(self.client.get(job['image_url']).status_code, 200)
        self.assertEqual(self.client.get('/api/recovery').json()['glb_ids'], [job['id']])

    def test_failed_process_preserves_source_for_retry(self):
        worker_dir, config = self.fake_configuration()
        (worker_dir / 'reconstruction_worker.py').write_text("import sys;print('STUDIO_ERROR not enough memory',flush=True);sys.exit(1)")
        with patch.object(mesh_service, 'local_configuration', return_value=config), patch.object(mesh_service, 'ROOT', worker_dir):
            response = self.client.post('/api/mesh', json={'image': data_url()})
            job = self.wait_for_job(response.json()['id'])
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(job['error'], 'not enough memory')
        self.assertEqual(self.client.get(job['image_url']).status_code, 200)
        self.assertEqual(self.client.get('/api/recovery').json()['glb_count'], 0)

    def test_restart_marks_unfinished_jobs_and_retains_input(self):
        service = self.app.state.reconstruction
        identifier = str(uuid.uuid4())
        service.write({'id': identifier, 'status': 'running', 'stage': 'Loading', 'progress': 10, 'created_at': '2026-10-02', 'result': None, 'error': None})
        (service.directory(identifier) / 'input.png').write_bytes(b'input retained')
        restarted = mesh_service.ReconstructionService(self.root)
        self.assertEqual(restarted.get(identifier)['status'], 'failed')
        self.assertIn('restarted', restarted.get(identifier)['error'])
        self.assertEqual((restarted.directory(identifier) / 'input.png').read_bytes(), b'input retained')


class FormatTests(unittest.TestCase):
    def test_exports_round_trip_with_geometry_and_textures(self):
        data = model_data(textured=True)
        self.assertTrue(validate_model(load_model(data))['watertight'])
        for format in ('glb', 'gltf', 'stl', 'obj'):
            result, mime, filename = export_model(data, format)
            self.assertTrue(result)
            if filename.endswith('.zip'):
                with zipfile.ZipFile(io.BytesIO(result)) as archive:
                    names = archive.namelist()
                    self.assertTrue(any(name.endswith('.gltf' if format == 'gltf' else '.obj') for name in names))
                    if format == 'gltf':
                        document = json.loads(archive.read('model.gltf'))
                        self.assertTrue(document.get('images'))
                        self.assertEqual(document['images'][0]['mimeType'], 'image/png')
                        self.assertIn('bufferView', document['images'][0])
                    else:
                        self.assertTrue(any(name.endswith('.png') for name in names), names)

    def test_stl_rejects_open_model_without_fabricating_geometry(self):
        mesh = trimesh.creation.box()
        mesh.update_faces(np.arange(len(mesh.faces) - 1))
        data = trimesh.Scene(mesh).export(file_type='glb')
        self.assertFalse(validate_model(load_model(data))['watertight'])
        with self.assertRaisesRegex(ValueError, 'watertight'):
            export_model(data, 'stl')
        self.assertEqual(export_model(data, 'glb')[0], data)

    def test_flat_and_nonfinite_models_are_rejected(self):
        mesh = trimesh.Trimesh(vertices=[[0,0,0],[1,0,0],[0,1,0]], faces=[[0,1,2]], process=False)
        with self.assertRaisesRegex(ValueError, 'flat'):
            validate_model(trimesh.Scene(mesh))
        mesh = trimesh.creation.box()
        mesh.vertices[0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, 'invalid'):
            validate_model(trimesh.Scene(mesh))


if __name__ == '__main__':
    unittest.main()
