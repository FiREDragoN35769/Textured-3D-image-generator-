import { Component, Suspense } from "react";
import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, Grid, OrbitControls, useGLTF } from "@react-three/drei";
import { useStore } from "@/lib/store";
import { Loader2 } from "lucide-react";

function Model({ id }: { id: string }) {
  const { scene } = useGLTF(`/api/glb/${id}`);
  return <Bounds fit clip observe margin={1.2}><Center><primitive object={scene} /></Center></Bounds>;
}

class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="p-6 text-sm text-destructive">The model could not be displayed; check the server connection or reopen the saved project.</p>
      : this.props.children;
  }
}

export function Viewer3D() {
  const id = useStore((state) => state.glbId);
  const generating = useStore((state) => state.isMeshGenerating);
  const stage = useStore((state) => state.meshStage);
  const zoom = useStore((state) => state.zoom);
  if (!id) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">
      <div className="text-center space-y-2 p-6">
        {generating && <Loader2 className="h-8 w-8 animate-spin mx-auto" />}
        <p>{generating ? stage : "No reconstructed model yet"}</p>
        {!generating && <p className="text-sm">Import or generate an image, then tap 3D.</p>}
      </div>
    </div>;
  }
  return <div className="h-full w-full" style={{ transform: `scale(${zoom})` }}>
    <ModelBoundary key={id}>
      <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">Loading model…</div>}>
        <Canvas camera={{ position: [2, 1.6, 2.5], fov: 50 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
          <ambientLight intensity={1.1} />
          <directionalLight position={[4, 6, 5]} intensity={2} />
          <directionalLight position={[-4, 2, -3]} intensity={1} />
          <Model id={id} />
          <Grid args={[8, 8]} position={[0, -0.75, 0]} cellSize={0.5} cellColor="#444" sectionColor="#666" fadeDistance={8} />
          <OrbitControls makeDefault enableDamping minDistance={0.1} maxDistance={20} />
        </Canvas>
      </Suspense>
    </ModelBoundary>
  </div>;
}
