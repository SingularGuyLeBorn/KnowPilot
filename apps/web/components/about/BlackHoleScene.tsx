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
    #define STEPS 96
    #define MAX_DIST 80.0
    #define BH_RADIUS 0.9
    #define DISK_INNER 2.2
    #define DISK_OUTER 8.0

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

    vec3 starfield(vec3 dir) {
      float n = noise(dir * 180.0);
      float bright = pow(n, 18.0);
      vec3 col = vec3(0.92, 0.96, 1.0) * bright * 2.5;
      col += vec3(0.6, 0.75, 1.0) * pow(noise(dir * 60.0), 12.0) * 0.6;
      return col;
    }

    float diskDensity(float r, float angle) {
      float radial = smoothstep(DISK_OUTER, DISK_INNER + 1.5, r) * smoothstep(DISK_INNER, DISK_INNER + 0.6, r);
      float spiral = sin(angle * 6.0 - r * 1.2 + uTime * 0.35);
      spiral = smoothstep(-0.3, 0.7, spiral);
      return radial * (0.4 + 0.6 * spiral) * smoothstep(DISK_OUTER, DISK_OUTER - 2.0, r);
    }

    vec3 diskColor(float r, float density) {
      vec3 inner = vec3(1.0, 0.85, 0.4);
      vec3 mid = vec3(1.0, 0.45, 0.15);
      vec3 outer = vec3(0.7, 0.15, 0.35);
      float t = clamp((r - DISK_INNER) / (DISK_OUTER - DISK_INNER), 0.0, 1.0);
      vec3 col = mix(inner, mid, smoothstep(0.0, 0.45, t));
      col = mix(col, outer, smoothstep(0.45, 1.0, t));
      return col * density * 2.4;
    }

    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      uv.x *= uResolution.x / uResolution.y;

      vec3 ro = uCamPos;
      vec3 rd = normalize(uCamDir + uv.x * uCamRight * 0.55 + uv.y * uCamUp * 0.55);

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

        float bend = 1.4 / (d * d);
        rd = normalize(rd - normalize(p) * bend * 0.12);

        if (abs(p.y) < 0.18 && d > DISK_INNER && d < DISK_OUTER) {
          float r = length(p.xz);
          float angle = atan(p.z, p.x);
          float dens = diskDensity(r, angle);
          vec3 c = diskColor(r, dens);
          float alpha = dens * 0.08;
          diskCol = diskCol + c * alpha * (1.0 - diskAlpha);
          diskAlpha = min(diskAlpha + alpha, 1.0);
        }

        travel += max(0.15, d * 0.12);
        if (travel > MAX_DIST) break;
      }

      vec3 bgDir = normalize(ro + rd * MAX_DIST);
      color = starfield(bgDir) * (1.0 - diskAlpha) + diskCol;

      float glow = 1.0 - smoothstep(BH_RADIUS * 1.5, BH_RADIUS * 5.0, length(uv * 8.0));
      color += vec3(1.0, 0.7, 0.3) * glow * 0.08;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

function BlackHoleQuad() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  const camData = useMemo(() => {
    const camPos = new THREE.Vector3(0, 2.5, 10);
    const camTarget = new THREE.Vector3(0, 0, 0);
    const camDir = new THREE.Vector3().subVectors(camTarget, camPos).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const camRight = new THREE.Vector3().crossVectors(camDir, worldUp).normalize();
    const camUp = new THREE.Vector3().crossVectors(camRight, camDir).normalize();
    return { camPos, camDir, camUp, camRight };
  }, []);

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    materialRef.current.uniforms.uResolution.value.set(size.width, size.height);
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
