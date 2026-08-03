"use client";

/* eslint-disable react-hooks/purity -- r3f useFrame 故意突变粒子与几何体；Math.random 仅初始化 */
/**
 * 首页 / About 共用「黑洞吸积盘」WebGL 场景。
 * 仅依赖 three + @react-three/fiber（无 drei）。尊重 prefers-reduced-motion。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export function BlackHoleScene({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 9], fov: 55 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%" }}
      >
        <BlackHoleStage />
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

function BlackHoleStage() {
  const reduced = usePrefersReducedMotion();
  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 4, 6]} intensity={1.2} color="#c9b8b3" />
      <pointLight position={[-4, -2, 4]} intensity={0.6} color="#1f8a7a" />
      <BlackHoleCore />
      <AccretionDisk reduced={reduced} />
      <PhotonRing reduced={reduced} />
      <SpiralArmParticles reduced={reduced} />
    </>
  );
}

function BlackHoleCore() {
  return (
    <mesh>
      <sphereGeometry args={[0.85, 64, 64]} />
      <meshStandardMaterial color="#0b0f0d" roughness={0.1} metalness={0.6} />
    </mesh>
  );
}

function AccretionDisk({ reduced }: { reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useFrame((state, delta) => {
    if (!groupRef.current || reduced) return;
    groupRef.current.rotation.z += delta * 0.08;
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      colorInner: { value: new THREE.Color("#b8a090") },
      colorOuter: { value: new THREE.Color("#1f8a7a") },
    }),
    [],
  );

  return (
    <group ref={groupRef} rotation={[Math.PI / 2.2, 0, 0]}>
      <mesh>
        <ringGeometry args={[1.4, 4.2, 128, 1]} />
        <shaderMaterial
          ref={materialRef}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          uniforms={uniforms}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            uniform float time;
            uniform vec3 colorInner;
            uniform vec3 colorOuter;
            varying vec2 vUv;
            void main() {
              float r = vUv.x;
              float intensity = smoothstep(1.0, 0.2, abs(r - 0.35) * 2.0);
              intensity += 0.25 * sin(r * 40.0 - time * 2.0) * smoothstep(0.6, 0.2, r);
              float alpha = intensity * smoothstep(1.0, 0.15, r) * 0.55;
              vec3 color = mix(colorInner, colorOuter, pow(r, 0.7));
              gl_FragColor = vec4(color, alpha);
            }
          `}
        />
      </mesh>
    </group>
  );
}

function PhotonRing({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (!ref.current || reduced) return;
    ref.current.rotation.z -= delta * 0.12;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2.2, 0, 0]} scale={[1.05, 1.05, 1.05]}>
      <ringGeometry args={[1.1, 1.45, 128, 1]} />
      <meshBasicMaterial color="#c9b8b3" transparent opacity={0.18} side={THREE.DoubleSide} />
    </mesh>
  );
}

function SpiralArmParticles({ reduced }: { reduced: boolean }) {
  const count = 700;
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const t = Math.random() * Math.PI * 2;
      const r = 1.6 + Math.random() * 3.8;
      const spiral = t + r * 0.6;
      arr[i * 3] = Math.cos(spiral) * r;
      arr[i * 3 + 1] = Math.sin(spiral) * r * 0.16 * (Math.random() - 0.5);
      arr[i * 3 + 2] = Math.sin(spiral) * r;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (!ref.current || reduced) return;
    ref.current.rotation.y += delta * 0.04;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={new THREE.BufferAttribute(positions, 3)} />
      </bufferGeometry>
      <pointsMaterial size={0.035} color="#d4c4be" transparent opacity={0.6} sizeAttenuation depthWrite={false} />
    </points>
  );
}
