"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface MoonData {
  name: string;
  size: number;
  distance: number;
  speed: number;
  color: string;
}

interface PlanetData {
  name: string;
  color: string;
  size: number;
  distance: number;
  speed: number;
  hasRing?: boolean;
  moons?: MoonData[];
}

const PLANETS: PlanetData[] = [
  { name: "Mercury", color: "#a5a5a5", size: 0.38, distance: 6, speed: 4.15 },
  { name: "Venus", color: "#e3bb76", size: 0.95, distance: 9, speed: 1.62 },
  {
    name: "Earth",
    color: "#4f86f7",
    size: 1,
    distance: 13,
    speed: 1,
    moons: [{ name: "Moon", size: 0.27, distance: 1.9, speed: 13.2, color: "#c4c4c4" }],
  },
  {
    name: "Mars",
    color: "#e27b58",
    size: 0.53,
    distance: 17,
    speed: 0.53,
    moons: [
      { name: "Phobos", size: 0.08, distance: 1.05, speed: 28, color: "#bfa08f" },
      { name: "Deimos", size: 0.06, distance: 1.45, speed: 12, color: "#bfa08f" },
    ],
  },
  {
    name: "Jupiter",
    color: "#c88b3a",
    size: 2.8,
    distance: 26,
    speed: 0.084,
    moons: [
      { name: "Io", size: 0.28, distance: 3.6, speed: 17, color: "#e8d08a" },
      { name: "Europa", size: 0.24, distance: 4.6, speed: 10, color: "#a8c4d0" },
      { name: "Ganymede", size: 0.32, distance: 5.8, speed: 6.5, color: "#9c9c9c" },
      { name: "Callisto", size: 0.29, distance: 7.2, speed: 3.8, color: "#7a7066" },
    ],
  },
  {
    name: "Saturn",
    color: "#ead6b8",
    size: 2.4,
    distance: 36,
    speed: 0.034,
    hasRing: true,
    moons: [
      { name: "Titan", size: 0.31, distance: 6.2, speed: 2.7, color: "#cfa868" },
      { name: "Rhea", size: 0.18, distance: 4.6, speed: 5.5, color: "#b8b8b8" },
    ],
  },
  { name: "Uranus", color: "#d1f4fa", size: 1.6, distance: 46, speed: 0.012 },
  { name: "Neptune", color: "#5b5ddf", size: 1.5, distance: 56, speed: 0.006 },
];

const ASTEROID_BELT = {
  inner: 19.5,
  outer: 23,
  count: 900,
  color: "#8c7e70",
};

function GlowTexture() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(255, 245, 210, 1)");
    grad.addColorStop(0.2, "rgba(255, 210, 90, 0.5)");
    grad.addColorStop(0.5, "rgba(255, 150, 40, 0.14)");
    grad.addColorStop(0.75, "rgba(255, 100, 20, 0.04)");
    grad.addColorStop(1, "rgba(255, 80, 0, 0)");
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
      <sprite scale={[14, 14, 1]} renderOrder={-1}>
        <spriteMaterial map={glow} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <pointLight intensity={2200} distance={260} decay={1.35} castShadow={false} />
    </group>
  );
}

function OrbitRing({ radius }: { radius: number }) {
  const points = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      arr.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return arr;
  }, [radius]);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  const material = useMemo(
    () => new THREE.LineBasicMaterial({ color: "rgba(var(--kp-text-3-rgb), 0.2)", transparent: true, opacity: 0.18 }),
    [],
  );
  return <primitive object={new THREE.Line(geometry, material)} />;
}

function AsteroidBelt() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { inner, outer, count } = ASTEROID_BELT;
  const data = useMemo(() => {
    const rand = makeSeededRandom(20260803);
    const positions: number[] = [];
    const speeds: number[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const r = inner + rand() * (outer - inner);
      const a = rand() * Math.PI * 2;
      positions.push(Math.cos(a) * r, (rand() - 0.5) * 0.6, Math.sin(a) * r);
      speeds.push((0.25 + rand() * 0.25) / Math.sqrt(r));
      sizes.push(0.06 + rand() * 0.11);
    }
    return { positions, speeds, sizes };
  }, [inner, outer, count]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < count; i++) {
      const x0 = data.positions[i * 3];
      const z0 = data.positions[i * 3 + 2];
      const r = Math.sqrt(x0 * x0 + z0 * z0);
      const baseAngle = Math.atan2(z0, x0);
      const angle = baseAngle + t * data.speeds[i];
      dummy.position.set(Math.cos(angle) * r, data.positions[i * 3 + 1], Math.sin(angle) * r);
      const s = data.sizes[i];
      dummy.scale.set(s, s, s);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={ASTEROID_BELT.color} roughness={0.9} metalness={0.05} />
    </instancedMesh>
  );
}

function stringHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h / 100000;
}

/** 简单 mulberry32 伪随机：保证 render 期间纯函数，避免 react-hooks/purity 报错 */
function makeSeededRandom(seed: number) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Moon({ data, planetAngle, planetDistance }: { data: MoonData; planetAngle: React.MutableRefObject<number>; planetDistance: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const moonAngle = useRef(stringHash(data.name) * Math.PI * 2);
  useFrame((_, delta) => {
    moonAngle.current += delta * data.speed * 0.08;
    if (!meshRef.current) return;
    const px = Math.cos(planetAngle.current) * planetDistance;
    const pz = Math.sin(planetAngle.current) * planetDistance;
    meshRef.current.position.x = px + Math.cos(moonAngle.current) * data.distance;
    meshRef.current.position.z = pz + Math.sin(moonAngle.current) * data.distance;
  });
  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <sphereGeometry args={[data.size, 16, 16]} />
      <meshStandardMaterial color={data.color} roughness={0.75} metalness={0.05} />
    </mesh>
  );
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
        <meshStandardMaterial color={data.color} roughness={0.65} metalness={0.08} />
      </mesh>
      {data.hasRing && (
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <ringGeometry args={[data.size * 1.5, data.size * 2.4, 96]} />
          <meshBasicMaterial color="#cbb58a" transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
      )}
      {data.moons?.map((m) => <Moon key={m.name} data={m} planetAngle={angle} planetDistance={data.distance} />)}
    </group>
  );
}

function StarField() {
  const ref = useRef<THREE.Points>(null);
  const [positions] = useState(() => {
    const arr = new Float32Array(2500 * 3);
    for (let i = 0; i < 2500; i++) {
      const r = 180 + Math.random() * 360;
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
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.5} color="#ffffff" transparent opacity={0.75} sizeAttenuation />
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
    controls.maxDistance = 180;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.2;
    return () => controls.dispose();
  }, [camera, gl]);
  return null;
}

export function SolarSystemScene() {
  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-black md:h-[420px]">
      <Canvas
        camera={{ position: [0, 65, 95], fov: 45, near: 0.1, far: 1200 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={["#05060a"]} />
        <ambientLight intensity={0.04} />
        <Sun />
        <StarField />
        <AsteroidBelt />
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
