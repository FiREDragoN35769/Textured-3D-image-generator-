import { useStore } from "@/lib/store";
import { Loader2, ImageOff } from "lucide-react";

export function Viewer2D() {
  const image = useStore((s) => s.image);
  const isGenerating = useStore((s) => s.isGenerating);
  const generateError = useStore((s) => s.generateError);
  const lastElapsedMs = useStore((s) => s.lastElapsedMs);
  const zoom = useStore((s) => s.zoom);

  if (isGenerating) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Generating image…</p>
        </div>
      </div>
    );
  }

  if (generateError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center space-y-2 max-w-md">
          <p className="text-lg text-destructive font-medium">Generation Error</p>
          <p className="text-sm text-muted-foreground">{generateError}</p>
        </div>
      </div>
    );
  }

  if (!image) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center space-y-3">
          <ImageOff className="h-12 w-12 mx-auto opacity-40" />
          <p className="text-lg">No image yet</p>
          <p className="text-sm">Enter a prompt and generate, or import an image to begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      <div
        className="relative max-h-full max-w-full overflow-auto rounded-lg border border-border bg-background/50"
        style={{ imageRendering: zoom > 2 ? "pixelated" : "auto" }}
      >
        <img
          src={image}
          alt="Generated"
          className="block"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
        />
      </div>
      {lastElapsedMs > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Generated in {lastElapsedMs} ms
        </p>
      )}
    </div>
  );
}
