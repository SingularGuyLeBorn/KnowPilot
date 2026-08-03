"use client";

/* eslint-disable react-hooks/purity -- r3f useFrame 故意突变轨道；Math.random 仅初始化 */
/**
 * 可复用的「太阳系」WebGL 场景：中心恒星 + 若干行星按轨道运行。
 * 用于主页展示核心模块/项目，每个行星可带标签（由覆盖在 Canvas 上的 HTML 渲染）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface PlanetData {
  id: string;
  label: string;
  color: string;
  orbitRadius: number;
  size: number;
  speed: number;
  initialAngle: number;
}

export interface SolarSystemProps {
  className?: string;
  planets?: PlanetData[];
  starColor?: string;
}

const DEFAULT_PLANETS: PlanetData[] = [
  { id: "blog", label: "博客", color: "#7d917f", orbitRadius: 1.8, size: 0.16, speed: 0.35, initialAngle: 0 },
  { id: "agent", label: "Agent", color: "#1f8a7a", orbitRadius: 2.6, size: 0.2, speed: 0.25, initialAngle: 1.2 },
  { id: "knowledge", label: "知识库", color: "#a89080", orbitRadius: 3.4, size: 0.14, speed: 0.18, initialAngle: 2.5 },
  { id: "skill", label: "Skills", color: "#c9b8b3", orbitRadius: 4.3, size: 0.12, speed: 0.12, initialAngle: 4.1 },
];

export function SolarSystem({ className, planets = DEFAULT_PLANETS, starColor = "#e8c4a0" }: SolarSystemProps) {
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 6, 10], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%" }}
      >
        <SolarSystemStage planets={planets} starColor={starColor} />
      </Canvas>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

function SolarSystemStage({ planets, starColor }: { planets: PlanetData[]; starColor: string }) {
  const reduced = usePrefersReducedMotion();
  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 4, 0]} intensity={1.6} color={starColor} />
      <directionalLight position={[-3, 2, 5]} intensity={0.5} color="#a8b5ad" />
      <Star centerColor={starColor} />
      {planets.map((p) => (
        <OrbitPlanet key={p.id} planet={p} reduced={reduced} />
      ))}
      <OrbitRings planets={planets} reduced={reduced} />
    </>
  );
}

function Star({ centerColor }: { centerColor: string }) {
  return (
    <mesh>
      <sphereGeometry args={[0.55, 48, 48]} />
      <meshStandardMaterial color={centerColor} emissive={centerColor} emissiveIntensity={0.85} roughness={0.4} />
      {/* 光晕 */}
    </mesh>
  );
}

function OrbitPlanet({ planet, reduced }: { planet: PlanetData; reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const planetRef = useRef<THREE.Mesh>(null);
  const angleRef = useRef(planet.initialAngle);

  useFrame((_, delta) => {
    if (!groupRef.current || reduced) return;
    angleRef.current += delta * planet.speed;
    const x = Math.cos(angleRef.current) * planet.orbitRadius;
    const z = Math.sin(angleRef.current) * planet.orbitRadius;
    groupRef.current.position.set(x, 0, z);
    if (planetRef.current) {
      planetRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group ref={groupRef} position={[Math.cos(planet.initialAngle) * planet.orbitRadius, 0, Math.sin(planet.initialAngle) * planet.orbitRadius]}>
      <mesh ref={planetRef}>
        <sphereGeometry args={[planet.size, 24, 24]} />
        <meshStandardMaterial color={planet.color} roughness={0.3} metalness={0.2} emissive={planet.color} emissiveIntensity={0.15} />
      </mesh>
      {/* 小卫星 */}
      <Satellite parentSize={planet.size} color={planet.color} reduced={reduced} />
    </group>
  );
}

function Satellite({ parentSize, color, reduced }: { parentSize: number; color: string; reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const angleRef = useRef(Math.random() * Math.PI * 2);
  useFrame((_, delta) => {
    if (!ref.current || reduced) return;
    angleRef.current += delta * 1.2;
    ref.current.position.x = Math.cos(angleRef.current) * parentSize * 1.8;
    ref.current.position.z = Math.sin(angleRef.current) * parentSize * 1.8;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[parentSize * 0.25, 12, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.7} />
    </mesh>
  );
}

function OrbitRings({ planets, reduced }: { planets: PlanetData[]; reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!groupRef.current || reduced) return;
    groupRef.current.rotation.y += delta * 0.015;
  });
  return (
    <group ref={groupRef} rotation={[-Math.PI / 2.4, 0, 0]}>
      {planets.map((p) => (
        <mesh key={p.id}>
          <ringGeometry args={[p.orbitRadius - 0.015, p.orbitRadius + 0.015, 128, 1]} />
          <meshBasicMaterial color={p.color} transparent opacity={0.12} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 太阳系场景外部渲染标签 hook：返回每个行星当前投影后的屏幕坐标，用于在 Canvas 上叠加 DOM 标签。
 * 注意：该 hook 只在客户端 Canvas 容器内使用，坐标基于容器大小而非窗口大小。
 */
export function useSolarSystemPositions(
  planets: PlanetData[] = DEFAULT_PLANETS,
  // 占位：标签坐标由 SolarSystemLabels 组件内部通过 r3f useThree 实时投影，hook 仅做初始计算。
): Record<string, { x: number; y: number }> {
  return useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    const now = Date.now() / 1000;
    for (const p of planets) {
      const angle = p.initialAngle + now * p.speed;
      out[p.id] = {
        x: 50 + Math.cos(angle) * (p.orbitRadius / 5) * 30,
        y: 50 + Math.sin(angle) * (p.orbitRadius / 5) * 30,
      };
    }
    return out;
  }, [planets]);
}
