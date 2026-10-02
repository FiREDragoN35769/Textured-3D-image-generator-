# SourceForge component review — October 2, 2026

SourceForge provides further candidates beyond the two uploaded packages.
This quick review checks what each candidate could contribute to the existing app.
The links include the SourceForge listing and upstream documentation where available.

| Project | Verified capability | Fit for this app |
| --- | --- | --- |
| [Filament](https://sourceforge.net/projects/filament.mirror/) / [upstream](https://github.com/google/filament) | Android rendering engine with glTF loading. The supplied v1.77.2 native archive contains ARM64 libraries. | A useful foundation for a native Android model viewer. The current browser preview uses Three.js. |
| [Pixal3D](https://sourceforge.net/projects/pixal3d.mirror/) / [upstream](https://github.com/TencentARC/Pixal3D) | Image-to-GLB generation. The supplied Python source uses CUDA and omits pretrained weights. Current upstream also documents multi-view inference with camera transforms and separate weights. | A candidate for a higher-detail computer/server reconstruction backend. Benchmark its GPU requirements and output before integration; a complete Android runtime was not established. |
| [ncnn](https://sourceforge.net/projects/ncnn.mirror/) / [upstream](https://github.com/Tencent/ncnn) | Mobile neural-network inference with CPU/Vulkan support, Android builds, and PyTorch/ONNX conversion tools. | A candidate runtime for an Android port. A compatible reconstruction model, supported operators, mesh extraction, and phone memory/performance still need verification. |
| [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d) | Single-image textured GLB generation; upstream documents CPU support and CUDA/MPS paths. Weights require gated Hugging Face access. | Another local reconstruction candidate to benchmark. An Android build was not verified in this review. |
| [Android 3D Model Viewer](https://sourceforge.net/projects/android-3d-model-viewer.mirror/) / [upstream](https://github.com/the3deer/android-3D-model-viewer) | Android model loading, display, and interaction. | Useful viewer reference for a native app. Image reconstruction would require an additional engine. |

## Application decision

Keep the existing TripoSR reconstruction path added in commit `9d856ff`.
It already has offline model setup, a CPU fallback, durable jobs, actual GLB preview,
and validated exports; its recorded real inference checks are in
[the repair verification](.workshop/verification.md).
The SourceForge findings can guide later backend comparisons and a native Android port.

No complete on-device Android image-to-3D implementation was verified among this sample.
The current app uses a phone-friendly browser interface and runs reconstruction on the
computer/server hosting its backend.

## Fresh checks of the existing repair

On October 2, 2026, the API/format suite passed all 18 tests and the frontend suite
passed all five behavior checks against commit `9d856ff`; the production build also passed.
These regression checks use a substitute worker for expensive inference; this review
did not run Pixal3D or a new real-model benchmark.
