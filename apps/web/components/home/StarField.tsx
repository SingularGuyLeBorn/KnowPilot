"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STAR_COUNT = 1400;

import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function createStarTexture() {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.4)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function generatePositions(count: number) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = 4 + Math.random() * 12;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    arr[i * 3 + 2] = radius * Math.cos(phi);
  }
  return arr;
}

function Stars() {
  const ref = useRef<THREE.Points>(null);
  const [color, setColor] = useState("rgba(168, 144, 128)");
  const texture = useMemo(() => createStarTexture(), []);

  useEffect(() => {
    const update = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setColor(isDark ? "rgba(201, 184, 179)" : "rgba(168, 144, 128)");
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const [positions] = useState(() => generatePositions(STAR_COUNT));

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.025;
      ref.current.rotation.x += delta * 0.01;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <primitive
          attach="attributes-position"
          object={new THREE.BufferAttribute(positions, 3)}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.14}
        color={color}
        map={texture ?? undefined}
        transparent
        opacity={0.85}
        alphaTest={0.01}
        sizeAttenuation
      />
    </points>
  );
}

function Planet() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.06;
      ref.current.rotation.z += delta * 0.015;
    }
  });

  return (
    <mesh ref={ref} position={[4.2, -1.4, -6]} scale={2.6}>
      <icosahedronGeometry args={[1, 3]} />
      <meshStandardMaterial
        color="#b8a090"
        roughness={0.35}
        metalness={0.15}
        wireframe
        transparent
        opacity={0.14}
      />
    </mesh>
  );
}

export function StarField({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[6, 6, 6]} intensity={1.2} />
        <Stars />
        <Planet />
      </Canvas>
    </div>
  );
}
