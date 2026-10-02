import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Wand2, Loader2, Settings2 } from "lucide-react";
import { useState } from "react";
import { generateImage } from "@/lib/actions";

export function PromptBar() {
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const negativePrompt = useStore((s) => s.negativePrompt);
  const setNegativePrompt = useStore((s) => s.setNegativePrompt);
  const isGenerating = useStore((s) => s.isGenerating);
  const isMeshGenerating = useStore((s) => s.isMeshGenerating);
  const meshError = useStore((s) => s.meshError);
  const meshStage = useStore((s) => s.meshStage);
  const meshProgress = useStore((s) => s.meshProgress);
  const generateError = useStore((s) => s.generateError);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const meshInfo = useStore((s) => s.meshInfo);
  const backend = useStore((s) => s.settings.backend);
  const backends = useStore((s) => s.imageBackends);

  const [showNegative, setShowNegative] = useState(false);

  const handleGenerate = () => generateImage();

  return (
    <div className="border-t border-border bg-card p-3 space-y-3">
      {isGenerating && <p className="text-xs text-muted-foreground">Generating image…</p>}
      {isMeshGenerating && (
        <div role="status" className="space-y-1">
          <p className="text-xs text-muted-foreground">{meshStage}</p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(3, meshProgress)}%` }} />
          </div>
        </div>
      )}
      {meshError && <p role="alert" className="text-xs text-destructive">{meshError}</p>}

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
            disabled={isGenerating || isMeshGenerating}
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
            disabled={isGenerating || isMeshGenerating || !prompt.trim()}
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
        {!backends[backend === "local-stable-diffusion" ? "automatic1111" : backend] && <span>Image backend needs setup; import still works</span>}
      </div>
    </div>
  );
}
