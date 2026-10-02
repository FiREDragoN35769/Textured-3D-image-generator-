import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { History, RotateCcw, Trash2 } from "lucide-react";
import type { HistoryEntry } from "@/types";
import { requestJSON } from "@/lib/api";
import { toast } from "sonner";

export function HistoryPanel() {
  const historyOpen = useStore((s) => s.historyOpen);
  const setHistoryOpen = useStore((s) => s.setHistoryOpen);
  const projectId = useStore((s) => s.projectId);
  const setImage = useStore((s) => s.setImage);
  const setPrompt = useStore((s) => s.setPrompt);
  const setGlbId = useStore((s) => s.setGlbId);
  const setMeshInfo = useStore((s) => s.setMeshInfo);
  const historyEntries = useStore((s) => s.historyEntries);
  const setHistoryEntries = useStore((s) => s.setHistoryEntries);

  useEffect(() => {
    if (historyOpen && projectId) {
      requestJSON<HistoryEntry[]>(`/api/projects/${projectId}/history`)
        .then((entries: HistoryEntry[]) => setHistoryEntries(entries))
        .catch((error) => toast.error(error.message));
    }
  }, [historyOpen, projectId, setHistoryEntries]);

  const handleRestore = (entry: HistoryEntry) => {
    if (entry.image_data_url) {
      setImage(entry.image_data_url);
      setGlbId(null);
      setMeshInfo(null);
    }
    if (entry.prompt) setPrompt(entry.prompt);
  };

  const handleDelete = async (entryId: string) => {
    try {
      await requestJSON(`/api/projects/${projectId}/history/${entryId}`, { method: "DELETE" });
      setHistoryEntries(historyEntries.filter((e) => e.id !== entryId));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete history"); }
  };

  return (
    <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
      <SheetContent side="right" className="w-full sm:w-96 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <SheetTitle>History</SheetTitle>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-64px)] px-4 py-3">
          {historyEntries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No history yet.</p>
              <p className="text-xs">Generate images to build history.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {historyEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-border bg-card p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {entry.action}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.created_at).toLocaleTimeString()}
                    </span>
                  </div>

                  {entry.prompt && (
                    <p className="text-sm line-clamp-2">{entry.prompt}</p>
                  )}

                  {entry.image_data_url && (
                    <img
                      src={entry.image_data_url}
                      alt="History"
                      className="w-full rounded-md border border-border"
                    />
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleRestore(entry)}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive"
                      onClick={() => handleDelete(entry.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
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
