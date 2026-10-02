# SourceForge component review — October 2, 2026

SourceForge provides further candidates beyond the two uploaded packages.
This quick review checks what each candidate could contribute to the existing app.
The links include the SourceForge listing and upstream documentation where available.
The user's requirement is a real image-to-mesh engine running offline on the
Note 20 Ultra itself. The initial component review did not establish that capability.

| Project | Verified capability | Fit for this app |
| --- | --- | --- |
| [Filament](https://sourceforge.net/projects/filament.mirror/) / [upstream](https://github.com/google/filament) | Android rendering engine with glTF loading. The supplied v1.77.2 native archive contains ARM64 libraries. | A useful foundation for a native Android model viewer. The current browser preview uses Three.js. |
| [Pixal3D](https://sourceforge.net/projects/pixal3d.mirror/) / [upstream](https://github.com/TencentARC/Pixal3D) | Image-to-GLB generation. The supplied Python source uses CUDA and omits pretrained weights. Current upstream also documents multi-view inference with camera transforms and separate weights. | A candidate for a higher-detail computer/server reconstruction backend. Benchmark its GPU requirements and output before integration; a complete Android runtime was not established. |
| [ncnn](https://sourceforge.net/projects/ncnn.mirror/) / [upstream](https://github.com/Tencent/ncnn) | Mobile neural-network inference with CPU/Vulkan support, Android builds, and PyTorch/ONNX conversion tools. | A candidate runtime for an Android port. A compatible reconstruction model, supported operators, mesh extraction, and phone memory/performance still need verification. |
| [ONNX Runtime](https://sourceforge.net/projects/onnx-runtime.mirror/) / [Android documentation](https://onnxruntime.ai/docs/tutorials/mobile/) | Native Android Java/C/C++ inference, CPU execution, quantization, and custom builds containing the required operators. | Strong first implementation target because split TripoSR ONNX graphs already exist and a first-hand mobile reconstruction demonstration uses this runtime. |
| [MNN](https://sourceforge.net/projects/mnn.mirror/) / [upstream](https://github.com/alibaba/MNN) | Android inference, ONNX conversion, transformer support, and FP16/int8 optimizations. | Worth comparing for reduced memory use after establishing a correct native reconstruction baseline; conversion and output quality have not been tested here. |
| [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d) | Single-image textured GLB generation; upstream documents CPU support and CUDA/MPS paths. Weights require gated Hugging Face access. | Another local reconstruction candidate to benchmark. An Android build was not verified in this review. |
| [Android 3D Model Viewer](https://sourceforge.net/projects/android-3d-model-viewer.mirror/) / [upstream](https://github.com/the3deer/android-3D-model-viewer) | Android model loading, display, and interaction. | Useful viewer reference for a native app. Image reconstruction would require an additional engine. |

## Application decision

Use the existing TripoSR reconstruction path added in commit `9d856ff` as the
desktop reference for validating the native engine's outputs.
It already has offline model setup, a CPU fallback, durable jobs, actual GLB preview,
and validated exports; its recorded real inference checks are in
[the repair verification](.workshop/verification.md).
That desktop implementation does not fulfill the phone-only requirement.

No complete on-device Android image-to-3D implementation was verified among this sample.
The current app uses a phone-friendly browser interface and runs reconstruction on the
computer/server hosting its backend.

## Phone engine follow-up

[A first-hand demonstration on Arm's developer site](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/can-mobile-phones-generate-a-3d-object-at-game-runtime-in-unity-here-is-what-actually-happens)
reports real on-device TripoSR reconstruction using separate ONNX stages, CPU
execution, selective MLP quantization, and host-side surface extraction. This is
relevant evidence of feasibility, not a benchmark of Nate's phone. The article's
reported timings must not be presented as Note 20 Ultra timings.

I inspected the actual encoder and decoder graph bytes from
[jc-builds/triposr-ios](https://huggingface.co/jc-builds/triposr-ios/tree/f0c7507db372e147d97f7d3e502d67b022a0c751),
pinned at `f0c7507db372e147d97f7d3e502d67b022a0c751`; I did not execute inference.
Despite the package name, these graphs use standard ONNX operators rather than
Apple-specific or CUDA custom operators. Both use opset 18 and float32 inputs.

| Inspected component | Interface | Verified storage / working tensor size |
| --- | --- | --- |
| Encoder | RGB `[1,3,512,512]` → scene codes `[1,3,40,64,64]` | 3,910,200-byte graph; external weights file 1,674,575,872 bytes |
| Decoder | Sampled features `[1,N,120]` → density/RGB `[1,N,4]` | 58,986-byte graph; external weights file 162,816 bytes |
| Scene codes | Encoder output retained after closing its session | 1,966,080 bytes at float32, calculated from the inspected output dimensions |
| Point features | A proposed batch of 2,048 query points | 983,040 bytes, calculated; batching has not been implemented here |
| Density volume | A proposed 128³ surface grid | 8,388,608 bytes, calculated; excludes mesh arrays and runtime overhead |

These are file sizes and individual tensor calculations, not measured peak RAM.
[Samsung's US specifications](https://news.samsung.com/us/samsung-unveils-five-devices-unpacked-galaxy-ecosystem-galaxy-note20-ultra-galaxy-z-fold2/)
list Snapdragon 865+ and 12 GB RAM for the Note20 Ultra. The OS and other apps use
part of that memory; phone execution remains unverified.

Concrete implementation target: remove the background locally, run the image
encoder, retain scene codes and release the encoder, sample features in bounded
batches, run the small decoder, and extract/export a real triangle mesh natively.
The native host must preserve [upstream renderer behavior](https://github.com/VAST-AI-Research/TripoSR/blob/main/tsr/models/nerf_renderer.py):
coordinate scaling, bilinear sampling with `align_corners=False`, density
activation/bias, color activation, and the surface threshold. The graph output
channels alone do not establish those semantics.
Filament can provide the Android preview. Begin with ONNX Runtime's native CPU
package and correct float32 outputs, then compare MNN or selective quantization.
Do not blindly convert the graph to FP16: [ONNX Runtime's documentation](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html)
notes CPU float16 limitations. Smaller weight storage alone does not establish
lower peak memory, compatible operators, or acceptable face/wing geometry.

The supplied Pixal3D CLI's `--low_vram` option still stages models onto CUDA and
states a 10–12 GB peak VRAM requirement. That optimization is not an Android
runtime. The supplied Filament package helps Android rendering, while native
inference and mesh extraction need the separate integration described above.

Acceptance for an Android test build: imported image → volumetric GLB in airplane
mode, no laptop/server calls, responsive progress, measured peak memory and
duration on the Note 20 Ultra, and independently reopened exports. Include the
user's character images when evaluating face, limbs, and thin wing detail.
No APK, quantized model, or device performance pass is claimed by this review.

## Fresh checks of the existing repair

On October 2, 2026, the API/format suite passed all 18 tests and the frontend suite
passed all five behavior checks against commit `9d856ff`; the production build also passed.
These regression checks use a substitute worker for expensive inference; this review
did not run Pixal3D or a new real-model benchmark.
