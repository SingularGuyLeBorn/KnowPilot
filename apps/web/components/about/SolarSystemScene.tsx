"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface PlanetData {
  name: string;
  color: string;
  size: number;
  distance: number;
  speed: number;
  hasRing?: boolean;
}

const PLANETS: PlanetData[] = [
  { name: "Mercury", color: "#a5a5a5", size: 0.38, distance: 6, speed: 4.15 },
  { name: "Venus", color: "#e3bb76", size: 0.95, distance: 9, speed: 1.62 },
  { name: "Earth", color: "#4f86f7", size: 1, distance: 13, speed: 1 },
  { name: "Mars", color: "#e27b58", size: 0.53, distance: 17, speed: 0.53 },
  { name: "Jupiter", color: "#c88b3a", size: 2.8, distance: 26, speed: 0.084 },
  { name: "Saturn", color: "#ead6b8", size: 2.4, distance: 36, speed: 0.034, hasRing: true },
  { name: "Uranus", color: "#d1f4fa", size: 1.6, distance: 46, speed: 0.012 },
  { name: "Neptune", color: "#5b5ddf", size: 1.5, distance: 56, speed: 0.006 },
];

function GlowTexture() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(255, 240, 200, 1)");
    grad.addColorStop(0.25, "rgba(255, 200, 80, 0.45)");
    grad.addColorStop(0.55, "rgba(255, 140, 30, 0.12)");
    grad.addColorStop(1, "rgba(255, 100, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

function Sun() {
  const meshRef = useRef<THREE.Mesh>(null);
  const glow = GlowTexture();
  useFrame(({ clock }) => {
    if (meshRef.current) meshRef.current.rotation.y = clock.getElapsedTime() * 0.08;
  });
  return (
    <group>
      <mesh ref={meshRef}>
        <sphereGeometry args={[2.2, 64, 64]} />
        <meshBasicMaterial color="#fdb813" toneMapped={false} />
      </mesh>
      <sprite scale={[12, 12, 1]} renderOrder={-1}>
        <spriteMaterial map={glow} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <pointLight intensity={1800} distance={220} decay={1.4} castShadow={false} />
    </group>
  );
}

function OrbitRing({ radius }: { radius: number }) {
  const points = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      arr.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return arr;
  }, [radius]);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="rgba(var(--kp-text-3-rgb), 0.2)" transparent opacity={0.25} />
    </line>
  );
}

function stringHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h / 100000;
}

function Planet({ data }: { data: PlanetData }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const angle = useRef(stringHash(data.name) * Math.PI * 2);
  useFrame((_, delta) => {
    angle.current += delta * data.speed * 0.08;
    if (groupRef.current) {
      groupRef.current.position.x = Math.cos(angle.current) * data.distance;
      groupRef.current.position.z = Math.sin(angle.current) * data.distance;
    }
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.4;
  });
  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} castShadow receiveShadow>
        <sphereGeometry args={[data.size, 32, 32]} />
        <meshStandardMaterial color={data.color} roughness={0.7} metalness={0.05} />
      </mesh>
      {data.hasRing && (
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <ringGeometry args={[data.size * 1.4, data.size * 2.2, 64]} />
          <meshBasicMaterial color="#cbb58a" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function StarField() {
  const ref = useRef<THREE.Points>(null);
  const [positions] = useState(() => {
    const arr = new Float32Array(2000 * 3);
    for (let i = 0; i < 2000; i++) {
      const r = 180 + Math.random() * 300;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.55} color="#ffffff" transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

function Controls() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 12;
    controls.maxDistance = 140;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    return () => controls.dispose();
  }, [camera, gl]);
  return null;
}

export function SolarSystemScene() {
  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-black md:h-[420px]">
      <Canvas
        camera={{ position: [0, 55, 75], fov: 45, near: 0.1, far: 1000 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={["#05060a"]} />
        <ambientLight intensity={0.05} />
        <Sun />
        <StarField />
        {PLANETS.map((p) => (
          <group key={p.name}>
            <OrbitRing radius={p.distance} />
            <Planet data={p} />
          </group>
        ))}
        <Controls />
      </Canvas>
      <div className="pointer-events-none absolute bottom-3 left-4 text-[10px] font-medium tracking-wider text-white/40">
        Solar System · 太阳系
      </div>
    </div>
  );
}
