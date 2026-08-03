"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const BLACK_HOLE_SHADER = {
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCamPos: { value: new THREE.Vector3(0, 0, 8) },
    uCamDir: { value: new THREE.Vector3(0, 0, -1) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec3 uCamPos;
    uniform vec3 uCamDir;
    uniform vec3 uCamUp;
    uniform vec3 uCamRight;
    varying vec2 vUv;

    #define PI 3.14159265359
    #define STEPS 120
    #define MAX_DIST 90.0
    #define BH_RADIUS 0.85
    #define DISK_INNER 2.0
    #define DISK_OUTER 9.0

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n = mix(
        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z
      );
      return n;
    }

    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
      }
      return v;
    }

    vec3 starfield(vec3 dir) {
      float n1 = noise(dir * 220.0);
      float bright1 = pow(n1, 22.0);
      float n2 = noise(dir * 75.0);
      float bright2 = pow(n2, 14.0);
      vec3 col = vec3(0.92, 0.96, 1.0) * bright1 * 3.0;
      col += vec3(0.75, 0.85, 1.0) * bright2 * 0.8;
      // faint nebula
      float neb = fbm(dir * 4.0 + uTime * 0.005);
      col += vec3(0.25, 0.08, 0.35) * smoothstep(0.45, 0.75, neb) * 0.18;
      return col;
    }

    float diskDensity(float r, float angle) {
      float radial = smoothstep(DISK_OUTER, DISK_INNER + 1.8, r) * smoothstep(DISK_INNER, DISK_INNER + 0.8, r);
      // faster, more pronounced spiral
      float spiral = sin(angle * 7.0 - r * 1.5 + uTime * 1.1);
      spiral = smoothstep(-0.25, 0.75, spiral);
      // turbulent gaps
      float turbulence = fbm(vec3(r * 0.45, angle * 1.5, uTime * 0.15));
      radial *= (0.5 + 0.5 * turbulence);
      return radial * (0.35 + 0.65 * spiral) * smoothstep(DISK_OUTER, DISK_OUTER - 2.5, r);
    }

    vec3 diskColor(float r, float density) {
      vec3 inner = vec3(1.0, 0.92, 0.55);
      vec3 mid = vec3(1.0, 0.5, 0.15);
      vec3 outer = vec3(0.75, 0.12, 0.35);
      float t = clamp((r - DISK_INNER) / (DISK_OUTER - DISK_INNER), 0.0, 1.0);
      vec3 col = mix(inner, mid, smoothstep(0.0, 0.42, t));
      col = mix(col, outer, smoothstep(0.42, 1.0, t));
      return col * density * 3.0;
    }

    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      uv.x *= uResolution.x / uResolution.y;

      vec3 ro = uCamPos;
      vec3 rd = normalize(uCamDir + uv.x * uCamRight * 0.52 + uv.y * uCamUp * 0.52);

      vec3 color = vec3(0.0);
      float travel = 0.0;
      float diskAlpha = 0.0;
      vec3 diskCol = vec3(0.0);

      for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * travel;
        float d = length(p);

        if (d < BH_RADIUS) {
          diskCol *= 0.0;
          break;
        }

        float bend = 1.45 / (d * d);
        rd = normalize(rd - normalize(p) * bend * 0.14);

        if (abs(p.y) < 0.22 && d > DISK_INNER && d < DISK_OUTER) {
          float r = length(p.xz);
          float angle = atan(p.z, p.x);
          float dens = diskDensity(r, angle);
          vec3 c = diskColor(r, dens);
          float alpha = dens * 0.10;
          diskCol = diskCol + c * alpha * (1.0 - diskAlpha);
          diskAlpha = min(diskAlpha + alpha, 1.0);
        }

        travel += max(0.12, d * 0.10);
        if (travel > MAX_DIST) break;
      }

      vec3 bgDir = normalize(ro + rd * MAX_DIST);
      color = starfield(bgDir) * (1.0 - diskAlpha) + diskCol;

      // horizon glow / photon ring
      float centerDist = length(uv * 8.0);
      float ring = 1.0 - smoothstep(BH_RADIUS * 1.25, BH_RADIUS * 2.2, centerDist);
      color += vec3(1.0, 0.75, 0.35) * ring * 0.18;
      // inner dark spot
      float shadow = 1.0 - smoothstep(BH_RADIUS * 0.7, BH_RADIUS * 1.15, centerDist);
      color *= 1.0 - shadow * 0.92;

      // subtle vignette
      float vig = 1.0 - dot(uv, uv) * 0.18;
      color *= vig;

      // tone map-ish contrast
      color = pow(color, vec3(0.92));
      color *= 1.15;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

function BlackHoleQuad() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  const camData = useMemo(() => {
    const camPos = new THREE.Vector3(0, 2.2, 9.5);
    const camTarget = new THREE.Vector3(0, 0, 0);
    const camDir = new THREE.Vector3().subVectors(camTarget, camPos).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const camRight = new THREE.Vector3().crossVectors(camDir, worldUp).normalize();
    const camUp = new THREE.Vector3().crossVectors(camRight, camDir).normalize();
    return { camPos, camDir, camUp, camRight };
  }, []);

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    const t = clock.getElapsedTime();
    materialRef.current.uniforms.uTime.value = t;
    materialRef.current.uniforms.uResolution.value.set(size.width, size.height);

    // slow camera orbit so motion is always visible
    const orbitAngle = t * 0.05;
    const radius = 9.5;
    const height = 2.2 + Math.sin(t * 0.11) * 0.6;
    const cx = Math.cos(orbitAngle) * radius;
    const cz = Math.sin(orbitAngle) * radius;
    camData.camPos.set(cx, height, cz);
    const target = new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3().subVectors(target, camData.camPos).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const trueUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    camData.camDir.copy(dir);
    camData.camRight.copy(right);
    camData.camUp.copy(trueUp);

    materialRef.current.uniforms.uCamPos.value.copy(camData.camPos);
    materialRef.current.uniforms.uCamDir.value.copy(camData.camDir);
    materialRef.current.uniforms.uCamUp.value.copy(camData.camUp);
    materialRef.current.uniforms.uCamRight.value.copy(camData.camRight);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={materialRef} args={[BLACK_HOLE_SHADER]} />
    </mesh>
  );
}

export function BlackHoleScene() {
  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-black md:h-[420px]">
      <Canvas
        gl={{ antialias: false, alpha: false }}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 1], fov: 75, near: 0.1, far: 10 }}
      >
        <BlackHoleQuad />
      </Canvas>
      <div className="pointer-events-none absolute bottom-3 left-4 text-[10px] font-medium tracking-wider text-white/40">
        Black Hole · 黑洞
      </div>
    </div>
  );
}
