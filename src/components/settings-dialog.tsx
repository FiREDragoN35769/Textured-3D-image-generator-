import { useState } from "react";
import { useStore } from "@/lib/store";
import { requestJSON } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { AppSettings, HealthResponse, MeshParams } from "@/types";

function SettingsForm({ settings }: { settings: AppSettings }) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);
  const close = () => useStore.getState().setSettingsOpen(false);
  const save = async () => {
    setSaving(true);
    try {
      await requestJSON("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(local) });
      const store = useStore.getState();
      store.setSettings(local);
      store.setMeshParams(local);
      const health = await requestJSON<HealthResponse>("/api/health");
      store.setApiStatus(health.ok, !!health.db, !!health.gemini, health.image_backends, health.mesh?.ready);
      toast.success("Settings saved");
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save settings");
    } finally { setSaving(false); }
  };
  return <DialogContent className="max-w-lg">
    <DialogHeader><DialogTitle>Settings</DialogTitle><DialogDescription>Choose your image generator and 3D reconstruction quality.</DialogDescription></DialogHeader>
    <div className="space-y-5 max-h-[60vh] overflow-y-auto py-2">
      <div className="space-y-3">
        <Label>Image generator</Label>
        <Select value={local.backend === "local-stable-diffusion" ? "automatic1111" : local.backend} onValueChange={(backend) => setLocal({ ...local, backend })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="gemini">Gemini (Workshop or API key)</SelectItem><SelectItem value="automatic1111">Local Stable Diffusion</SelectItem></SelectContent>
        </Select>
        <Label htmlFor="image-model">Image model</Label>
        <Input id="image-model" value={local.model} onChange={(event) => setLocal({ ...local, model: event.target.value })} />
        <p className="text-xs text-muted-foreground">Local generation uses your installed checkpoint; importing images does not require Gemini.</p>
      </div>
      <Separator />
      <div className="space-y-3">
        <Label>3D reconstruction</Label>
        <p className="text-xs text-muted-foreground">TripoSR reconstructs a complete object from one image. The local engine must be installed before generation.</p>
        <Label>Quality</Label>
        <Select value={local.mesh_quality} onValueChange={(value) => setLocal({ ...local, mesh_quality: value as MeshParams["mesh_quality"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="draft">Draft (lowest memory)</SelectItem><SelectItem value="balanced">Balanced</SelectItem><SelectItem value="high">High detail</SelectItem></SelectContent>
        </Select>
        <Label>Compute device</Label>
        <Select value={local.mesh_device} onValueChange={(value) => setLocal({ ...local, mesh_device: value as MeshParams["mesh_device"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="auto">Auto</SelectItem><SelectItem value="cpu">CPU (slower)</SelectItem><SelectItem value="cuda">NVIDIA GPU</SelectItem></SelectContent>
        </Select>
        <div className="flex items-center justify-between"><Label>Bake texture atlas</Label><Switch checked={local.bake_texture} onCheckedChange={(bake_texture) => setLocal({ ...local, bake_texture })} /></div>
        <p className="text-xs text-muted-foreground">Off uses the reconstructed vertex colors; on embeds a UV texture for compatible editors.</p>
        {local.bake_texture && <Select value={String(local.texture_resolution)} onValueChange={(value) => setLocal({ ...local, texture_resolution: Number(value) })}>
          <SelectTrigger aria-label="Texture resolution"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="512">512 px</SelectItem><SelectItem value="1024">1024 px</SelectItem><SelectItem value="2048">2048 px</SelectItem></SelectContent>
        </Select>}
      </div>
      <Separator />
      <div className="space-y-2">
        <div className="flex items-center justify-between"><Label>Allow adult artistic content</Label><Switch checked={local.allow_adult_art} onCheckedChange={(allow_adult_art) => setLocal({ ...local, allow_adult_art })} /></div>
        <p className="text-xs text-muted-foreground">The selected image provider applies its own content rules.</p>
      </div>
    </div>
    <DialogFooter><Button variant="outline" onClick={close} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Settings"}</Button></DialogFooter>
  </DialogContent>;
}

export function SettingsDialog() {
  const open = useStore((store) => store.settingsOpen);
  const settings = useStore((store) => store.settings);
  return <Dialog open={open} onOpenChange={useStore.getState().setSettingsOpen}>{open && <SettingsForm settings={settings} />}</Dialog>;
}
