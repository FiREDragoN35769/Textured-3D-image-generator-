import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { Toolbar } from "@/components/toolbar";
import { Viewer2D } from "@/components/viewer-2d";
import { Viewer3D } from "@/components/viewer-3d";
import { PromptBar } from "@/components/prompt-bar";
import { AssistantPanel } from "@/components/assistant-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { HistoryPanel } from "@/components/history-panel";
import { ProjectsPanel } from "@/components/projects-panel";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import type { HealthResponse } from "./types";

function App() {
  const viewMode = useStore((s) => s.viewMode);
  const assistantOpen = useStore((s) => s.assistantOpen);
  const setApiStatus = useStore((s) => s.setApiStatus);
  const setSettings = useStore((s) => s.setSettings);
  const setMeshParams = useStore((s) => s.setMeshParams);

  // Check API health on mount
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: HealthResponse) => {
        setApiStatus(data.ok, data.db ?? false, data.gemini ?? false);
      })
      .catch(() => setApiStatus(false, false, false));
  }, [setApiStatus]);

  // Load saved settings
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setMeshParams({
          subdivisions: data.subdivisions,
          height_scale: data.height_scale,
          smooth: data.smooth,
        });
      })
      .catch(() => {});
  }, [setSettings, setMeshParams]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Toolbar */}
      <Toolbar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Viewer area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="relative flex-1 overflow-hidden">
            <div className={cn("absolute inset-0", viewMode === "2d" ? "block" : "hidden")}>
              <Viewer2D />
            </div>
            <div className={cn("absolute inset-0", viewMode === "3d" ? "block" : "hidden")}>
              <Viewer3D />
            </div>

            {/* View mode indicator */}
            <div className="pointer-events-none absolute top-2 left-2 z-10">
              <span className="rounded-md bg-background/80 px-2 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                {viewMode === "2d" ? "2D View" : "3D View"}
              </span>
            </div>

            {/* Zoom indicator */}
            <div className="pointer-events-none absolute top-2 right-2 z-10">
              <span className="rounded-md bg-background/80 px-2 py-1 text-xs font-mono text-muted-foreground backdrop-blur">
                {Math.round(useStore((s) => s.zoom) * 100)}%
              </span>
            </div>
          </div>

          {/* Prompt bar at bottom */}
          <PromptBar />
        </div>

        {/* Assistant panel (right side) */}
        {assistantOpen && (
          <div className="w-full sm:w-80 shrink-0">
            <AssistantPanel />
          </div>
        )}
      </div>

      {/* Dialogs and panels */}
      <SettingsDialog />
      <HistoryPanel />
      <ProjectsPanel />
      <Toaster position="bottom-center" theme="dark" />
    </div>
  );
}

export default App;
