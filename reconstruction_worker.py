"""TripoSR single-image inference, using installed local weights only."""
import argparse
import json
import os
import sys
from pathlib import Path


def progress(stage: str, value: int):
    print("STUDIO_PROGRESS " + json.dumps({"stage": stage, "progress": value}), flush=True)


def bake_colors(mesh, resolution: int):
    """Bake the model's vertex colors into a UV atlas without an OpenGL server."""
    import numpy as np
    import xatlas
    import trimesh
    from PIL import Image

    mapping, faces, uv = xatlas.parametrize(mesh.vertices.astype(np.float32), mesh.faces.astype(np.uint32))
    colors = np.asarray(mesh.visual.vertex_colors)[mapping, :3].astype(np.float32)
    texture = np.zeros((resolution, resolution, 3), dtype=np.uint8)
    pixels = uv * (resolution - 1)
    pixels[:, 1] = (resolution - 1) - pixels[:, 1]
    for face in faces:
        triangle = pixels[face]
        low = np.maximum(np.floor(triangle.min(axis=0)).astype(int), 0)
        high = np.minimum(np.ceil(triangle.max(axis=0)).astype(int), resolution - 1)
        xx, yy = np.meshgrid(np.arange(low[0], high[0] + 1), np.arange(low[1], high[1] + 1))
        a, b, c = triangle
        denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(denominator) < 1e-8:
            continue
        wa = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / denominator
        wb = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / denominator
        wc = 1 - wa - wb
        mask = (wa >= -0.025) & (wb >= -0.025) & (wc >= -0.025)
        rgb = np.clip(wa[..., None] * colors[face[0]] + wb[..., None] * colors[face[1]] + wc[..., None] * colors[face[2]], 0, 255)
        texture[yy[mask], xx[mask]] = rgb[mask].astype(np.uint8)
    result = trimesh.Trimesh(vertices=mesh.vertices[mapping], faces=faces, process=False)
    result.visual = trimesh.visual.texture.TextureVisuals(uv=uv, image=Image.fromarray(texture))
    return result


def reconstruct(input_path: Path, output_path: Path, parameters: dict):
    source = Path(os.environ["TRIPOSR_HOME"])
    model_dir = Path(os.environ["TRIPOSR_MODEL_DIR"])
    sys.path.insert(0, str(source))
    import numpy as np
    import torch
    import trimesh
    import rembg
    from PIL import Image
    # Use the same learned density field with a portable marching-cubes kernel.
    # This avoids requiring a C++/CUDA compiler on Windows or CPU-only machines.
    try:
        import torchmcubes
    except ImportError:
        from types import ModuleType
        from skimage.measure import marching_cubes
        kernel = ModuleType("torchmcubes")
        def portable_marching_cubes(volume, level):
            vertices, faces, _, _ = marching_cubes(volume.detach().cpu().numpy(), level=level)
            return torch.from_numpy(vertices.copy()), torch.from_numpy(faces.astype(np.int64))
        kernel.marching_cubes = portable_marching_cubes
        sys.modules["torchmcubes"] = kernel
    from tsr.system import TSR
    from tsr.utils import remove_background, resize_foreground

    requested = parameters.get("mesh_device", "auto")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was selected but no CUDA device is available. Choose Auto or CPU.")
    available = torch.cuda.is_available()
    enough_memory = available and torch.cuda.get_device_properties(0).total_memory >= 6 * 1024**3
    device = "cuda:0" if available and (requested == "cuda" or (requested == "auto" and enough_memory)) else "cpu"
    progress(f"Loading TripoSR on {device}", 10)
    model = TSR.from_pretrained(str(model_dir), config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(2048)
    model.to(device)
    model.eval()
    progress("Removing the image background", 25)
    session = rembg.new_session("u2netp", providers=["CPUExecutionProvider"])
    image = remove_background(Image.open(input_path).convert("RGBA"), session)
    image = resize_foreground(image, 0.85)
    rgba = np.asarray(image, dtype=np.float32) / 255.0
    rgb = rgba[:, :, :3] * rgba[:, :, 3:4] + (1 - rgba[:, :, 3:4]) * 0.5
    image = Image.fromarray((rgb * 255).astype(np.uint8))
    progress("Reconstructing the object volume", 40)
    with torch.no_grad():
        codes = model([image], device=device)
        progress("Extracting the 3D surface", 65)
        resolution = {"draft": 64, "balanced": 128, "high": 256}[parameters["mesh_quality"]]
        mesh = model.extract_mesh(codes, has_vertex_color=True, resolution=resolution)[0]
    if parameters.get("bake_texture", False):
        progress("Baking color into the texture atlas", 80)
        mesh = bake_colors(mesh, parameters.get("texture_resolution", 1024))
    # Fix normals and only small holes; never invent a replacement shape.
    if mesh.visual.kind != "texture":
        trimesh.repair.fix_normals(mesh, multibody=True)
        trimesh.repair.fill_holes(mesh)
    progress("Writing the reconstructed GLB", 95)
    # TripoSR uses Z-up (X back, Y right); glTF uses Y-up.
    mesh.apply_transform(np.array([[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 0], [0, 0, 0, 1]], dtype=float))
    output_path.write_bytes(trimesh.Scene(mesh).export(file_type="glb"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--parameters", type=Path, required=True)
    args = parser.parse_args()
    try:
        reconstruct(args.input, args.output, json.loads(args.parameters.read_text()))
    except Exception as error:
        import traceback
        traceback.print_exc()
        message = "The local reconstruction engine failed; your image is saved."
        if isinstance(error, (MemoryError, RuntimeError)):
            if "out of memory" in str(error).lower():
                message = "The model ran out of memory. Try Draft quality with CPU selected. Your image is saved."
            elif "CUDA was selected" in str(error):
                message = str(error)
        print("STUDIO_ERROR " + message, flush=True)
        sys.exit(1)
