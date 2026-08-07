"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const SEA_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vFoam;
  varying float vShore;

  // Gerstner wave: returns displacement; accumulates normal basis
  vec3 gerstner(
    vec3 pos,
    float amp,
    float wavelength,
    float speed,
    vec2 dir,
    float steep,
    inout vec3 tangent,
    inout vec3 binormal
  ) {
    float k = 6.28318530718 / wavelength;
    float c = sqrt(9.8 / k) * speed;
    vec2 d = normalize(dir);
    float f = k * (dot(d, pos.xz) - c * uTime * uMotion);
    float a = steep / k;
    float sa = sin(f);
    float ca = cos(f);

    tangent += vec3(
      -d.x * d.x * (steep * sa),
      d.x * (steep * ca),
      -d.x * d.y * (steep * sa)
    );
    binormal += vec3(
      -d.x * d.y * (steep * sa),
      d.y * (steep * ca),
      -d.y * d.y * (steep * sa)
    );

    return vec3(d.x * (a * ca), amp * sa, d.y * (a * ca));
  }

  void main() {
    // PlaneGeometry 在本地 XY；旋转后铺成 XZ 海面。波浪域用 xy。
    vec3 pos = position;
    vec3 domain = vec3(pos.x, 0.0, pos.y);
    float shore = smoothstep(-8.0, 6.0, domain.z);
    vShore = shore;
    float ampScale = mix(0.22, 1.0, shore);

    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 disp = vec3(0.0);

    disp += gerstner(domain, 0.28 * ampScale, 4.2, 1.05, vec2(1.0, 0.15), 0.32, tangent, binormal);
    disp += gerstner(domain, 0.16 * ampScale, 2.4, 1.2, vec2(0.7, 0.7), 0.28, tangent, binormal);
    disp += gerstner(domain, 0.12 * ampScale, 1.6, 1.35, vec2(-0.4, 0.9), 0.24, tangent, binormal);
    disp += gerstner(domain, 0.07 * ampScale, 0.9, 1.5, vec2(0.2, -1.0), 0.18, tangent, binormal);
    disp += gerstner(domain, 0.04 * ampScale, 0.55, 1.7, vec2(-0.85, 0.35), 0.14, tangent, binormal);

    // 本地：xy 为平面，位移 y 对应世界「上」需写到本地 z（配合 -X 旋转）
    pos.x += disp.x;
    pos.y += disp.z;
    pos.z += disp.y;
    vFoam = clamp(disp.y * 1.8 + 0.15, 0.0, 1.0);

    // 把 XZ 切线基转到本地 XY 平面空间
    vec3 tLocal = vec3(tangent.x, tangent.z, tangent.y);
    vec3 bLocal = vec3(binormal.x, binormal.z, binormal.y);
    vec3 objectNormal = normalize(cross(bLocal, tLocal));
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * objectNormal);

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SEA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vFoam;
  varying float vShore;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // depth / distance tint
    float depth = mix(0.15, 1.0, vShore);
    vec3 shallow = vec3(0.22, 0.55, 0.72);
    vec3 mid = vec3(0.08, 0.28, 0.48);
    vec3 deep = vec3(0.03, 0.12, 0.28);
    vec3 water = mix(deep, mid, smoothstep(0.0, 0.55, depth));
    water = mix(water, shallow, smoothstep(0.45, 1.0, depth) * 0.55);

    float ndotl = max(dot(N, L), 0.0);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);
    vec3 skyReflect = mix(vec3(0.95, 0.55, 0.35), vec3(0.35, 0.45, 0.75), N.y * 0.5 + 0.5);

    // sunset specular
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 96.0);
    vec3 sunCol = vec3(1.0, 0.72, 0.38);

    vec3 col = water * (0.35 + 0.65 * ndotl);
    col += skyReflect * fresnel * 0.55;
    col += sunCol * spec * 1.4;
    col += sunCol * fresnel * ndotl * 0.25;

    // crest foam
    float foam = smoothstep(0.55, 0.9, vFoam) * (0.55 + 0.45 * sin(vWorldPos.x * 8.0 + uTime * 2.0));
    col = mix(col, vec3(0.92, 0.95, 0.98), foam * 0.65);

    // slight vignette toward deep water
    col *= mix(0.85, 1.0, vShore);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDir = normalize(world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 zenith = vec3(0.12, 0.18, 0.42);
    vec3 horizon = vec3(0.95, 0.48, 0.28);
    vec3 dusk = vec3(0.55, 0.22, 0.35);
    vec3 col = mix(horizon, zenith, smoothstep(0.25, 0.95, h));
    col = mix(dusk, col, smoothstep(-0.1, 0.35, dir.y));

    // sun disc + glow
    float sun = max(dot(dir, normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.75, 0.4) * pow(sun, 256.0) * 2.2;
    col += vec3(1.0, 0.45, 0.2) * pow(sun, 12.0) * 0.55;
    col += vec3(0.95, 0.35, 0.25) * pow(sun, 3.0) * 0.25;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function DuskSky({ sunDir }: { sunDir: THREE.Vector3 }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSunDir: { value: sunDir.clone() } },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [sunDir],
  );

  useEffect(() => () => mat.dispose(), [mat]);

  return (
    <mesh>
      <sphereGeometry args={[40, 32, 16]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

function GerstnerSea({
  sunDir,
  motion,
}: {
  sunDir: THREE.Vector3;
  motion: number;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(28, 22, 144, 112), []);

  useEffect(() => () => geo.dispose(), [geo]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMotion: { value: motion },
      uSunDir: { value: sunDir.clone() },
    }),
    [sunDir, motion],
  );

  useFrame(({ clock }) => {
    if (!matRef.current) return;
    matRef.current.uniforms.uTime.value = clock.getElapsedTime();
    matRef.current.uniforms.uMotion.value = motion;
  });

  return (
    <mesh
      geometry={geo}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.35, -1.2]}
      frustumCulled={false}
    >
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={SEA_VERT}
        fragmentShader={SEA_FRAG}
      />
    </mesh>
  );
}

function DemandKick({ enabled }: { enabled: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (enabled) invalidate();
  }, [enabled, invalidate]);
  return null;
}

function Scene({ reducedMotion }: { reducedMotion: boolean }) {
  const sunDir = useMemo(() => new THREE.Vector3(0.55, 0.28, -0.75).normalize(), []);
  const { gl } = useThree();

  useEffect(() => {
    gl.setClearColor("#1a1020");
  }, [gl]);

  return (
    <>
      <DemandKick enabled={reducedMotion} />
      <DuskSky sunDir={sunDir} />
      <GerstnerSea sunDir={sunDir} motion={reducedMotion ? 0 : 1} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 4, -8]} intensity={1.1} color="#FFB06A" />
    </>
  );
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function useInViewPause(ref: { current: HTMLElement | null }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

export function SeasideCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const inView = useInViewPause(wrapRef);

  return (
    <div ref={wrapRef} className="absolute inset-0" aria-hidden>
      <Canvas
        className="h-full w-full"
        dpr={[1, 1.5]}
        frameloop={inView && !reducedMotion ? "always" : "demand"}
        camera={{ position: [0, 2.4, 6.2], fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <Scene reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
