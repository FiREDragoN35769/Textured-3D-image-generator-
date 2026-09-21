import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Wand2, Loader2, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function PromptBar() {
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const negativePrompt = useStore((s) => s.negativePrompt);
  const setNegativePrompt = useStore((s) => s.setNegativePrompt);
  const isGenerating = useStore((s) => s.isGenerating);
  const generateProgress = useStore((s) => s.generateProgress);
  const generateError = useStore((s) => s.generateError);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const meshInfo = useStore((s) => s.meshInfo);
  const geminiConnected = useStore((s) => s.geminiConnected);

  const [showNegative, setShowNegative] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("Enter a prompt first");
      return;
    }
    if (!geminiConnected) {
      toast.error("Gemini API not connected. Check your configuration.");
      return;
    }

    const store = useStore.getState();
    store.pushUndo();
    store.setGenerating(true);
    store.setGenerateError(null);
    store.setGenerateProgress(10);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negativePrompt,
          model: store.settings.model,
          reference_image: store.image,
        }),
      });
      store.setGenerateProgress(70);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      store.setImage(data.image);
      store.setLastElapsed(data.elapsed_ms);
      store.setGlbId(null);
      store.setMeshInfo(null);
      store.setGenerateProgress(100);

      if (store.projectId) {
        const fd = new FormData();
        fd.set("action", "generate");
        fd.set("prompt", prompt);
        fd.set("image_data_url", data.image);
        fd.set("settings_json", JSON.stringify(store.settings));
        fetch(`/api/projects/${store.projectId}/history`, { method: "POST", body: fd }).catch(() => {});
      }
    } catch (e) {
      store.setGenerateError(e instanceof Error ? e.message : "Generation failed");
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      store.setGenerating(false);
      store.setGenerateProgress(0);
    }
  };

  return (
    <div className="border-t border-border bg-card p-3 space-y-3">
      {/* Progress bar */}
      {isGenerating && generateProgress > 0 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${generateProgress}%` }}
          />
        </div>
      )}

      {/* Error */}
      {generateError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          {generateError}
        </div>
      )}

      {/* Mesh info */}
      {meshInfo && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Mesh: {meshInfo.vertices.toLocaleString()} verts, {meshInfo.faces.toLocaleString()} faces</span>
          <span>({meshInfo.elapsed_ms}ms)</span>
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex-1 space-y-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image you want to generate…"
            className="min-h-[60px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleGenerate();
              }
            }}
          />
          {showNegative && (
            <Input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="Negative prompt (what to avoid)…"
              className="text-sm"
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="h-auto"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Wand2 className="h-4 w-4 mr-1" />
            )}
            Generate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNegative(!showNegative)}
            className="text-xs"
          >
            {showNegative ? "Hide" : "Negative"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="text-xs"
          >
            <Settings2 className="h-3 w-3 mr-1" />
            Params
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>⌘/Ctrl + Enter to generate</span>
        {!geminiConnected && <span className="text-destructive">Gemini not connected</span>}
      </div>
    </div>
  );
}
