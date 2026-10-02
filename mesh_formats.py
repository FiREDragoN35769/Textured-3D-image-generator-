"""Validate and export actual reconstruction geometry without replacing its shape."""
import io
import tempfile
import zipfile
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import trimesh


def load_model(data: bytes) -> trimesh.Scene:
    scene = trimesh.load(io.BytesIO(data), file_type="glb", force="scene")
    validate_model(scene)
    return scene


def validate_model(scene: trimesh.Scene) -> dict:
    parts = []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        geometry = scene.geometry[name]
        if not isinstance(geometry, trimesh.Trimesh) or not len(geometry.faces):
            continue
        if not np.isfinite(geometry.vertices).all():
            raise ValueError("The model contains invalid vertex coordinates.")
        if geometry.faces.min() < 0 or geometry.faces.max() >= len(geometry.vertices):
            raise ValueError("The model contains invalid triangle indices.")
        parts.append(geometry.copy().apply_transform(transform))
    if not parts:
        raise ValueError("The reconstruction returned no triangle geometry.")
    solid = trimesh.util.concatenate(parts)
    if not np.isfinite(solid.vertices).all() or solid.area <= 0:
        raise ValueError("The model contains invalid or empty geometry.")
    if np.linalg.matrix_rank(solid.vertices - solid.vertices.mean(axis=0)) < 3:
        raise ValueError("The model is a flat surface, not a reconstructed 3D object.")
    # Weld a copy for topology checks; leave UV seams/materials in the original.
    solid.merge_vertices(merge_tex=True, merge_norm=True)
    return {
        "vertices": sum(len(part.vertices) for part in parts),
        "faces": sum(len(part.faces) for part in parts),
        "watertight": bool(solid.is_watertight and solid.is_winding_consistent),
        "colored": any(part.visual.kind in ("texture", "vertex", "face") for part in parts),
    }


def validated_glb(scene: trimesh.Scene) -> bytes:
    data = scene.export(file_type="glb")
    load_model(data)
    return data


def archive(files: dict[str, bytes | str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as output:
        for name, content in files.items():
            output.writestr(name, content)
    return buffer.getvalue()


def export_model(data: bytes, file_format: str) -> tuple[bytes, str, str]:
    scene = load_model(data)
    info = validate_model(scene)
    if file_format == "glb":
        return data, "model/gltf-binary", "textured_model.glb"
    if file_format == "gltf":
        # Include every buffer and image referenced by the glTF document.
        files = scene.export(file_type="gltf")
        with tempfile_resolver(files) as path:
            loaded = trimesh.load(path, force="scene")
            validate_model(loaded)
        return archive(files), "application/zip", "textured_model_gltf.zip"
    mesh = scene.to_geometry()
    if file_format == "stl":
        if not info["watertight"]:
            raise ValueError("STL needs a watertight model. This mesh has open surfaces; use GLB or OBJ and repair those surfaces before printing.")
        mesh.merge_vertices(merge_tex=True, merge_norm=True)
        trimesh.repair.fix_normals(mesh, multibody=True)
        result = mesh.export(file_type="stl")
        reloaded = trimesh.load(io.BytesIO(result), file_type="stl", force="mesh")
        if not reloaded.is_watertight or not reloaded.is_winding_consistent:
            raise ValueError("STL validation failed after export.")
        return result, "model/stl", "textured_model.stl"
    if file_format == "obj":
        from trimesh.exchange.obj import export_obj
        obj, textures = export_obj(mesh, return_texture=True, write_texture=True)
        files = {"textured_model.obj": obj, **(textures or {})}
        with tempfile_resolver(files, "textured_model.obj") as path:
            validate_model(trimesh.load(path, force="scene"))
        return archive(files), "application/zip", "textured_model_obj.zip"
    raise ValueError("Choose GLB, glTF, STL, or OBJ.")


@contextmanager
def tempfile_resolver(files: dict, main: str = "model.gltf"):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for name, data in files.items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data.encode() if isinstance(data, str) else data)
        yield root / main
