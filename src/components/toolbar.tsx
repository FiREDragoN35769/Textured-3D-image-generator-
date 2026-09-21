import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  FilePlus,
  FolderOpen,
  Upload,
  Save,
  Undo2,
  Redo2,
  Image as ImageIcon,
  Box,
  Wand2,
  Pencil,
  RefreshCw,
  History,
  ZoomIn,
  ZoomOut,
  Download,
  Settings,
  Bot,
} from "lucide-react";

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

function ToolButton({ icon, label, onClick, disabled, active }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "flex-col h-auto py-1.5 px-3 gap-0.5 text-xs",
            active && "bg-accent text-accent-foreground",
          )}
          onClick={onClick}
          disabled={disabled}
        >
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function Toolbar() {
  const store = useStore();

  const handleGenerate = async () => {
    if (!store.prompt.trim()) {
      store.setGenerateError("Enter a prompt first.");
      return;
    }
    store.pushUndo();
    store.setGenerating(true);
    store.setGenerateError(null);
    store.setGenerateProgress(10);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: store.prompt,
          negative_prompt: store.negativePrompt,
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

      // Save to history
      if (store.projectId) {
        const fd = new FormData();
        fd.set("action", "generate");
        fd.set("prompt", store.prompt);
        fd.set("image_data_url", data.image);
        fd.set("settings_json", JSON.stringify(store.settings));
        fetch(`/api/projects/${store.projectId}/history`, { method: "POST", body: fd }).catch(() => {});
      }
    } catch (e) {
      store.setGenerateError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      store.setGenerating(false);
      store.setGenerateProgress(0);
    }
  };

  const handleMesh = async () => {
    if (!store.image) return;
    store.pushUndo();
    store.setMeshGenerating(true);
    store.setMeshError(null);

    try {
      const res = await fetch("/api/mesh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: store.image,
          subdivisions: store.meshParams.subdivisions,
          height_scale: store.meshParams.height_scale,
          smooth: store.meshParams.smooth,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      store.setGlbId(data.glb_id);
      store.setMeshInfo({ vertices: data.vertices, faces: data.faces, elapsed_ms: data.elapsed_ms });
      store.setViewMode("3d");
    } catch (e) {
      store.setMeshError(e instanceof Error ? e.message : "Mesh generation failed");
    } finally {
      store.setMeshGenerating(false);
    }
  };

  const handleExportGlb = () => {
    if (!store.glbId) return;
    window.open(`/api/glb/${store.glbId}`, "_blank");
  };

  const handleSave = async () => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: store.projectId,
          name: store.projectName,
          prompt: store.prompt,
          negative_prompt: store.negativePrompt,
          settings_json: JSON.stringify(store.settings),
          image_data_url: store.image,
          mesh_params_json: JSON.stringify(store.meshParams),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        store.setProjectId(data.id);
      }
    } catch {
      // ignore
    }
  };

  const handleOpen = () => {
    store.setProjectsOpen(!store.projectsOpen);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      store.pushUndo();
      const fd = new FormData();
      fd.set("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (res.ok) {
          const data = await res.json();
          store.setImage(data.image);
          store.setGlbId(null);
          store.setMeshInfo(null);
        }
      } catch {
        // ignore
      }
    };
    input.click();
  };

  const handleZoomIn = () => store.setZoom(Math.min(store.zoom + 0.25, 4));
  const handleZoomOut = () => store.setZoom(Math.max(store.zoom - 0.25, 0.25));

  const handleEnhance = async () => {
    if (!store.image) return;
    store.pushUndo();
    store.setPrompt(store.prompt + ", highly detailed, enhanced, sharp focus, professional quality");
    await handleGenerate();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-card px-2 py-1.5">
        <ToolButton icon={<FilePlus className="h-4 w-4" />} label="New" onClick={() => store.newProject()} />
        <ToolButton icon={<FolderOpen className="h-4 w-4" />} label="Open" onClick={handleOpen} />
        <ToolButton icon={<Upload className="h-4 w-4" />} label="Import" onClick={handleImport} />
        <ToolButton icon={<Save className="h-4 w-4" />} label="Save" onClick={handleSave} disabled={!store.image && !store.prompt} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<Undo2 className="h-4 w-4" />} label="Undo" onClick={() => store.undo()} disabled={!store.canUndo()} />
        <ToolButton icon={<Redo2 className="h-4 w-4" />} label="Redo" onClick={() => store.redo()} disabled={!store.canRedo()} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<ImageIcon className="h-4 w-4" />} label="2D" onClick={() => store.setViewMode("2d")} active={store.viewMode === "2d"} />
        <ToolButton icon={<Box className="h-4 w-4" />} label="3D" onClick={handleMesh} active={store.viewMode === "3d"} disabled={!store.image} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton
          icon={<Wand2 className="h-4 w-4" />}
          label="Generate"
          onClick={handleGenerate}
          disabled={store.isGenerating || !store.prompt.trim()}
        />
        <ToolButton icon={<Pencil className="h-4 w-4" />} label="Edit" onClick={() => store.setViewMode("2d")} disabled={!store.image} />
        <ToolButton icon={<RefreshCw className="h-4 w-4" />} label="Regenerate" onClick={handleGenerate} disabled={store.isGenerating || !store.prompt.trim()} />
        <ToolButton icon={<Wand2 className="h-4 w-4" />} label="Enhance" onClick={handleEnhance} disabled={!store.image} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<History className="h-4 w-4" />} label="History" onClick={() => store.setHistoryOpen(!store.historyOpen)} />
        <ToolButton icon={<ZoomOut className="h-4 w-4" />} label="Zoom Out" onClick={handleZoomOut} />
        <ToolButton icon={<ZoomIn className="h-4 w-4" />} label="Zoom In" onClick={handleZoomIn} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<Download className="h-4 w-4" />} label="Export GLB" onClick={handleExportGlb} disabled={!store.glbId} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<Settings className="h-4 w-4" />} label="Settings" onClick={() => store.setSettingsOpen(true)} />
        <ToolButton icon={<Bot className="h-4 w-4" />} label="Assistant" onClick={() => store.setAssistantOpen(!store.assistantOpen)} />
      </div>
    </TooltipProvider>
  );
}
