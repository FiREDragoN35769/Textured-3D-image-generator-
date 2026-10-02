import { useStore } from "@/lib/store";
import { generateImage, buildMesh, exportMesh } from "@/lib/actions";
import { jsonPost, requestJSON } from "@/lib/api";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
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
          <span>{label}</span>
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

  const busy = store.isGenerating || store.isMeshGenerating;
  const [format, setFormat] = useState<"glb" | "gltf" | "stl" | "obj">("glb");
  const handleGenerate = () => generateImage();
  const handleMesh = () => store.glbId ? store.setViewMode("3d") : buildMesh();

  const handleSave = async () => {
    try {
      const data = await requestJSON<{ id: string }>("/api/projects", jsonPost({
        id: store.projectId, name: store.projectName, prompt: store.prompt,
        negative_prompt: store.negativePrompt, settings_json: JSON.stringify(store.settings),
        image_data_url: store.image, mesh_params_json: JSON.stringify(store.meshParams), glb_id: store.glbId,
      }));
      store.setProjectId(data.id);
      toast.success("Project saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the project");
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
        const data = await requestJSON<{image: string}>("/api/upload", { method: "POST", body: fd });
        store.setImage(data.image);
        store.setViewMode("2d");
        localStorage.removeItem("studio-last-mesh-job");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not import the image");
      }
    };
    input.click();
  };

  const handleZoomIn = () => store.setZoom(Math.min(store.zoom + 0.25, 4));
  const handleZoomOut = () => store.setZoom(Math.max(store.zoom - 0.25, 0.25));

  const handleEnhance = () => generateImage(true);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-card px-2 py-1.5">
        <ToolButton icon={<FilePlus className="h-4 w-4" />} label="New" onClick={() => store.newProject()} disabled={busy} />
        <ToolButton icon={<FolderOpen className="h-4 w-4" />} label="Open" onClick={handleOpen} disabled={busy} />
        <ToolButton icon={<Upload className="h-4 w-4" />} label="Import" onClick={handleImport} disabled={busy} />
        <ToolButton icon={<Save className="h-4 w-4" />} label="Save" onClick={handleSave} disabled={busy || (!store.image && !store.prompt)} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<Undo2 className="h-4 w-4" />} label="Undo" onClick={() => store.undo()} disabled={busy || !store.canUndo()} />
        <ToolButton icon={<Redo2 className="h-4 w-4" />} label="Redo" onClick={() => store.redo()} disabled={busy || !store.canRedo()} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<ImageIcon className="h-4 w-4" />} label="2D" onClick={() => store.setViewMode("2d")} active={store.viewMode === "2d"} />
        <ToolButton icon={<Box className="h-4 w-4" />} label="3D" onClick={handleMesh} active={store.viewMode === "3d"} disabled={busy || !store.image} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton
          icon={<Wand2 className="h-4 w-4" />}
          label="Generate"
          onClick={handleGenerate}
          disabled={busy || !store.prompt.trim()}
        />
        <ToolButton icon={<Pencil className="h-4 w-4" />} label="Edit" onClick={() => store.setViewMode("2d")} disabled={busy || !store.image} />
        {store.glbId && <ToolButton icon={<Box className="h-4 w-4" />} label="Rebuild 3D" onClick={buildMesh} disabled={busy || !store.image} />}
        <ToolButton icon={<RefreshCw className="h-4 w-4" />} label="Regenerate" onClick={handleGenerate} disabled={busy || !store.prompt.trim()} />
        <ToolButton icon={<Wand2 className="h-4 w-4" />} label="Enhance" onClick={handleEnhance} disabled={busy || !store.image} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<History className="h-4 w-4" />} label="History" onClick={() => store.setHistoryOpen(!store.historyOpen)} />
        <ToolButton icon={<ZoomOut className="h-4 w-4" />} label="Zoom Out" onClick={handleZoomOut} />
        <ToolButton icon={<ZoomIn className="h-4 w-4" />} label="Zoom In" onClick={handleZoomIn} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <Select value={format} onValueChange={(value) => setFormat(value as typeof format)}>
          <SelectTrigger className="w-24 h-8" aria-label="Export format"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="glb">GLB</SelectItem>
            <SelectItem value="gltf">glTF ZIP</SelectItem>
            <SelectItem value="stl">STL</SelectItem>
            <SelectItem value="obj">OBJ ZIP</SelectItem>
          </SelectContent>
        </Select>
        <ToolButton icon={<Download className="h-4 w-4" />} label="Export" onClick={() => exportMesh(format)} disabled={busy || !store.glbId} />

        <Separator orientation="vertical" className="mx-1 h-7" />

        <ToolButton icon={<Settings className="h-4 w-4" />} label="Settings" onClick={() => store.setSettingsOpen(true)} />
        <ToolButton icon={<Bot className="h-4 w-4" />} label="Assistant" onClick={() => store.setAssistantOpen(!store.assistantOpen)} />
      </div>
    </TooltipProvider>
  );
}
