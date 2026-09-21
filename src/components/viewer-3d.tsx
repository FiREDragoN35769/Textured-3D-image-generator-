import { useRef, useMemo, useEffect } from "react";
import { Canvas, useLoader, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Environment, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "@/lib/store";
import { Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Heightmap mesh: generates a displaced plane geometry from the image's
// luminance and applies the original image as a texture.
// ---------------------------------------------------------------------------

function HeightmapMesh({
  image,
  subdivisions,
  heightScale,
  smooth,
}: {
  image: string;
  subdivisions: number;
  heightScale: number;
  smooth: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Load texture from data URL
  const texture = useLoader(THREE.TextureLoader, image);
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }, [texture]);

  // Build displaced geometry
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2, subdivisions - 1, subdivisions - 1);
    return geo;
  }, [subdivisions]);

  // Displace vertices using image luminance
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const w = Math.min(subdivisions, 256);
      const h = w;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      const positions = geometry.attributes.position as THREE.BufferAttribute;
      const count = positions.count;

      for (let i = 0; i < count; i++) {
        const u = i % subdivisions;
        const v = Math.floor(i / subdivisions);
        // Sample the heightmap
        const sx = Math.min(w - 1, Math.floor((u / (subdivisions - 1)) * w));
        const sy = Math.min(h - 1, Math.floor((v / (subdivisions - 1)) * h));
        const idx = (sy * w + sx) * 4;
        const r = data[idx] / 255;
        const g = data[idx + 1] / 255;
        const b = data[idx + 2] / 255;
        let luminance = 0.299 * r + 0.587 * g + 0.114 * b;

        if (smooth) {
          // Simple 3x3 average
          let sum = luminance;
          let count2 = 1;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = Math.max(0, Math.min(w - 1, sx + dx));
              const ny = Math.max(0, Math.min(h - 1, sy + dy));
              const nidx = (ny * w + nx) * 4;
              sum += 0.299 * (data[nidx] / 255) + 0.587 * (data[nidx + 1] / 255) + 0.114 * (data[nidx + 2] / 255);
              count2++;
            }
          }
          luminance = sum / count2;
        }

        positions.setZ(i, luminance * heightScale);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
    };
    img.src = image;
  }, [image, subdivisions, heightScale, smooth, geometry]);

  useFrame(() => {
    if (meshRef.current) {
      // Gentle rotation hint
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2.2, 0, 0]} receiveShadow castShadow>
      <meshStandardMaterial
        map={texture}
        side={THREE.DoubleSide}
        roughness={0.7}
        metalness={0.1}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Main 3D viewer
// ---------------------------------------------------------------------------

export function Viewer3D() {
  const image = useStore((s) => s.image);
  const meshParams = useStore((s) => s.meshParams);
  const isMeshGenerating = useStore((s) => s.isMeshGenerating);
  const meshError = useStore((s) => s.meshError);
  const zoom = useStore((s) => s.zoom);

  if (!image) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <p className="text-lg">No image loaded</p>
          <p className="text-sm">Generate or import an image to see it in 3D.</p>
        </div>
      </div>
    );
  }

  if (isMeshGenerating) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Building 3D mesh…</p>
        </div>
      </div>
    );
  }

  if (meshError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2 max-w-md">
          <p className="text-lg text-destructive">Mesh Error</p>
          <p className="text-sm text-muted-foreground">{meshError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full" style={{ transform: `scale(${zoom})` }}>
      <Canvas
        shadows
        camera={{ position: [2, 2, 2.5], fov: 50 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[5, 5, 5]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-3, 2, -3]} intensity={0.4} />

        <HeightmapMesh
          image={image}
          subdivisions={meshParams.subdivisions}
          heightScale={meshParams.height_scale}
          smooth={meshParams.smooth}
        />

        <Grid
          args={[10, 10]}
          position={[0, -0.5, 0]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#444"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#666"
          fadeDistance={8}
          fadeStrength={1}
          infiniteGrid
        />

        <ContactShadows position={[0, -0.49, 0]} opacity={0.4} scale={6} blur={2} far={3} />

        <Environment preset="studio" />

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={1}
          maxDistance={10}
          maxPolarAngle={Math.PI / 1.8}
        />
      </Canvas>
    </div>
  );
}
