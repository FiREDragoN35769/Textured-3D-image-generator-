"""Install the optional 3D engine once; later inference does not use the network."""
import argparse
import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVISION = "107cefdc244c39106fa830359024f6a2f1c78871"


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cpu", action="store_true", help="Use CPU PyTorch instead of NVIDIA CUDA.")
    parser.add_argument("--home", type=Path, default=ROOT / ".local3d")
    args = parser.parse_args()
    if not shutil.which("git"):
        raise SystemExit("Install Git before setting up the 3D engine.")
    home = args.home.resolve()
    source = home / "TripoSR"
    home.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        run("git", "clone", "https://github.com/VAST-AI-Research/TripoSR.git", source)
    run("git", "checkout", REVISION, cwd=source)
    environment = home / "venv"
    if not environment.exists():
        venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    index = "https://download.pytorch.org/whl/" + ("cpu" if args.cpu else "cu124")
    run(python, "-m", "pip", "install", "torch==2.6.0", "torchvision==0.21.0", "--index-url", index)
    run(python, "-m", "pip", "install", "-r", ROOT / "scripts/model-requirements.txt")
    env = os.environ.copy()
    env["U2NET_HOME"] = str(home / "models/rembg")
    run(python, "-c", """
import os
from pathlib import Path
from huggingface_hub import hf_hub_download
import rembg
root = Path(os.environ['U2NET_HOME']).parent
for filename in ('config.yaml', 'model.ckpt'):
    hf_hub_download('stabilityai/TripoSR', filename, local_dir=root / 'TripoSR', local_dir_use_symlinks=False)
hf_hub_download('facebook/dino-vitb16', 'config.json', cache_dir=root / 'hub')
rembg.new_session('u2netp', providers=['CPUExecutionProvider'])
print('Local model assets downloaded.')
""", env=env)
    # Import-check the complete environment before reporting setup success.
    run(python, "-c", "import torch, rembg, xatlas, trimesh; from skimage.measure import marching_cubes; from transformers.models.vit.modeling_vit import ViTModel")
    print("3D engine installed. Start the app, import an image, then choose 3D.")
    if home != ROOT / ".local3d":
        print(f"Set LOCAL_3D_HOME={home} on the app server.")


if __name__ == "__main__":
    main()
