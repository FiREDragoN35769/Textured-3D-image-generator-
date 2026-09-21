import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FolderOpen, Trash2, Clock } from "lucide-react";
import type { ProjectRecord } from "@/types";
import { toast } from "sonner";

export function ProjectsPanel() {
  const projectsOpen = useStore((s) => s.projectsOpen);
  const setProjectsOpen = useStore((s) => s.setProjectsOpen);
  const projects = useStore((s) => s.projects);
  const setProjects = useStore((s) => s.setProjects);
  const setProjectId = useStore((s) => s.setProjectId);
  const setProjectName = useStore((s) => s.setProjectName);
  const setPrompt = useStore((s) => s.setPrompt);
  const setNegativePrompt = useStore((s) => s.setNegativePrompt);
  const setImage = useStore((s) => s.setImage);
  const setGlbId = useStore((s) => s.setGlbId);
  const setMeshInfo = useStore((s) => s.setMeshInfo);
  const setViewMode = useStore((s) => s.setViewMode);

  const loadProjects = () => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: ProjectRecord[]) => setProjects(data))
      .catch(() => {});
  };

  useEffect(() => {
    if (projectsOpen) loadProjects();
  }, [projectsOpen]);

  const handleOpen = async (project: ProjectRecord) => {
    setProjectId(project.id);
    setProjectName(project.name);
    setPrompt(project.prompt || "");
    setNegativePrompt(project.negative_prompt || "");
    setImage(project.image_data_url);
    setGlbId(null);
    setMeshInfo(null);
    setViewMode("2d");

    // Load mesh params if available
    if (project.mesh_params_json) {
      try {
        const params = JSON.parse(project.mesh_params_json);
        useStore.getState().setMeshParams(params);
      } catch { /* ignore */ }
    }

    setProjectsOpen(false);
    toast.success(`Opened "${project.name}"`);
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      setProjects(projects.filter((p) => p.id !== id));
      toast.success("Project deleted");
    } catch {
      toast.error("Failed to delete project");
    }
  };

  return (
    <Sheet open={projectsOpen} onOpenChange={setProjectsOpen}>
      <SheetContent side="left" className="w-full sm:w-96 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" />
            <SheetTitle>Open Project</SheetTitle>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-64px)] px-4 py-3">
          {projects.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No saved projects.</p>
              <p className="text-xs">Generate an image and click Save to create one.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-lg border border-border bg-card p-3 space-y-2 hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => handleOpen(project)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{project.name}</p>
                      {project.prompt && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {project.prompt}
                        </p>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-destructive"
                      onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {project.image_data_url && (
                    <img
                      src={project.image_data_url}
                      alt={project.name}
                      className="w-full rounded-md border border-border"
                    />
                  )}

                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(project.updated_at).toLocaleDateString()} {new Date(project.updated_at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
