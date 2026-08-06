"use client";

/**
 * 首页底部 CTA 右侧：O×M 双星太阳系（R3F）
 * - 两颗恒星 + 行星 / 卫星 / 小行星带
 * - 行星文字一律胶囊标签（随相机缩放）
 * - OrbitControls：滚轮缩放、拖拽旋转
 * - 透明画布融入卡片白底
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { cn } from "@/lib/utils";

interface GardenNetworkProps {
  className?: string;
}

type Side = "o" | "m";

interface MoonData {
  size: number;
  distance: number;
  speed: number;
  color: string;
}

interface PlanetData {
  name: string;
  side: Side;
  color: string;
  size: number;
  distance: number;
  speed: number;
  hasRing?: boolean;
  moons?: MoonData[];
}

/** 公转偏慢，轨道拉开，避免团成一团 */
const ORBIT_SCALE = 0.032;
const BINARY_SPEED = 0.1;
const STAR_SEP = 3.2;

const PLANETS: PlanetData[] = [
  { name: "Text", side: "o", color: "#8a94a0", size: 0.34, distance: 11, speed: 2.4 },
  { name: "Agents", side: "m", color: "#e8a84a", size: 0.4, distance: 14.5, speed: 1.55 },
  {
    name: "Image",
    side: "o",
    color: "#5db3f0",
    size: 0.58,
    distance: 19,
    speed: 1,
    moons: [{ size: 0.16, distance: 1.4, speed: 7.5, color: "#c8ccd0" }],
  },
  {
    name: "Skills",
    side: "m",
    color: "#f0c078",
    size: 0.48,
    distance: 24,
    speed: 0.62,
  },
  {
    name: "Voice",
    side: "o",
    color: "#4f86f7",
    size: 0.52,
    distance: 30,
    speed: 0.38,
    moons: [
      { size: 0.1, distance: 1.1, speed: 11, color: "#bfa08f" },
      { size: 0.08, distance: 1.55, speed: 7, color: "#bfa08f" },
    ],
  },
  {
    name: "Memory",
    side: "m",
    color: "#d4923a",
    size: 1.05,
    distance: 38,
    speed: 0.14,
    moons: [
      { size: 0.14, distance: 2.0, speed: 6, color: "#e8d08a" },
      { size: 0.12, distance: 2.7, speed: 4, color: "#a8c4d0" },
    ],
  },
  {
    name: "Video",
    side: "o",
    color: "#0a4a85",
    size: 0.72,
    distance: 48,
    speed: 0.07,
    hasRing: true,
  },
  {
    name: "Tasks",
    side: "m",
    color: "#c9a06a",
    size: 0.68,
    distance: 58,
    speed: 0.04,
  },
];

const ASTEROID_BELT = { inner: 33, outer: 35.5, count: 420, color: "#b0a89c" };

const CAPSULE: Record<Side, string> = {
  o: "border border-[var(--kp-brand)]/35 bg-white/95 text-[var(--kp-brand-deep)] shadow-sm",
  m: "border border-[var(--kp-accent)]/40 bg-white/95 text-[var(--kp-accent-deep)] shadow-sm",
};

function stringHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h / 100000;
}

function makeSeededRandom(seed: number) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function useGlowTexture(inner: string, mid: string) {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.28, mid);
    grad.addColorStop(0.6, "rgba(255,255,255,0.06)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [inner, mid]);
}

/** 胶囊标签：Html + distanceFactor，滚轮放大时字号同步变大 */
function CapsuleLabel({
  text,
  side,
  primary = false,
  yOffset,
}: {
  text: string;
  side: Side;
  primary?: boolean;
  yOffset: number;
}) {
  return (
    <Html
      center
      distanceFactor={primary ? 26 : 32}
      position={[0, yOffset, 0]}
      style={{ pointerEvents: "none", userSelect: "none" }}
      zIndexRange={[20, 0]}
    >
      <span
        className={cn(
          "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 font-bold leading-none tracking-wide",
          primary ? "text-[12px]" : "text-[11px]",
          CAPSULE[side],
        )}
      >
        {text}
      </span>
    </Html>
  );
}

/** 球面贴图：高光底色 + 字母，随球体旋转才是真 3D 球 */
function useStarBallTexture(letter: string, top: string, mid: string, deep: string) {
  return useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(size * 0.34, size * 0.3, size * 0.05, size * 0.5, size * 0.5, size * 0.55);
    g.addColorStop(0, top);
    g.addColorStop(0.45, mid);
    g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "900 210px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, size * 0.5, size * 0.52);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, [letter, top, mid, deep]);
}

function StarBall({
  letter,
  side,
  radius,
  color,
  emissive,
  top,
  mid,
  deep,
  glowMap,
  lightColor,
  lightIntensity,
}: {
  letter: string;
  side: Side;
  radius: number;
  color: string;
  emissive: string;
  top: string;
  mid: string;
  deep: string;
  glowMap: THREE.Texture;
  lightColor: string;
  lightIntensity: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const map = useStarBallTexture(letter, top, mid, deep);

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.35;
  });

  return (
    <group>
      <mesh ref={meshRef} castShadow>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshStandardMaterial
          map={map}
          color={color}
          emissive={emissive}
          emissiveIntensity={0.45}
          roughness={0.38}
          metalness={0.12}
        />
      </mesh>
      <sprite scale={[radius * 5.2, radius * 5.2, 1]} renderOrder={-1}>
        <spriteMaterial map={glowMap} transparent opacity={0.55} depthWrite={false} />
      </sprite>
      <pointLight intensity={lightIntensity} distance={90} decay={1.5} color={lightColor} />
      <CapsuleLabel text={side === "o" ? "Omni" : "Multi"} side={side} primary yOffset={-(radius + 0.75)} />
    </group>
  );
}

function BinaryStars() {
  const groupRef = useRef<THREE.Group>(null);
  const oGlow = useGlowTexture("rgba(220,240,255,1)", "rgba(0,135,235,0.5)");
  const mGlow = useGlowTexture("rgba(255,248,220,1)", "rgba(232,168,74,0.55)");

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * BINARY_SPEED;
  });

  return (
    <group ref={groupRef}>
      <group position={[-STAR_SEP, 0, 0]}>
        <StarBall
          letter="O"
          side="o"
          radius={1.5}
          color="#dff0ff"
          emissive="#0087eb"
          top="#ffffff"
          mid="#5db3f0"
          deep="#065a9e"
          glowMap={oGlow}
          lightColor="#9ed0ff"
          lightIntensity={520}
        />
      </group>
      <group position={[STAR_SEP, 0, 0]}>
        <StarBall
          letter="M"
          side="m"
          radius={1.35}
          color="#fff6e8"
          emissive="#e8a84a"
          top="#fffaf0"
          mid="#f0c078"
          deep="#b5762a"
          glowMap={mGlow}
          lightColor="#ffe0a8"
          lightIntensity={460}
        />
      </group>
    </group>
  );
}

function OrbitRing({ radius }: { radius: number }) {
  const points = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      arr.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return arr;
  }, [radius]);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  const material = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#9ec9ee", transparent: true, opacity: 0.28 }),
    [],
  );
  return <primitive object={new THREE.Line(geometry, material)} />;
}

function AsteroidBelt() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { inner, outer, count } = ASTEROID_BELT;
  const data = useMemo(() => {
    const rand = makeSeededRandom(20260807);
    const positions: number[] = [];
    const speeds: number[] = [];
    const sizes: number[] = [];
    const spins: number[] = [];
    for (let i = 0; i < count; i++) {
      const r = inner + rand() * (outer - inner);
      const a = rand() * Math.PI * 2;
      positions.push(Math.cos(a) * r, (rand() - 0.5) * 0.5, Math.sin(a) * r);
      speeds.push((0.1 + rand() * 0.1) / Math.sqrt(r));
      sizes.push(0.045 + rand() * 0.08);
      spins.push(rand() * Math.PI * 2);
    }
    return { positions, speeds, sizes, spins };
  }, [inner, outer, count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < count; i++) {
      const x0 = data.positions[i * 3];
      const z0 = data.positions[i * 3 + 2];
      const r = Math.sqrt(x0 * x0 + z0 * z0);
      const angle = Math.atan2(z0, x0) + t * data.speeds[i];
      dummy.position.set(Math.cos(angle) * r, data.positions[i * 3 + 1], Math.sin(angle) * r);
      const s = data.sizes[i];
      dummy.scale.set(s, s, s);
      const spin = data.spins[i] + t * 0.12;
      dummy.rotation.set(spin, spin * 0.6, 0);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={ASTEROID_BELT.color} roughness={0.92} metalness={0.04} />
    </instancedMesh>
  );
}

function Moon({
  data,
  planetAngle,
  planetDistance,
}: {
  data: MoonData;
  planetAngle: React.MutableRefObject<number>;
  planetDistance: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const moonAngle = useRef(stringHash(`${data.color}-${data.distance}`) * Math.PI * 2);
  useFrame((_, delta) => {
    moonAngle.current += delta * data.speed * ORBIT_SCALE * 2.2;
    if (!meshRef.current) return;
    const px = Math.cos(planetAngle.current) * planetDistance;
    const pz = Math.sin(planetAngle.current) * planetDistance;
    meshRef.current.position.set(
      px + Math.cos(moonAngle.current) * data.distance,
      0,
      pz + Math.sin(moonAngle.current) * data.distance,
    );
  });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[data.size, 12, 12]} />
      <meshStandardMaterial color={data.color} roughness={0.78} metalness={0.05} />
    </mesh>
  );
}

function Planet({ data }: { data: PlanetData }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const angle = useRef(stringHash(data.name) * Math.PI * 2);

  useFrame((_, delta) => {
    angle.current += delta * data.speed * ORBIT_SCALE;
    if (groupRef.current) {
      groupRef.current.position.x = Math.cos(angle.current) * data.distance;
      groupRef.current.position.z = Math.sin(angle.current) * data.distance;
    }
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.28;
  });

  return (
    <>
      <group ref={groupRef}>
        <mesh ref={meshRef}>
          <sphereGeometry args={[data.size, 28, 28]} />
          <meshStandardMaterial color={data.color} roughness={0.6} metalness={0.1} />
        </mesh>
        {data.hasRing && (
          <mesh rotation={[Math.PI / 2.35, 0, 0]}>
            <ringGeometry args={[data.size * 1.4, data.size * 2.2, 72]} />
            <meshBasicMaterial color="#cbb58a" transparent opacity={0.45} side={THREE.DoubleSide} />
          </mesh>
        )}
        <CapsuleLabel text={data.name} side={data.side} yOffset={data.size + 0.72} />
      </group>
      {data.moons?.map((m, i) => (
        <Moon key={`${data.name}-m${i}`} data={m} planetAngle={angle} planetDistance={data.distance} />
      ))}
    </>
  );
}

function Controls() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 22;
    controls.maxDistance = 110;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.18;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minPolarAngle = Math.PI * 0.16;
    return () => controls.dispose();
  }, [camera, gl]);
  return null;
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.42} />
      <hemisphereLight args={["#ffffff", "#d8e6f5", 0.55]} />
      {/* 主光：照出球体明暗交界，避免扁圆片感 */}
      <directionalLight position={[12, 22, 16]} intensity={1.35} color="#ffffff" />
      <directionalLight position={[-10, 8, -6]} intensity={0.35} color="#cfe6ff" />
      <BinaryStars />
      <AsteroidBelt />
      {PLANETS.map((p) => (
        <group key={p.name}>
          <OrbitRing radius={p.distance} />
          <Planet data={p} />
        </group>
      ))}
      <Controls />
    </>
  );
}

export function GardenNetwork({ className = "" }: GardenNetworkProps) {
  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <Canvas
        camera={{ position: [0, 36, 56], fov: 40, near: 0.1, far: 400 }}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: false }}
        dpr={[1, 1.5]}
        style={{ background: "transparent", touchAction: "none" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
