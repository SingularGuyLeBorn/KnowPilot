"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const COUNT = 120;
const RADIUS = 5;
const CONNECTION_DISTANCE = 1.45;
const MAX_CONNECTIONS = 3;

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function Glow() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (meshRef.current) {
      const pulse = 1 + Math.sin(clock.getElapsedTime() * 0.8) * 0.04;
      meshRef.current.scale.setScalar(pulse);
    }
  });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1.1, 32, 32]} />
      <meshBasicMaterial color="#1f8a7a" transparent opacity={0.12} depthWrite={false} />
    </mesh>
  );
}

function Particles() {
  const pointsRef = useRef<THREE.Points>(null);
  const { positions, sizes, phases } = useMemo(() => {
    const rand = seededRandom(42);
    const pos = new Float32Array(COUNT * 3);
    const sz = new Float32Array(COUNT);
    const ph = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const r = RADIUS * (0.35 + 0.65 * Math.sqrt(rand()));
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.65;
      pos[i * 3 + 2] = r * Math.cos(phi);
      sz[i] = 0.04 + rand() * 0.08;
      ph[i] = rand() * Math.PI * 2;
    }
    return { positions: pos, sizes: sz, phases: ph };
  }, []);

  useFrame(({ clock }) => {
    if (!pointsRef.current) return;
    const t = clock.getElapsedTime();
    const sizeAttr = pointsRef.current.geometry.attributes.size as THREE.BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * 1.5 + phases[i]);
      sizeAttr.setX(i, sizes[i] * (0.65 + 0.7 * twinkle));
    }
    sizeAttr.needsUpdate = true;
    pointsRef.current.rotation.y = t * 0.012;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        color="#3a4f40"
        size={0.06}
        transparent
        opacity={0.85}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function Connections() {
  const lineRef = useRef<THREE.LineSegments>(null);
  const { positions } = useMemo(() => {
    const rand = seededRandom(42);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < COUNT; i++) {
      const r = RADIUS * (0.35 + 0.65 * Math.sqrt(rand()));
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      pts.push(
        new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.sin(phi) * Math.sin(theta) * 0.65,
          r * Math.cos(phi),
        ),
      );
    }
    const segments: number[] = [];
    for (let i = 0; i < COUNT; i++) {
      let connections = 0;
      for (let j = i + 1; j < COUNT; j++) {
        if (pts[i].distanceTo(pts[j]) < CONNECTION_DISTANCE) {
          segments.push(i, j);
          connections++;
          if (connections >= MAX_CONNECTIONS) break;
        }
      }
    }
    const linePositions = new Float32Array(segments.length * 3);
    for (let k = 0; k < segments.length; k++) {
      const p = pts[segments[k]];
      linePositions[k * 3] = p.x;
      linePositions[k * 3 + 1] = p.y;
      linePositions[k * 3 + 2] = p.z;
    }
    return { positions: linePositions };
  }, []);

  useFrame(({ clock }) => {
    if (!lineRef.current) return;
    const t = clock.getElapsedTime();
    const material = lineRef.current.material as THREE.LineBasicMaterial;
    material.opacity = 0.12 + 0.06 * Math.sin(t * 0.7);
  });

  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#7d917f" transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 4]} intensity={0.5} color="#f3f5f2" />
      <Glow />
      <Connections />
      <Particles />
    </>
  );
}

export function GardenConstellation({ className = "" }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!mounted) {
    return <div className={`${className} bg-transparent`} aria-hidden />;
  }

  return (
    <div className={`${className}`} aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 7.5], fov: 55, near: 0.1, far: 25 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        dpr={[1, 1.5]}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
