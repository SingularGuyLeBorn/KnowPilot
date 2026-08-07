"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import {
  ContactShadows,
  OrbitControls,
  RoundedBox,
  Text,
} from "@react-three/drei";
import * as THREE from "three";
import {
  ARCHITECTURE_BOARD,
  BOOKSHELF_TITLES,
  FORMULA_SHEETS,
  KNOWLEDGE_BOARD,
  type OfficeHotspotId,
} from "./officeContent";
import { OFFICE_VIEWS, WALK_BOUNDS, type OfficeViewId } from "./officeNav";

type OrbitLike = {
  target: THREE.Vector3;
  update: () => void;
};

/** 浅色高端工位：白橡 / 雾灰 / 品牌蓝点缀——告别监狱黑 */
const BG = "#F3F6FA";
const WALL = "#FAFBFD";
const WALL_SOFT = "#EEF3F9";
const FLOOR = "#E8EEF5";
const FLOOR_GRID = "#D5DEE9";
const DESK_TOP = "#F7F1E8";
const LEG = "#D1D9E4";
const METAL = "#A8B4C4";
const CHAIR = "#E8EEF5";
const CHAIR_ACCENT = "#7DD3FC";
const CHAIR_FRAME = "#CBD5E1";
const ACCENT = "#38BDF8";
const NVIDIA = "#76B900";
const PAPER = "#FFFEF9";
const INK = "#1E3A5F";

interface OfficeSceneProps {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
  viewId: OfficeViewId;
}

function useHoverCursor() {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      document.body.style.cursor = "auto";
    },
  };
}

function HotspotGlow({ active }: { active: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = active ? 0.2 + Math.sin(clock.elapsedTime * 3) * 0.05 : 0;
  });
  return (
    <mesh ref={ref} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.5, 28]} />
      <meshBasicMaterial color="#0087EB" transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** WASD 平移 + 预设机位插值；鼠标拖拽仍由 OrbitControls 环顾 */
function CameraNavigator({
  viewId,
  controlsRef,
}: {
  viewId: OfficeViewId;
  controlsRef: MutableRefObject<OrbitLike | null>;
}) {
  const { camera } = useThree();
  const keys = useRef({ w: false, a: false, s: false, d: false });
  const targetView = useRef(viewId);
  const lerpT = useRef(1);

  useEffect(() => {
    targetView.current = viewId;
    if (viewId !== "walk") lerpT.current = 0;
  }, [viewId]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") keys.current.w = true;
      if (k === "s" || k === "arrowdown") keys.current.s = true;
      if (k === "a" || k === "arrowleft") keys.current.a = true;
      if (k === "d" || k === "arrowright") keys.current.d = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") keys.current.w = false;
      if (k === "s" || k === "arrowdown") keys.current.s = false;
      if (k === "a" || k === "arrowleft") keys.current.a = false;
      if (k === "d" || k === "arrowright") keys.current.d = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((_, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const speed = 2.4 * Math.min(dt, 0.05);

    if (lerpT.current < 1 && targetView.current !== "walk") {
      const preset = OFFICE_VIEWS[targetView.current];
      lerpT.current = Math.min(1, lerpT.current + dt * 1.6);
      const t = 1 - Math.pow(1 - lerpT.current, 3);
      camera.position.lerp(new THREE.Vector3(...preset.position), t);
      controls.target.lerp(new THREE.Vector3(...preset.target), t);
      controls.update();
      return;
    }

    const { w, a, s, d } = keys.current;
    if (!(w || a || s || d)) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    else forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    if (w) move.add(forward);
    if (s) move.sub(forward);
    if (d) move.add(right);
    if (a) move.sub(right);
    if (move.lengthSq() < 1e-6) return;
    move.normalize().multiplyScalar(speed);

    const next = camera.position.clone().add(move);
    next.x = THREE.MathUtils.clamp(next.x, WALK_BOUNDS.minX, WALK_BOUNDS.maxX);
    next.z = THREE.MathUtils.clamp(next.z, WALK_BOUNDS.minZ, WALK_BOUNDS.maxZ);
    next.y = WALK_BOUNDS.y;
    const delta = next.clone().sub(camera.position);
    camera.position.copy(next);
    controls.target.add(delta);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0.6, 2.8);
    controls.update();
  });

  return null;
}

function RoomShell() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color={FLOOR} roughness={0.85} />
      </mesh>
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={`gx-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[-4.2 + i * 1.2, 0.002, 0]}>
          <planeGeometry args={[0.012, 12]} />
          <meshStandardMaterial color={FLOOR_GRID} roughness={1} />
        </mesh>
      ))}

      <mesh position={[0, 2.2, -4.8]} receiveShadow>
        <boxGeometry args={[12, 4.4, 0.12]} />
        <meshStandardMaterial color={WALL} roughness={0.92} />
      </mesh>
      <mesh position={[0, 2.15, -4.72]}>
        <planeGeometry args={[10.5, 3.6]} />
        <meshStandardMaterial color={WALL_SOFT} roughness={0.8} />
      </mesh>
      <mesh position={[-5.4, 2.2, 0]} receiveShadow>
        <boxGeometry args={[0.12, 4.4, 12]} />
        <meshStandardMaterial color={WALL} roughness={0.92} />
      </mesh>
      <mesh position={[5.4, 2.2, 0]} receiveShadow>
        <boxGeometry args={[0.12, 4.4, 12]} />
        <meshStandardMaterial color="#F5F8FC" roughness={0.92} />
      </mesh>

      <RoundedBox args={[7.2, 0.08, 0.32]} radius={0.04} position={[0, 4.2, -0.8]}>
        <meshStandardMaterial color="#FFFFFF" emissive="#E0F2FE" emissiveIntensity={0.55} />
      </RoundedBox>
      <pointLight position={[0, 4.0, -0.8]} intensity={1.0} distance={14} color="#F8FAFC" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.2, 0.004, 0.15]} receiveShadow>
        <circleGeometry args={[2.9, 64]} />
        <meshStandardMaterial color="#E4EDF7" roughness={0.95} />
      </mesh>
    </group>
  );
}

/** 显示器：浅色框 + 完整公式屏 */
function FormulaMonitor({
  w,
  h,
  title,
  lines,
  tint = "#0284C7",
}: {
  w: number;
  h: number;
  title: string;
  lines: string[];
  tint?: string;
}) {
  return (
    <group>
      <RoundedBox args={[w, h, 0.05]} radius={0.025} castShadow>
        <meshStandardMaterial color="#F1F5F9" roughness={0.4} metalness={0.12} />
      </RoundedBox>
      <mesh position={[0, 0, 0.028]}>
        <planeGeometry args={[w * 0.9, h * 0.86]} />
        <meshStandardMaterial color="#F8FAFC" emissive="#E0F2FE" emissiveIntensity={0.25} roughness={0.35} />
      </mesh>
      <mesh position={[0, h * 0.36, 0.032]}>
        <planeGeometry args={[w * 0.82, 0.045]} />
        <meshBasicMaterial color={tint} transparent opacity={0.2} />
      </mesh>
      <Text position={[0, h * 0.36, 0.035]} fontSize={0.038} color={INK} anchorX="center" maxWidth={w * 0.8}>
        {title}
      </Text>
      {lines.slice(0, 5).map((line, i) => (
        <Text
          key={i}
          position={[0, h * 0.18 - i * 0.075, 0.035]}
          fontSize={0.028}
          color="#334155"
          anchorX="center"
          maxWidth={w * 0.82}
          lineHeight={1.15}
        >
          {line}
        </Text>
      ))}
    </group>
  );
}

const MONITOR_FORMULAS = [
  {
    title: "Scaled Dot-Product Attention",
    tint: "#0284C7",
    lines: [
      "Attn(Q,K,V)=softmax(QKᵀ/√d_k)V",
      "Q=XW_Q  K=XW_K  V=XW_V",
      "d_k = d_model / h",
      "score_ij = q_i·k_j / √d_k",
    ],
  },
  {
    title: "Multi-Head + Output",
    tint: "#059669",
    lines: [
      "head_i=Attn(QW_i^Q, KW_i^K, VW_i^V)",
      "MultiHead=Concat(head_1..h)W_O",
      "W_i^Q∈R^{d×d_k}, W_O∈R^{hd_v×d}",
      "并行子空间捕捉不同依赖",
    ],
  },
  {
    title: "Transformer Block",
    tint: "#D97706",
    lines: [
      "x̃ = x + MHA(LN(x))",
      "y = x̃ + FFN(LN(x̃))",
      "FFN(z)=GELU(zW_1+b_1)W_2+b_2",
      "Pre-Norm 稳定深层训练",
    ],
  },
  {
    title: "Causal LM Loss",
    tint: "#7C3AED",
    lines: [
      "p_θ(y_t|y_<t,x)=softmax(h_t W_out)",
      "L=-Σ_t log p_θ(y_t|y_<t,x)",
      "Teacher forcing 训练",
      "decode 时用 KV Cache",
    ],
  },
  {
    title: "RoPE Position",
    tint: "#DB2777",
    lines: [
      "f(q,m)=R_Θ,m q",
      "R 为分块旋转矩阵",
      "⟨f(q,m),f(k,n)⟩ 依赖 m-n",
      "外推优于绝对位置编码",
    ],
  },
  {
    title: "GQA / MoE",
    tint: "#0EA5E9",
    lines: [
      "n_kv ≪ n_q  (GQA)",
      "y=Σ_i g_i(x)·E_i(x)",
      "g=softmax(x W_g) Top-k",
      "稀疏激活降推理成本",
    ],
  },
  {
    title: "RLHF Objective",
    tint: "#65A30D",
    lines: [
      "max_π E[r_φ(x,y)]",
      "  - β KL(π(·|x)||π_ref)",
      "r_φ 为奖励模型",
      "PPO / DPO 对齐人类偏好",
    ],
  },
] as const;

function GamingDeskSet({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  const deskY = 0.74;

  return (
    <group position={[0.1, 0, 0.1]}>
      <RoundedBox args={[3.6, 0.08, 1.35]} radius={0.06} position={[0, deskY, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={DESK_TOP} roughness={0.55} />
      </RoundedBox>
      <RoundedBox args={[1.15, 0.08, 2.1]} radius={0.06} position={[1.85, deskY, -0.55]} castShadow receiveShadow>
        <meshStandardMaterial color={DESK_TOP} roughness={0.55} />
      </RoundedBox>
      <mesh position={[0, deskY - 0.045, 0.66]}>
        <boxGeometry args={[3.4, 0.015, 0.025]} />
        <meshStandardMaterial color="#BAE6FD" emissive="#7DD3FC" emissiveIntensity={0.45} />
      </mesh>

      {[
        [-1.5, 0.37, -0.48],
        [1.35, 0.37, -0.48],
        [-1.5, 0.37, 0.48],
        [1.35, 0.37, 0.48],
        [2.2, 0.37, -1.35],
        [2.2, 0.37, 0.3],
      ].map((p, i) => (
        <RoundedBox key={i} args={[0.08, 0.72, 0.08]} radius={0.02} position={p as [number, number, number]} castShadow>
          <meshStandardMaterial color={LEG} roughness={0.45} metalness={0.15} />
        </RoundedBox>
      ))}

      <group
        position={[-0.1, deskY + 0.02, -0.4]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("monitor");
        }}
        {...hover}
      >
        <HotspotGlow active={activeId === "monitor"} />
        <group position={[-1.05, 0.48, 0]} rotation={[0, 0.16, 0]}>
          <FormulaMonitor w={0.98} h={0.6} {...MONITOR_FORMULAS[0]} />
        </group>
        <group position={[0, 0.52, -0.02]}>
          <FormulaMonitor w={1.12} h={0.68} {...MONITOR_FORMULAS[1]} />
        </group>
        <group position={[1.1, 0.48, 0]} rotation={[0, -0.16, 0]}>
          <FormulaMonitor w={0.98} h={0.6} {...MONITOR_FORMULAS[2]} />
        </group>
        <group position={[-0.55, 1.08, -0.04]} rotation={[0.04, 0.08, 0]}>
          <FormulaMonitor w={0.74} h={0.44} {...MONITOR_FORMULAS[3]} />
        </group>
        <group position={[0.55, 1.08, -0.04]} rotation={[0.04, -0.08, 0]}>
          <FormulaMonitor w={0.74} h={0.44} {...MONITOR_FORMULAS[4]} />
        </group>
        <group position={[1.95, 0.55, -0.85]} rotation={[0, -0.85, 0]}>
          <FormulaMonitor w={0.56} h={0.88} {...MONITOR_FORMULAS[5]} />
        </group>
        <group position={[2.15, 0.55, -1.45]} rotation={[0, -1.05, 0]}>
          <FormulaMonitor w={0.52} h={0.74} {...MONITOR_FORMULAS[6]} />
        </group>
        <RoundedBox args={[3.1, 0.05, 0.08]} radius={0.02} position={[0, 0.1, -0.06]} castShadow>
          <meshStandardMaterial color={METAL} roughness={0.4} metalness={0.25} />
        </RoundedBox>
      </group>

      {/* 浅色主机双塔 */}
      <RoundedBox args={[0.3, 0.52, 0.4]} radius={0.04} position={[-1.45, 0.34, 0.35]} castShadow>
        <meshStandardMaterial color="#F8FAFC" roughness={0.4} metalness={0.1} />
      </RoundedBox>
      <mesh position={[-1.3, 0.4, 0.35]}>
        <planeGeometry args={[0.02, 0.28]} />
        <meshStandardMaterial color={NVIDIA} emissive={NVIDIA} emissiveIntensity={0.55} />
      </mesh>
      <RoundedBox args={[0.3, 0.52, 0.4]} radius={0.04} position={[2.35, 0.34, 0.15]} castShadow>
        <meshStandardMaterial color="#F1F5F9" roughness={0.4} metalness={0.1} />
      </RoundedBox>
      <mesh position={[2.2, 0.4, 0.15]}>
        <planeGeometry args={[0.02, 0.28]} />
        <meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0.45, 0.1, 0.52]} rotation={[0, 0, 0.04]}>
        <cylinderGeometry args={[0.01, 0.01, 3.5, 8]} />
        <meshStandardMaterial color="#86EFAC" />
      </mesh>

      {/* 浅色键鼠 */}
      <RoundedBox args={[0.7, 0.035, 0.26]} radius={0.02} position={[-0.15, deskY + 0.035, 0.35]} castShadow>
        <meshStandardMaterial color="#FFFFFF" roughness={0.5} />
      </RoundedBox>
      {Array.from({ length: 4 }).map((_, r) =>
        Array.from({ length: 11 }).map((_, c) => (
          <RoundedBox
            key={`${r}-${c}`}
            args={[0.038, 0.012, 0.032]}
            radius={0.004}
            position={[-0.4 + c * 0.05, deskY + 0.055, 0.27 + r * 0.045]}
          >
            <meshStandardMaterial color={r === 1 && c === 5 ? "#BAE6FD" : "#F1F5F9"} />
          </RoundedBox>
        )),
      )}
      <mesh position={[0.42, deskY + 0.04, 0.38]} castShadow>
        <capsuleGeometry args={[0.032, 0.045, 4, 8]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.4} />
      </mesh>

      {/* 笔记本笔 */}
      <group position={[0.95, deskY + 0.02, 0.28]} rotation={[0, -0.2, 0]}>
        <RoundedBox args={[0.3, 0.015, 0.4]} radius={0.01} castShadow>
          <meshStandardMaterial color={PAPER} roughness={0.75} />
        </RoundedBox>
        {[-0.08, 0, 0.08, 0.16].map((z, i) => (
          <mesh key={i} position={[0, 0.01, z]}>
            <planeGeometry args={[0.22, 0.01]} />
            <meshBasicMaterial color="#CBD5E1" />
          </mesh>
        ))}
        <mesh position={[0.18, 0.02, 0.05]} rotation={[0, 0, 0.35]} castShadow>
          <cylinderGeometry args={[0.007, 0.007, 0.26, 8]} />
          <meshStandardMaterial color="#7DD3FC" />
        </mesh>
      </group>

      {/* 手办 */}
      <group position={[-1.3, deskY + 0.02, -0.12]}>
        <RoundedBox args={[0.5, 0.035, 0.16]} radius={0.015} castShadow>
          <meshStandardMaterial color="#FFFFFF" roughness={0.5} />
        </RoundedBox>
        {[
          [-0.15, "#FCA5A5"],
          [0, "#7DD3FC"],
          [0.15, "#86EFAC"],
        ].map(([x, c], i) => (
          <group key={i} position={[x as number, 0.07, 0]}>
            <mesh castShadow>
              <capsuleGeometry args={[0.03, 0.05, 4, 8]} />
              <meshStandardMaterial color={c as string} roughness={0.45} />
            </mesh>
            <mesh position={[0, 0.07, 0]}>
              <sphereGeometry args={[0.035, 10, 10]} />
              <meshStandardMaterial color={c as string} />
            </mesh>
          </group>
        ))}
      </group>

      {/* A4 完整推导 */}
      <group
        position={[0.55, deskY + 0.025, 0.02]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("papers");
        }}
        {...hover}
      >
        {FORMULA_SHEETS.map((sheet, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          return (
            <group
              key={sheet.title}
              position={[col * 0.38 - 0.2, 0.008 * i, row * 0.42 - 0.12]}
              rotation={[-Math.PI / 2 + 0.015, 0, (i % 3) * 0.03 - 0.03]}
            >
              <RoundedBox args={[0.34, 0.48, 0.006]} radius={0.008} castShadow>
                <meshStandardMaterial color={PAPER} roughness={0.85} />
              </RoundedBox>
              <Text position={[0, 0.17, 0.006]} fontSize={0.026} color={INK} anchorX="center" maxWidth={0.3}>
                {sheet.title}
              </Text>
              {sheet.lines.map((line, li) => (
                <Text
                  key={li}
                  position={[0, 0.08 - li * 0.065, 0.006]}
                  fontSize={0.02}
                  color="#475569"
                  anchorX="center"
                  maxWidth={0.3}
                >
                  {line}
                </Text>
              ))}
            </group>
          );
        })}
        {activeId === "papers" && <HotspotGlow active />}
      </group>

      <group
        position={[1.55, deskY + 0.02, 0.35]}
        rotation={[0, -0.35, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("binder");
        }}
        {...hover}
      >
        <HotspotGlow active={activeId === "binder"} />
        <RoundedBox args={[0.24, 0.32, 0.05]} radius={0.02} castShadow>
          <meshStandardMaterial color="#BAE6FD" roughness={0.5} />
        </RoundedBox>
        <Text position={[0, 0.04, 0.03]} fontSize={0.03} color={INK} anchorX="center">
          Facts
        </Text>
      </group>

      <group
        position={[1.2, deskY + 0.02, 0.45]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("phone");
        }}
        {...hover}
      >
        <RoundedBox args={[0.14, 0.04, 0.14]} radius={0.02} position={[0, 0.02, 0]} castShadow>
          <meshStandardMaterial color="#E2E8F0" />
        </RoundedBox>
        <RoundedBox args={[0.11, 0.22, 0.014]} radius={0.015} position={[0, 0.14, 0]} rotation={[-0.2, 0, 0]} castShadow>
          <meshStandardMaterial color="#FFFFFF" emissive="#E0F2FE" emissiveIntensity={0.35} />
        </RoundedBox>
      </group>

      <group
        position={[1.55, deskY + 0.02, 0.05]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("calendar");
        }}
        {...hover}
      >
        <RoundedBox args={[0.24, 0.18, 0.04]} radius={0.015} castShadow>
          <meshStandardMaterial color="#FFFFFF" roughness={0.7} />
        </RoundedBox>
        <Text position={[0, 0.03, 0.025]} fontSize={0.032} color={INK} anchorX="center">
          2026
        </Text>
      </group>

      <mesh position={[-1.0, deskY + 0.07, 0.45]} castShadow>
        <cylinderGeometry args={[0.048, 0.042, 0.1, 16]} />
        <meshStandardMaterial color="#E0F2FE" roughness={0.5} />
      </mesh>
    </group>
  );
}

/** 浅色人体工学椅：头枕 / 腰托 / 4D 扶手 / 网背感 */
function ErgonomicChair() {
  const arms = [0, 0.4 * Math.PI * 2, 0.8 * Math.PI * 2, 1.2 * Math.PI * 2, 1.6 * Math.PI * 2];
  return (
    <group position={[0.05, 0, 1.48]} rotation={[0, 0.1, 0]}>
      <RoundedBox args={[0.56, 0.09, 0.5]} radius={0.05} position={[0, 0.5, 0.02]} castShadow>
        <meshStandardMaterial color={CHAIR} roughness={0.55} />
      </RoundedBox>
      {/* 网状靠背：多层圆角片 */}
      <RoundedBox args={[0.5, 0.72, 0.05]} radius={0.04} position={[0, 0.98, -0.2]} castShadow>
        <meshStandardMaterial color="#F8FAFC" roughness={0.6} />
      </RoundedBox>
      {[-0.12, 0, 0.12].map((x) => (
        <mesh key={x} position={[x, 0.98, -0.17]}>
          <planeGeometry args={[0.08, 0.55]} />
          <meshBasicMaterial color="#E0F2FE" transparent opacity={0.65} />
        </mesh>
      ))}
      <RoundedBox args={[0.3, 0.12, 0.08]} radius={0.035} position={[0, 1.45, -0.16]} castShadow>
        <meshStandardMaterial color={CHAIR_ACCENT} roughness={0.5} />
      </RoundedBox>
      <RoundedBox args={[0.34, 0.1, 0.05]} radius={0.025} position={[0, 0.82, -0.14]} castShadow>
        <meshStandardMaterial color="#BAE6FD" roughness={0.5} />
      </RoundedBox>
      {[-0.3, 0.3].map((x) => (
        <group key={x}>
          <RoundedBox args={[0.05, 0.26, 0.05]} radius={0.015} position={[x, 0.64, 0]} castShadow>
            <meshStandardMaterial color={CHAIR_FRAME} metalness={0.2} roughness={0.4} />
          </RoundedBox>
          <RoundedBox args={[0.08, 0.04, 0.26]} radius={0.02} position={[x, 0.8, 0.02]} castShadow>
            <meshStandardMaterial color="#FFFFFF" roughness={0.5} />
          </RoundedBox>
        </group>
      ))}
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.032, 0.038, 0.34, 12]} />
        <meshStandardMaterial color={METAL} metalness={0.35} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.085, 0.095, 0.05, 16]} />
        <meshStandardMaterial color="#E2E8F0" roughness={0.55} />
      </mesh>
      {arms.map((a) => {
        const len = 0.26;
        return (
          <group key={a}>
            <RoundedBox
              args={[0.04, 0.03, len]}
              radius={0.01}
              position={[Math.sin(a) * len * 0.5, 0.08, Math.cos(a) * len * 0.5]}
              rotation={[0, a, 0]}
              castShadow
            >
              <meshStandardMaterial color={CHAIR_FRAME} roughness={0.5} />
            </RoundedBox>
            <mesh position={[Math.sin(a) * len, 0.04, Math.cos(a) * len]} castShadow>
              <sphereGeometry args={[0.03, 12, 12]} />
              <meshStandardMaterial color="#F1F5F9" roughness={0.6} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function KnowledgeBoard({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  return (
    <group
      position={[-5.25, 2.35, -0.4]}
      rotation={[0, Math.PI / 2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("board");
      }}
      {...hover}
    >
      <RoundedBox args={[2.4, 1.7, 0.08]} radius={0.04} castShadow>
        <meshStandardMaterial color="#F8FAFC" roughness={0.55} />
      </RoundedBox>
      <RoundedBox args={[2.5, 1.8, 0.04]} radius={0.03} position={[0, 0, -0.03]}>
        <meshStandardMaterial color="#E2E8F0" />
      </RoundedBox>
      <Text position={[0, 0.68, 0.05]} fontSize={0.075} color={INK} anchorX="center">
        Knowledge Gardens
      </Text>
      <Text position={[0, 0.52, 0.05]} fontSize={0.035} color="#0284C7" anchorX="center">
        content/ · Markdown Source of Truth
      </Text>
      {KNOWLEDGE_BOARD.map((g, i) => {
        const y = 0.26 - i * 0.18;
        return (
          <group key={g.id} position={[0, y, 0.05]}>
            <RoundedBox args={[2.05, 0.15, 0.01]} radius={0.02}>
              <meshStandardMaterial color="#EEF6FF" />
            </RoundedBox>
            <mesh position={[-0.92, 0, 0.01]}>
              <planeGeometry args={[0.05, 0.1]} />
              <meshBasicMaterial color="#38BDF8" />
            </mesh>
            <Text position={[-0.78, 0.02, 0.012]} fontSize={0.04} color={INK} anchorX="left" maxWidth={1.5}>
              {g.title}
            </Text>
            <Text position={[-0.78, -0.035, 0.012]} fontSize={0.025} color="#64748B" anchorX="left">
              {g.meta}
            </Text>
          </group>
        );
      })}
      {activeId === "board" && (
        <mesh position={[0, 0, 0.06]}>
          <planeGeometry args={[2.3, 1.6]} />
          <meshBasicMaterial color="#38BDF8" transparent opacity={0.06} />
        </mesh>
      )}
    </group>
  );
}

/** 完整 Transformer 推导黑板（浅绿板 + 白字推导） */
function ArchitectureChalkboard({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  const derivation = [
    "1) Embed:  x_0 = E[token] + P_pos",
    "2) Attn:   A = softmax(QKᵀ/√d_k),  H = A V",
    "3) Resid:  x' = x + MultiHead(LN(x))",
    "4) FFN:    z = GELU(x'W₁)W₂ ,  y = x' + z",
    "5) Head:   p = softmax(y_L W_out) ,  L = -Σ log p_t",
  ];
  return (
    <group
      position={[0.2, 2.55, -4.65]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("chalkboard");
      }}
      {...hover}
    >
      <RoundedBox args={[3.1, 1.7, 0.08]} radius={0.04} castShadow>
        <meshStandardMaterial color="#ECFDF5" roughness={0.75} />
      </RoundedBox>
      <RoundedBox args={[3.25, 1.85, 0.05]} radius={0.03} position={[0, 0, -0.03]}>
        <meshStandardMaterial color="#D6D3D1" roughness={0.65} />
      </RoundedBox>
      <Text position={[0, 0.68, 0.05]} fontSize={0.065} color="#14532D" anchorX="center" maxWidth={2.9}>
        {ARCHITECTURE_BOARD.title}
      </Text>
      <Text position={[0, 0.52, 0.05]} fontSize={0.032} color="#059669" anchorX="center" maxWidth={2.9}>
        End-to-end derivation · Decoder-only LLM
      </Text>

      {ARCHITECTURE_BOARD.blocks.map((b, i) => {
        const x = -1.2 + i * 0.6;
        return (
          <group key={b.label} position={[x, 0.18, 0.05]}>
            <RoundedBox args={[0.52, 0.42, 0.02]} radius={0.02}>
              <meshStandardMaterial color="#D1FAE5" />
            </RoundedBox>
            <Text position={[0, 0.1, 0.02]} fontSize={0.03} color="#14532D" anchorX="center" maxWidth={0.48}>
              {b.label}
            </Text>
            <Text position={[0, -0.08, 0.02]} fontSize={0.022} color="#047857" anchorX="center" maxWidth={0.48}>
              {b.detail}
            </Text>
          </group>
        );
      })}

      {derivation.map((line, i) => (
        <Text
          key={line}
          position={[-1.35, -0.2 - i * 0.1, 0.05]}
          fontSize={0.032}
          color="#166534"
          anchorX="left"
          maxWidth={2.9}
        >
          {line}
        </Text>
      ))}
      {activeId === "chalkboard" && (
        <mesh position={[0, 0, 0.06]}>
          <planeGeometry args={[3.0, 1.6]} />
          <meshBasicMaterial color="#22C55E" transparent opacity={0.06} />
        </mesh>
      )}
    </group>
  );
}

function AiBookshelf({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  const colors = ["#BAE6FD", "#A7F3D0", "#FDE68A", "#FBCFE8", "#DDD6FE", "#FED7AA", "#E0E7FF", "#CCFBF1"];
  return (
    <group
      position={[4.7, 0, -2.8]}
      rotation={[0, -Math.PI / 2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("bookshelf");
      }}
      {...hover}
    >
      <RoundedBox args={[1.4, 2.4, 0.35]} radius={0.04} position={[0, 1.2, 0]} castShadow>
        <meshStandardMaterial color="#F8FAFC" roughness={0.55} />
      </RoundedBox>
      {[0.45, 1.0, 1.55, 2.1].map((y) => (
        <RoundedBox key={y} args={[1.28, 0.04, 0.28]} radius={0.01} position={[0, y, 0.02]}>
          <meshStandardMaterial color="#E2E8F0" />
        </RoundedBox>
      ))}
      {BOOKSHELF_TITLES.map((title, i) => {
        const shelf = Math.floor(i / 3);
        const slot = i % 3;
        const y = 0.62 + shelf * 0.55;
        const x = -0.4 + slot * 0.4;
        const h = 0.3 + (i % 3) * 0.035;
        return (
          <group key={title} position={[x, y, 0.08]}>
            <RoundedBox args={[0.11, h, 0.2]} radius={0.015} castShadow>
              <meshStandardMaterial color={colors[i % colors.length]} roughness={0.55} />
            </RoundedBox>
          </group>
        );
      })}
      <Text position={[0, 2.35, 0.2]} fontSize={0.048} color={INK} anchorX="center">
        AI Library
      </Text>
      {activeId === "bookshelf" && <HotspotGlow active />}
    </group>
  );
}

function NvidiaServerRack({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  const ledRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ledRef.current) return;
    const mat = ledRef.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.45 + Math.sin(clock.elapsedTime * 3.5) * 0.25;
  });
  return (
    <group
      position={[4.2, 0, 1.8]}
      rotation={[0, -0.4, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("server");
      }}
      {...hover}
    >
      <RoundedBox args={[0.85, 1.85, 0.7]} radius={0.05} position={[0, 0.95, 0]} castShadow>
        <meshStandardMaterial color="#F8FAFC" roughness={0.4} metalness={0.18} />
      </RoundedBox>
      {Array.from({ length: 7 }).map((_, i) => (
        <RoundedBox key={i} args={[0.68, 0.06, 0.02]} radius={0.01} position={[0, 0.4 + i * 0.18, 0.36]}>
          <meshStandardMaterial color="#E2E8F0" metalness={0.2} roughness={0.45} />
        </RoundedBox>
      ))}
      <RoundedBox args={[0.68, 0.1, 0.02]} radius={0.015} position={[0, 1.68, 0.36]}>
        <meshStandardMaterial color={NVIDIA} emissive={NVIDIA} emissiveIntensity={0.55} />
      </RoundedBox>
      <Text position={[0, 1.68, 0.38]} fontSize={0.04} color="#14532D" anchorX="center">
        NVIDIA DGX
      </Text>
      <Text position={[0, 1.5, 0.38]} fontSize={0.03} color="#4D7C0F" anchorX="center">
        H100 · NVLink
      </Text>
      <mesh ref={ledRef} position={[0.3, 0.28, 0.36]}>
        <circleGeometry args={[0.022, 12]} />
        <meshStandardMaterial color={NVIDIA} emissive={NVIDIA} emissiveIntensity={0.6} />
      </mesh>
      {activeId === "server" && <HotspotGlow active />}
    </group>
  );
}

function AirConditioner() {
  return (
    <group position={[3.2, 3.55, -4.55]}>
      <RoundedBox args={[1.35, 0.36, 0.26]} radius={0.06} castShadow>
        <meshStandardMaterial color="#FFFFFF" roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, -0.04, 0.14]}>
        <planeGeometry args={[1.1, 0.1]} />
        <meshStandardMaterial color="#F1F5F9" />
      </mesh>
      <Text position={[-0.3, 0.08, 0.14]} fontSize={0.035} color="#64748B" anchorX="left">
        24°C · Quiet
      </Text>
    </group>
  );
}

function TrashBin() {
  return (
    <group position={[-1.8, 0, 1.9]}>
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.2, 0.52, 20]} />
        <meshStandardMaterial color="#E2E8F0" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.54, 0]}>
        <torusGeometry args={[0.175, 0.018, 8, 20]} />
        <meshStandardMaterial color="#CBD5E1" />
      </mesh>
    </group>
  );
}

function JourneyMap({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  return (
    <group
      position={[-5.25, 2.2, 2.4]}
      rotation={[0, Math.PI / 2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("map");
      }}
      {...hover}
    >
      <RoundedBox args={[1.8, 1.2, 0.06]} radius={0.04} castShadow>
        <meshStandardMaterial color="#F0F9FF" roughness={0.6} />
      </RoundedBox>
      <Text position={[0, 0.42, 0.04]} fontSize={0.065} color={INK} anchorX="center">
        Oasis Journey
      </Text>
      {["L1", "L2", "L3", "L4", "L5", "Now"].map((y, i) => (
        <group key={y} position={[-0.55 + (i % 3) * 0.55, 0.08 - Math.floor(i / 3) * 0.32, 0.04]}>
          <mesh>
            <circleGeometry args={[0.05, 12]} />
            <meshBasicMaterial color="#7DD3FC" />
          </mesh>
          <Text position={[0.12, 0, 0]} fontSize={0.038} color={INK} anchorX="left">
            {y}
          </Text>
        </group>
      ))}
      {activeId === "map" && (
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[1.7, 1.1]} />
          <meshBasicMaterial color="#38BDF8" transparent opacity={0.08} />
        </mesh>
      )}
    </group>
  );
}

function Plant({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  return (
    <group
      position={[3.8, 0, -3.6]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("plant");
      }}
      {...hover}
    >
      <RoundedBox args={[0.45, 0.45, 0.45]} radius={0.08} position={[0, 0.25, 0]} castShadow>
        <meshStandardMaterial color="#E2E8F0" />
      </RoundedBox>
      {[
        [0, 0.8, 0],
        [0.2, 0.9, 0.08],
        [-0.18, 0.95, -0.05],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <sphereGeometry args={[0.26, 12, 12]} />
          <meshStandardMaterial color={i % 2 ? "#6EE7B7" : "#34D399"} roughness={0.85} />
        </mesh>
      ))}
      {activeId === "plant" && <HotspotGlow active />}
    </group>
  );
}

function FloorLamp({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  return (
    <group
      position={[-3.6, 0, -3.5]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("lamp");
      }}
      {...hover}
    >
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.035, 1.8, 8]} />
        <meshStandardMaterial color={METAL} metalness={0.35} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.95, 0]} castShadow>
        <sphereGeometry args={[0.32, 16, 16]} />
        <meshStandardMaterial color="#FFFFFF" emissive="#FEF3C7" emissiveIntensity={0.45} roughness={0.7} />
      </mesh>
      <pointLight position={[0, 1.9, 0]} intensity={0.7} distance={5} color="#FFF7ED" />
      {activeId === "lamp" && <HotspotGlow active />}
    </group>
  );
}

function DogBuddy({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (body.current) body.current.position.y = Math.sin(clock.elapsedTime * 2) * 0.012;
  });
  return (
    <group
      position={[3.0, 0, 2.8]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("dog");
      }}
      {...hover}
    >
      <mesh position={[0, 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.48, 0.14, 24]} />
        <meshStandardMaterial color="#F1F5F9" roughness={1} />
      </mesh>
      <group ref={body} position={[0, 0.22, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color="#E8C9A0" roughness={0.85} />
        </mesh>
        <mesh position={[0.16, 0.1, 0.08]} castShadow>
          <sphereGeometry args={[0.13, 16, 16]} />
          <meshStandardMaterial color="#F0D5B0" roughness={0.85} />
        </mesh>
      </group>
      {activeId === "dog" && <HotspotGlow active />}
    </group>
  );
}

function SceneContent({ onSelect, activeId, viewId }: OfficeSceneProps) {
  const initial = OFFICE_VIEWS.overview;
  const controlsRef = useRef<OrbitLike | null>(null);
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 16, 32]} />
      <ambientLight intensity={0.72} color="#FFFFFF" />
      <directionalLight
        position={[5, 10, 4]}
        intensity={0.95}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.04}
        color="#FFFBF5"
      />
      <hemisphereLight args={["#F8FAFC", "#E2E8F0", 0.5]} />
      <pointLight position={[-2, 3.2, 2]} intensity={0.25} distance={10} color={ACCENT} />

      <RoomShell />
      <GamingDeskSet onSelect={onSelect} activeId={activeId} />
      <ErgonomicChair />
      <KnowledgeBoard onSelect={onSelect} activeId={activeId} />
      <ArchitectureChalkboard onSelect={onSelect} activeId={activeId} />
      <AiBookshelf onSelect={onSelect} activeId={activeId} />
      <NvidiaServerRack onSelect={onSelect} activeId={activeId} />
      <AirConditioner />
      <TrashBin />
      <JourneyMap onSelect={onSelect} activeId={activeId} />
      <Plant onSelect={onSelect} activeId={activeId} />
      <FloorLamp onSelect={onSelect} activeId={activeId} />
      <DogBuddy onSelect={onSelect} activeId={activeId} />

      <ContactShadows position={[0, 0.001, 0]} opacity={0.14} scale={14} blur={2.8} far={5} frames={1} />

      <OrbitControls
        makeDefault
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(c: any) => {
          controlsRef.current = c;
        }}
        enablePan={false}
        minDistance={1.2}
        maxDistance={10}
        minPolarAngle={0.35}
        maxPolarAngle={1.45}
        target={initial.target}
        rotateSpeed={0.55}
      />
      <CameraNavigator viewId={viewId} controlsRef={controlsRef} />
    </>
  );
}

export function OfficeScene({ onSelect, activeId, viewId }: OfficeSceneProps) {
  const initial = useMemo(() => OFFICE_VIEWS.overview, []);
  return (
    <Canvas
      className="h-full w-full touch-none"
      shadows
      dpr={[1, 1.5]}
      camera={{ position: initial.position, fov: 42, near: 0.1, far: 45 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
    >
      <SceneContent onSelect={onSelect} activeId={activeId} viewId={viewId} />
    </Canvas>
  );
}
