import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { AppSettings } from "@/types";

export function SettingsDialog() {
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setMeshParams = useStore((s) => s.setMeshParams);

  const [local, setLocal] = useState<AppSettings>(settings);

  useEffect(() => {
    if (settingsOpen) setLocal(settings);
  }, [settingsOpen, settings]);

  const handleSave = async () => {
    setSettings(local);
    setMeshParams({
      subdivisions: local.subdivisions,
      height_scale: local.height_scale,
      smooth: local.smooth,
    });
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(local),
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings to server");
    }
    setSettingsOpen(false);
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure generation backend, mesh parameters, and safety options.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto py-2">
          {/* Backend */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Generation Backend</Label>
            <Select value={local.backend} onValueChange={(v) => setLocal({ ...local, backend: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini">Gemini (Workshop managed)</SelectItem>
                <SelectItem value="local-stable-diffusion">Local Stable Diffusion (self-hosted)</SelectItem>
                <SelectItem value="comfyui">ComfyUI (self-hosted)</SelectItem>
                <SelectItem value="automatic1111">Automatic1111 (self-hosted)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Gemini is pre-configured. For local backends, run the server and configure its URL in your environment.
              No paid APIs or per-generation credits — all backends are open-source or self-hosted.
            </p>
          </div>

          <Separator />

          {/* Model */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Image Model</Label>
            <Select value={local.model} onValueChange={(v) => setLocal({ ...local, model: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini-3.1-flash-image">Gemini Flash Image (fast, default)</SelectItem>
                <SelectItem value="gemini-3.1-flash-lite-image">Gemini Flash Lite Image (cheapest)</SelectItem>
                <SelectItem value="gemini-3-pro-image">Gemini Pro Image (highest quality)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* 3D Mesh */}
          <div className="space-y-4">
            <Label className="text-sm font-semibold">3D Mesh Parameters</Label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Subdivisions</Label>
                <span className="text-xs font-mono text-muted-foreground">{local.subdivisions}</span>
              </div>
              <Slider
                value={[local.subdivisions]}
                onValueChange={([v]) => setLocal({ ...local, subdivisions: v })}
                min={32}
                max={256}
                step={16}
              />
              <p className="text-xs text-muted-foreground">Higher = more geometric detail. 128 is balanced.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Height Scale</Label>
                <span className="text-xs font-mono text-muted-foreground">{local.height_scale.toFixed(2)}</span>
              </div>
              <Slider
                value={[local.height_scale]}
                onValueChange={([v]) => setLocal({ ...local, height_scale: v })}
                min={0}
                max={1}
                step={0.05}
              />
              <p className="text-xs text-muted-foreground">How much depth to displace from luminance.</p>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs">Smooth heightmap</Label>
              <Switch
                checked={local.smooth}
                onCheckedChange={(v) => setLocal({ ...local, smooth: v })}
              />
            </div>
          </div>

          <Separator />

          {/* Safety */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Safety & Content Policy</Label>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Allow adult artistic content</Label>
                <p className="text-xs text-muted-foreground">
                  Permits lawful adult artistic nudity involving clearly adult fictional or consenting subjects.
                </p>
              </div>
              <Switch
                checked={local.allow_adult_art}
                onCheckedChange={(v) => setLocal({ ...local, allow_adult_art: v })}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Safety Mode</Label>
              <Select value={local.safety_mode} onValueChange={(v) => setLocal({ ...local, safety_mode: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (block minors, deepfakes, nonconsensual)</SelectItem>
                  <SelectItem value="strict">Strict (additional content filtering)</SelectItem>
                  <SelectItem value="permissive">Permissive (adult art allowed, core blocks enforced)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-destructive mb-1">Always blocked:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Minors and age-ambiguous subjects</li>
                <li>Nonconsensual imagery</li>
                <li>Explicit real-person deepfakes</li>
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
