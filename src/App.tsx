import { lazy, Suspense, useEffect } from "react";
import { useStore } from "@/lib/store";
import { Toolbar } from "@/components/toolbar";
import { Viewer2D } from "@/components/viewer-2d";
import { requestJSON } from "@/lib/api";
import { recoverLastMesh } from "@/lib/actions";
const Viewer3D = lazy(() => import("@/components/viewer-3d").then((module) => ({ default: module.Viewer3D })));
import { PromptBar } from "@/components/prompt-bar";
import { AssistantPanel } from "@/components/assistant-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { HistoryPanel } from "@/components/history-panel";
import { ProjectsPanel } from "@/components/projects-panel";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import type { AppSettings, HealthResponse } from "./types";

function App() {
  const viewMode = useStore((s) => s.viewMode);
  const assistantOpen = useStore((s) => s.assistantOpen);
  const setApiStatus = useStore((s) => s.setApiStatus);
  const setSettings = useStore((s) => s.setSettings);
  const setMeshParams = useStore((s) => s.setMeshParams);

  useEffect(() => {
    let active = true;
    Promise.all([requestJSON<HealthResponse>("/api/health"), requestJSON<AppSettings>("/api/settings")])
      .then(([health, settings]) => {
        if (!active) return;
        setApiStatus(health.ok, !!health.db, !!health.gemini, health.image_backends, health.mesh?.ready);
        setSettings(settings);
        setMeshParams({ mesh_quality: settings.mesh_quality, mesh_device: settings.mesh_device,
                        bake_texture: settings.bake_texture, texture_resolution: settings.texture_resolution });
        return recoverLastMesh();
      })
      .catch(() => { if (active) setApiStatus(false, false, false); });
    return () => { active = false; };
  }, [setApiStatus, setSettings, setMeshParams]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
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
              {viewMode === "3d" && <Suspense fallback={<div className="p-6 text-muted-foreground">Loading 3D viewer…</div>}><Viewer3D /></Suspense>}
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
          <div className="absolute inset-0 z-20 sm:relative sm:inset-auto sm:w-80 shrink-0">
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
