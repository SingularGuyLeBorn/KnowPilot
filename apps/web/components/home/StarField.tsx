"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity -- r3f useFrame 故意突变相机/粒子 buffer；Math.random 仅粒子场初始化 */
/**
 * 首页 / About 共用 WebGL 背景：星尘 + 绿洲环 + 线框体 + 流星 + 指针视差。
 * 仅依赖 three + @react-three/fiber（无 drei）。尊重 prefers-reduced-motion。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export type StarFieldVariant = "home" | "about";

const STAR_COUNT = { home: 1600, about: 2000 } as const;
const DUST_COUNT = { home: 220, about: 320 } as const;

function createSoftTexture(color = "255,255,255") {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(0.35, `rgba(${color},0.45)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function spherePositions(count: number, rMin: number, rMax: number) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = rMin + Math.random() * (rMax - rMin);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    arr[i * 3 + 2] = radius * Math.cos(phi);
  }
  return arr;
}

function useThemeStarColor() {
  const [color, setColor] = useState("#a89080");
  useEffect(() => {
    const update = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setColor(isDark ? "#c9b8b3" : "#a89080");
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return color;
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

function PointerRig({ intensity = 1 }: { intensity?: number }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector2(0, 0));
  const current = useRef(new THREE.Vector2(0, 0));

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      target.current.set(x * 0.55 * intensity, -y * 0.35 * intensity);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [intensity]);

  useFrame((_, delta) => {
    current.current.lerp(target.current, Math.min(1, delta * 2.2));
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, current.current.x * 0.8, 0.08);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, current.current.y * 0.6, 0.08);
    camera.lookAt(0, 0, 0);
  });

  return null;
}

function TwinklingStars({ count, color }: { count: number; color: string }) {
  const ref = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const texture = useMemo(() => createSoftTexture("255,255,255"), []);
  const positions = useMemo(() => spherePositions(count, 4, 14), [count]);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.y = t * 0.018;
    ref.current.rotation.x = Math.sin(t * 0.07) * 0.08;
    if (matRef.current) {
      matRef.current.opacity = 0.72 + Math.sin(t * 1.1) * 0.14;
      matRef.current.size = 0.11 + Math.sin(t * 0.7) * 0.03;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={new THREE.BufferAttribute(positions, 3)} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.13}
        color={color}
        map={texture ?? undefined}
        transparent
        opacity={0.88}
        alphaTest={0.01}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

function NearDust({ count, color }: { count: number; color: string }) {
  const ref = useRef<THREE.Points>(null);
  const texture = useMemo(() => createSoftTexture("232,223,214"), []);
  const positions = useMemo(() => spherePositions(count, 1.2, 5.5), [count]);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y -= delta * 0.04;
      ref.current.rotation.z += delta * 0.01;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={new THREE.BufferAttribute(positions, 3)} />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        color={color}
        map={texture ?? undefined}
        transparent
        opacity={0.45}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

function OasisRings({ accent }: { accent: boolean }) {
  const g1 = useRef<THREE.Mesh>(null);
  const g2 = useRef<THREE.Mesh>(null);
  const g3 = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (g1.current) {
      g1.current.rotation.x = Math.PI / 2.4 + Math.sin(t * 0.2) * 0.08;
      g1.current.rotation.z += delta * 0.12;
    }
    if (g2.current) {
      g2.current.rotation.x = Math.PI / 2.1;
      g2.current.rotation.y += delta * 0.18;
    }
    if (g3.current) {
      g3.current.rotation.z -= delta * 0.09;
      g3.current.rotation.x = Math.PI / 2.6 + Math.cos(t * 0.15) * 0.1;
    }
  });

  const opacity = accent ? 0.28 : 0.18;
  const color = accent ? "#6e5c4a" : "#b8a090";

  return (
    <group position={[0.2, 0.15, -1.2]}>
      <mesh ref={g1}>
        <torusGeometry args={[2.1, 0.012, 8, 128]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh ref={g2} scale={[1.15, 1.15, 1.15]}>
        <torusGeometry args={[2.6, 0.008, 8, 140]} />
        <meshBasicMaterial color="#a89080" transparent opacity={opacity * 0.75} />
      </mesh>
      <mesh ref={g3} scale={[0.78, 0.78, 0.78]}>
        <torusGeometry args={[1.55, 0.01, 8, 96]} />
        <meshBasicMaterial color="#c9b8b3" transparent opacity={opacity * 0.9} />
      </mesh>
      {/* 见微之核 */}
      <mesh>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial
          color="#6e5c4a"
          emissive="#b8a090"
          emissiveIntensity={0.55}
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>
    </group>
  );
}

function WireOrbs({ about }: { about: boolean }) {
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (a.current) {
      a.current.rotation.y += delta * 0.07;
      a.current.rotation.z += delta * 0.02;
    }
    if (b.current) {
      b.current.rotation.y -= delta * 0.05;
      b.current.rotation.x += delta * 0.03;
    }
  });

  return (
    <>
      <mesh ref={a} position={[about ? 3.6 : 4.2, about ? -0.6 : -1.4, -5.5]} scale={about ? 2.1 : 2.5}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial
          color="#b8a090"
          roughness={0.3}
          metalness={0.2}
          wireframe
          transparent
          opacity={0.16}
        />
      </mesh>
      <mesh ref={b} position={[about ? -3.8 : -3.4, about ? 1.2 : 0.8, -7]} scale={about ? 1.4 : 1.2}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color="#c9b8b3"
          roughness={0.4}
          metalness={0.1}
          wireframe
          transparent
          opacity={0.12}
        />
      </mesh>
    </>
  );
}

function SoftNebula() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.x = Math.sin(t * 0.12) * 0.4;
    ref.current.position.y = Math.cos(t * 0.1) * 0.25;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.08 + Math.sin(t * 0.4) * 0.03;
  });
  return (
    <mesh ref={ref} position={[1.5, 0.4, -3]} scale={[4.5, 2.8, 1]}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial color="#d4c4be" transparent opacity={0.1} depthWrite={false} />
    </mesh>
  );
}

function ShootingStars({ active }: { active: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const count = 6;
  const data = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const life = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      life[i] = Math.random();
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = 2 + Math.random() * 6;
      pos[i * 3 + 2] = -4 - Math.random() * 6;
      vel[i * 3] = -4 - Math.random() * 3;
      vel[i * 3 + 1] = -2 - Math.random() * 2;
      vel[i * 3 + 2] = 1 + Math.random();
    }
    return { pos, vel, life };
  }, []);

  useFrame((_, delta) => {
    if (!active || !ref.current) return;
    const attr = ref.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      data.life[i] -= delta * 0.35;
      if (data.life[i] <= 0) {
        data.life[i] = 0.8 + Math.random() * 1.4;
        attr.array[i * 3] = 4 + Math.random() * 8;
        attr.array[i * 3 + 1] = 2 + Math.random() * 5;
        attr.array[i * 3 + 2] = -3 - Math.random() * 5;
      } else {
        attr.array[i * 3] += data.vel[i * 3] * delta;
        attr.array[i * 3 + 1] += data.vel[i * 3 + 1] * delta;
        attr.array[i * 3 + 2] += data.vel[i * 3 + 2] * delta;
      }
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={new THREE.BufferAttribute(data.pos, 3)} />
      </bufferGeometry>
      <pointsMaterial size={0.22} color="#6e5c4a" transparent opacity={0.75} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function Scene({ variant }: { variant: StarFieldVariant }) {
  const color = useThemeStarColor();
  const reduced = usePrefersReducedMotion();
  const about = variant === "about";

  return (
    <>
      <ambientLight intensity={1.35} />
      <directionalLight position={[6, 7, 5]} intensity={1.15} />
      <pointLight position={[-3, 2, 2]} intensity={0.45} color="#c9b8b3" />
      {!reduced && <PointerRig intensity={about ? 1.25 : 1} />}
      <SoftNebula />
      <TwinklingStars count={STAR_COUNT[variant]} color={color} />
      <NearDust count={DUST_COUNT[variant]} color={color} />
      <OasisRings accent={about} />
      <WireOrbs about={about} />
      {!reduced && <ShootingStars active />}
    </>
  );
}

export function StarField({
  className,
  variant = "home",
}: {
  className?: string;
  variant?: StarFieldVariant;
}) {
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 8], fov: variant === "about" ? 58 : 60 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%" }}
      >
        <Scene variant={variant} />
      </Canvas>
    </div>
  );
}
