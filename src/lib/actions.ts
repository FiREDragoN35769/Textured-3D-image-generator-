import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { checkedResponse, jsonPost, requestJSON } from "@/lib/api";
import type { GenerateResponse, MeshJob } from "@/types";

const message = (error: unknown) => error instanceof Error ? error.message : "Request failed";

export async function generateImage(enhance = false) {
  const store = useStore.getState();
  if (store.isGenerating || store.isMeshGenerating || !store.prompt.trim()) return;
  const prompt = store.prompt + (enhance ? ", highly detailed, sharp focus, professional quality" : "");
  store.setGenerating(true);
  store.setGenerateError(null);
  try {
    const data = await requestJSON<GenerateResponse>("/api/generate", jsonPost({
      prompt, negative_prompt: store.negativePrompt, model: store.settings.model,
      backend: store.settings.backend, reference_image: store.image,
    }));
    store.pushUndo();
    store.setPrompt(prompt);
    store.setImage(data.image);
    store.setLastElapsed(data.elapsed_ms);
    store.setViewMode("2d");
    if (store.projectId) {
      const form = new FormData();
      form.set("action", "generate");
      form.set("prompt", prompt);
      form.set("image_data_url", data.image);
      form.set("settings_json", JSON.stringify(store.settings));
      await requestJSON(`/api/projects/${store.projectId}/history`, { method: "POST", body: form })
        .catch(() => toast.error("Image generated; history could not be saved."));
    }
  } catch (error) {
    store.setGenerateError(message(error));
    toast.error(message(error));
  } finally {
    store.setGenerating(false);
  }
}

async function followJob(job: MeshJob) {
  const store = useStore.getState();
  // The server owns the job; polling never starts another reconstruction.
  while (job.status === "queued" || job.status === "running") {
    store.setMeshProgress(job.stage, job.progress);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    job = await requestJSON<MeshJob>(`/api/mesh/${job.id}`);
  }
  if (job.status !== "completed" || !job.result) throw new Error(job.error || "Reconstruction failed; your source image is saved.");
  store.pushUndo();
  store.setGlbId(job.result.glb_id);
  store.setMeshInfo(job.result);
  store.setMeshProgress(job.stage, 100);
  store.setViewMode("3d");
}

export async function buildMesh() {
  const store = useStore.getState();
  if (!store.image || store.isGenerating || store.isMeshGenerating) return;
  store.setMeshGenerating(true);
  store.setMeshError(null);
  store.setMeshProgress("Starting reconstruction", 0);
  try {
    const job = await requestJSON<MeshJob>("/api/mesh", jsonPost({ image: store.image, ...store.meshParams }));
    localStorage.setItem("studio-last-mesh-job", job.id);
    await followJob(job);
  } catch (error) {
    store.setMeshError(message(error));
    toast.error(message(error));
  } finally {
    store.setMeshGenerating(false);
  }
}

export async function recoverLastMesh() {
  const id = localStorage.getItem("studio-last-mesh-job");
  const store = useStore.getState();
  if (!id || store.image) return;
  let job: MeshJob;
  try {
    job = await requestJSON<MeshJob>(`/api/mesh/${id}`);
    const response = await checkedResponse(await fetch(job.image_url));
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(reader.result as string);
      response.blob().then((blob) => reader.readAsDataURL(blob)).catch(reject);
    });
    store.setImage(image);
    store.setMeshGenerating(true);
    await followJob(job);
  } catch (error) {
    store.setMeshError(message(error));
  } finally {
    store.setMeshGenerating(false);
  }
}

export async function exportMesh(format: "glb" | "gltf" | "stl" | "obj") {
  const id = useStore.getState().glbId;
  if (!id) return;
  try {
    const response = await checkedResponse(await fetch(`/api/export/${id}/${format}`));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = format === "gltf" || format === "obj" ? `textured_model_${format}.zip` : `textured_model.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    toast.error(message(error));
  }
}
