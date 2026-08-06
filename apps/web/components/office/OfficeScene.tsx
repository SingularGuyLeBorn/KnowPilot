"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, ThreeEvent } from "@react-three/fiber";
import {
  ContactShadows,
  OrbitControls,
  RoundedBox,
  Text,
} from "@react-three/drei";
import * as THREE from "three";
import type { OfficeHotspotId } from "./officeContent";

/** Light Tech Studio — 浅色科技工作室 */
const BG = "#E8EEF5";
const WALL = "#F4F7FB";
const WALL_ACCENT = "#DCE7F5";
const FLOOR = "#E2E8F0";
const FLOOR_GRID = "#CBD5E1";
const DESK = "#F8FAFC";
const DESK_EDGE = "#94A3B8";
const METAL = "#64748B";
const CHAIR = "#0087EB";
const CHAIR_DARK = "#0B3A66";
const ACCENT = "#38BDF8";

interface OfficeSceneProps {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
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
    mat.opacity = active ? 0.22 + Math.sin(clock.elapsedTime * 3) * 0.06 : 0;
  });
  return (
    <mesh ref={ref} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.55, 32]} />
      <meshBasicMaterial color="#0087EB" transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function RoomShell() {
  return (
    <group>
      {/* 浅色环氧地坪 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color={FLOOR} roughness={0.72} metalness={0.08} />
      </mesh>
      {/* 科技网格线 */}
      {Array.from({ length: 11 }).map((_, i) => (
        <mesh
          key={`gx-${i}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[-4.5 + i * 0.9, 0.003, 0]}
          receiveShadow
        >
          <planeGeometry args={[0.018, 10]} />
          <meshStandardMaterial color={FLOOR_GRID} roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: 11 }).map((_, i) => (
        <mesh
          key={`gz-${i}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.003, -4.5 + i * 0.9]}
          receiveShadow
        >
          <planeGeometry args={[10, 0.018]} />
          <meshStandardMaterial color={FLOOR_GRID} roughness={1} />
        </mesh>
      ))}

      {/* 后墙：浅底 + 品牌蓝渐变面板 */}
      <mesh position={[0, 2.2, -4.2]} receiveShadow>
        <boxGeometry args={[10, 4.4, 0.12]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      <mesh position={[0, 2.15, -4.12]} receiveShadow>
        <planeGeometry args={[8.6, 3.6]} />
        <meshStandardMaterial color={WALL_ACCENT} roughness={0.7} metalness={0.05} />
      </mesh>
      {/* 后墙细网格装饰 */}
      {Array.from({ length: 9 }).map((_, i) => (
        <mesh key={`wg-${i}`} position={[-3.6 + i * 0.9, 2.15, -4.1]}>
          <planeGeometry args={[0.012, 3.4]} />
          <meshBasicMaterial color="#B8C9E0" transparent opacity={0.45} />
        </mesh>
      ))}

      {/* 左右墙 */}
      <mesh position={[-4.95, 2.2, 0]} receiveShadow>
        <boxGeometry args={[0.12, 4.4, 10]} />
        <meshStandardMaterial color={WALL} roughness={0.9} />
      </mesh>
      <mesh position={[4.95, 2.2, 0]} receiveShadow>
        <boxGeometry args={[0.12, 4.4, 10]} />
        <meshStandardMaterial color="#EEF3F9" roughness={0.9} />
      </mesh>

      {/* 顶光灯条 */}
      <mesh position={[0, 4.25, -1]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[6.5, 0.06, 0.35]} />
        <meshStandardMaterial color="#F8FAFC" emissive="#E0F2FE" emissiveIntensity={0.65} roughness={0.4} />
      </mesh>
      <pointLight position={[0, 4.0, -1]} intensity={1.1} distance={14} color="#F0F9FF" />

      {/* 浅色区域垫 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.2, 0.01, 0.4]} receiveShadow>
        <circleGeometry args={[2.2, 64]} />
        <meshStandardMaterial color="#DBE7F5" roughness={0.95} />
      </mesh>
    </group>
  );
}

function DeskSet({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();

  return (
    <group position={[0.15, 0, 0.15]}>
      {/* 桌面 — 浅台面 */}
      <RoundedBox args={[2.6, 0.08, 1.15]} radius={0.04} position={[0, 0.72, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={DESK} roughness={0.35} metalness={0.12} />
      </RoundedBox>
      <mesh position={[0, 0.675, 0]}>
        <boxGeometry args={[2.55, 0.02, 1.1]} />
        <meshStandardMaterial color={DESK_EDGE} roughness={0.5} metalness={0.25} />
      </mesh>
      {/* 细金属腿 */}
      {[
        [-1.1, 0.36, -0.42],
        [1.1, 0.36, -0.42],
        [-1.1, 0.36, 0.42],
        [1.1, 0.36, 0.42],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <boxGeometry args={[0.05, 0.72, 0.05]} />
          <meshStandardMaterial color={METAL} roughness={0.35} metalness={0.65} />
        </mesh>
      ))}

      {/* 显示器 — 热点 */}
      <group
        position={[-0.55, 0.76, -0.15]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("monitor");
        }}
        {...hover}
      >
        <HotspotGlow active={activeId === "monitor"} />
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[1.15, 0.72, 0.06]} />
          <meshStandardMaterial color="#1A1A1E" roughness={0.4} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.55, 0.035]}>
          <planeGeometry args={[1.05, 0.62]} />
          <meshStandardMaterial
            color="#0B1220"
            emissive="#1E3A5F"
            emissiveIntensity={0.55}
            roughness={0.3}
          />
        </mesh>
        {/* 屏幕图标格 */}
        {[
          [-0.32, 0.68, "#38BDF8"],
          [-0.08, 0.68, "#22D3EE"],
          [0.16, 0.68, "#0087EB"],
          [0.4, 0.68, "#94A3B8"],
          [-0.32, 0.42, "#0EA5E9"],
          [-0.08, 0.42, "#67E8F9"],
          [0.16, 0.42, "#64748B"],
          [0.4, 0.42, "#F59E0B"],
        ].map(([x, y, c], i) => (
          <mesh key={i} position={[x as number, y as number, 0.04]}>
            <planeGeometry args={[0.16, 0.16]} />
            <meshBasicMaterial color={c as string} />
          </mesh>
        ))}
        <mesh position={[0, 0.12, 0]} castShadow>
          <boxGeometry args={[0.18, 0.24, 0.08]} />
          <meshStandardMaterial color="#334155" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.01, 0.05]} castShadow>
          <boxGeometry args={[0.4, 0.03, 0.22]} />
          <meshStandardMaterial color="#475569" metalness={0.35} roughness={0.45} />
        </mesh>
        <Text
          position={[0, 0.95, 0.05]}
          fontSize={0.07}
          color="#E0F2FE"
          anchorX="center"
          maxWidth={1}
        >
          OasisMind Desk
        </Text>
      </group>

      {/* 红色速查夹 */}
      <group
        position={[0.85, 0.78, 0.15]}
        rotation={[0, -0.35, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("binder");
        }}
        {...hover}
      >
        <HotspotGlow active={activeId === "binder"} />
        <RoundedBox args={[0.28, 0.36, 0.06]} radius={0.01} castShadow>
          <meshStandardMaterial color="#0284C7" roughness={0.45} metalness={0.15} />
        </RoundedBox>
        <mesh position={[0, 0.02, 0.035]}>
          <planeGeometry args={[0.2, 0.22]} />
          <meshStandardMaterial color="#F0F9FF" />
        </mesh>
        <Text position={[0, 0.08, 0.04]} fontSize={0.035} color="#0C4A6E" anchorX="center">
          Facts
        </Text>
      </group>

      {/* 手机支架 */}
      <group
        position={[0.25, 0.76, 0.2]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("phone");
        }}
        {...hover}
      >
        <mesh position={[0, 0.02, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.1, 0.04, 16]} />
          <meshStandardMaterial color="#9CA3AF" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.16, 0]} rotation={[-0.25, 0, 0]} castShadow>
          <boxGeometry args={[0.14, 0.26, 0.018]} />
          <meshStandardMaterial color="#111827" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.16, 0.012]} rotation={[-0.25, 0, 0]}>
          <planeGeometry args={[0.12, 0.22]} />
          <meshStandardMaterial color="#0EA5E9" emissive="#0284C7" emissiveIntensity={0.4} />
        </mesh>
      </group>

      {/* 台历 */}
      <group
        position={[0.55, 0.76, 0.28]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect("calendar");
        }}
        {...hover}
      >
        <RoundedBox args={[0.28, 0.22, 0.04]} radius={0.01} castShadow>
          <meshStandardMaterial color="#F9FAFB" roughness={0.8} />
        </RoundedBox>
        <Text position={[0, 0.04, 0.025]} fontSize={0.04} color="#111827" anchorX="center">
          2026
        </Text>
        <Text position={[0, -0.02, 0.025]} fontSize={0.028} color="#DC2626" anchorX="center">
          AUG
        </Text>
      </group>

      {/* 台灯 — 冷白金属 */}
      <group position={[1.05, 0.76, -0.25]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.06, 0.08, 0.03, 16]} />
          <meshStandardMaterial color={METAL} metalness={0.75} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0.18, 0]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 0.36, 8]} />
          <meshStandardMaterial color={METAL} metalness={0.75} roughness={0.28} />
        </mesh>
        <mesh position={[0.08, 0.32, 0]} rotation={[0, 0, -0.6]} castShadow>
          <coneGeometry args={[0.12, 0.16, 16]} />
          <meshStandardMaterial color="#E2E8F0" metalness={0.35} roughness={0.45} />
        </mesh>
        <pointLight position={[0.12, 0.28, 0.05]} intensity={0.65} distance={3.5} color="#E0F2FE" />
      </group>

      {/* 马克杯 */}
      <mesh position={[-1.0, 0.82, 0.25]} castShadow>
        <cylinderGeometry args={[0.05, 0.045, 0.1, 16]} />
        <meshStandardMaterial color="#E0F2FE" roughness={0.55} />
      </mesh>

      {/* 鼠标 */}
      <mesh position={[-0.15, 0.78, 0.35]} castShadow>
        <capsuleGeometry args={[0.035, 0.04, 4, 8]} />
        <meshStandardMaterial color="#F3F4F6" roughness={0.5} />
      </mesh>
    </group>
  );
}

function TechChair() {
  return (
    <group position={[0.1, 0, 1.15]} rotation={[0, 0.15, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.55, 0.08, 0.5]} />
        <meshStandardMaterial color={CHAIR} roughness={0.45} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.78, -0.22]} castShadow>
        <boxGeometry args={[0.55, 0.7, 0.08]} />
        <meshStandardMaterial color={CHAIR_DARK} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 0.36, 12]} />
        <meshStandardMaterial color={METAL} metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 0.04, 16]} />
        <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.3} />
      </mesh>
    </group>
  );
}

function BulletinBoard({
  onSelect,
  activeId,
}: {
  onSelect: (id: OfficeHotspotId) => void;
  activeId: OfficeHotspotId | null;
}) {
  const hover = useHoverCursor();
  return (
    <group
      position={[0.3, 2.35, -4.05]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("board");
      }}
      {...hover}
    >
      <RoundedBox args={[3.4, 1.35, 0.08]} radius={0.02} castShadow>
        <meshStandardMaterial color="#1E3A5F" roughness={0.55} metalness={0.2} />
      </RoundedBox>
      {/* 论文条 */}
      {[-1.2, -0.7, -0.2].map((x, i) => (
        <mesh key={i} position={[x, 0.25, 0.05]}>
          <planeGeometry args={[0.35, 0.45]} />
          <meshStandardMaterial color="#F8FAFC" />
        </mesh>
      ))}
      {/* 中心海报 */}
      <mesh position={[0.55, 0.05, 0.05]}>
        <planeGeometry args={[1.1, 0.95]} />
        <meshStandardMaterial color="#EFF6FF" />
      </mesh>
      <Text position={[0.55, 0.35, 0.06]} fontSize={0.055} color="#1E3A5F" anchorX="center" maxWidth={1}>
        Local-first Agent Architecture
      </Text>
      {/* 便利贴 */}
      {[
        [1.35, 0.35, "#FDE68A"],
        [1.35, 0.05, "#FBCFE8"],
        [1.35, -0.25, "#BBF7D0"],
        [1.65, 0.2, "#BFDBFE"],
        [1.65, -0.1, "#FED7AA"],
      ].map(([x, y, c], i) => (
        <mesh key={i} position={[x as number, y as number, 0.06]} rotation={[0, 0, (i % 2) * 0.08 - 0.04]}>
          <planeGeometry args={[0.22, 0.22]} />
          <meshStandardMaterial color={c as string} />
        </mesh>
      ))}
      {activeId === "board" && (
        <mesh position={[0, -0.85, 0.02]}>
          <ringGeometry args={[0.4, 0.48, 32]} />
          <meshBasicMaterial color="#0087EB" transparent opacity={0.5} />
        </mesh>
      )}
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
      position={[-4.8, 2.2, -0.8]}
      rotation={[0, Math.PI / 2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("map");
      }}
      {...hover}
    >
      <RoundedBox args={[2.6, 1.6, 0.06]} radius={0.02} castShadow>
        <meshStandardMaterial color="#1E293B" roughness={0.8} />
      </RoundedBox>
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[2.4, 1.4]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      {/* 简化「大陆」块 */}
      <mesh position={[-0.4, 0.1, 0.04]}>
        <planeGeometry args={[1.2, 0.7]} />
        <meshBasicMaterial color="#475569" />
      </mesh>
      <mesh position={[0.7, -0.15, 0.04]}>
        <planeGeometry args={[0.7, 0.5]} />
        <meshBasicMaterial color="#64748B" />
      </mesh>
      {/* 标记点 */}
      {[
        [-0.8, 0.25],
        [-0.2, 0.05],
        [0.5, -0.1],
        [0.9, 0.2],
      ].map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.05]}>
          <circleGeometry args={[0.06, 16]} />
          <meshBasicMaterial color="#38BDF8" />
        </mesh>
      ))}
      <Text position={[0, 0.65, 0.05]} fontSize={0.09} color="#E0F2FE" anchorX="center">
        Oasis Journey
      </Text>
      {activeId === "map" && (
        <mesh position={[0, 0, 0.06]}>
          <planeGeometry args={[2.5, 1.5]} />
          <meshBasicMaterial color="#0087EB" transparent opacity={0.12} />
        </mesh>
      )}
    </group>
  );
}

function PolaroidWall() {
  const frames = useMemo(
    () =>
      [
        [-2.8, 2.8, "#7DD3FC"],
        [-2.2, 3.1, "#67E8F9"],
        [-1.5, 2.7, "#93C5FD"],
        [-2.5, 2.2, "#BAE6FD"],
        [-1.8, 2.15, "#A5F3FC"],
      ] as const,
    [],
  );
  return (
    <group position={[0, 0, -4.05]}>
      {frames.map(([x, y, c], i) => (
        <group key={i} position={[x, y, 0.04]} rotation={[0, 0, ((i % 3) - 1) * 0.06]}>
          <mesh castShadow>
            <boxGeometry args={[0.42, 0.5, 0.03]} />
            <meshStandardMaterial color="#F8FAFC" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.04, 0.02]}>
            <planeGeometry args={[0.34, 0.34]} />
            <meshBasicMaterial color={c} />
          </mesh>
        </group>
      ))}
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
      position={[3.6, 0, -2.8]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("plant");
      }}
      {...hover}
    >
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.22, 0.5, 16]} />
        <meshStandardMaterial color="#64748B" roughness={0.4} metalness={0.45} />
      </mesh>
      {[
        [0, 0.85, 0],
        [0.25, 0.95, 0.1],
        [-0.2, 1.0, -0.05],
        [0.1, 1.15, -0.15],
        [-0.15, 0.9, 0.2],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[0.4, i, 0.2]} castShadow>
          <sphereGeometry args={[0.28, 12, 12]} />
          <meshStandardMaterial color={i % 2 ? "#0F766E" : "#14B8A6"} roughness={0.85} />
        </mesh>
      ))}
      {activeId === "plant" && <HotspotGlow active />}
    </group>
  );
}

function FloorLamp() {
  return (
    <group position={[-3.2, 0, -3.2]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.04, 1.8, 8]} />
        <meshStandardMaterial color={METAL} metalness={0.65} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.95, 0]} castShadow>
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshStandardMaterial color="#F8FAFC" emissive="#E0F2FE" emissiveIntensity={0.55} roughness={0.75} />
      </mesh>
      <pointLight position={[0, 1.9, 0]} intensity={0.85} distance={5} color="#E0F2FE" />
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
    if (body.current) {
      body.current.position.y = Math.sin(clock.elapsedTime * 2) * 0.015;
    }
  });
  return (
    <group
      position={[3.2, 0, 2.4]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect("dog");
      }}
      {...hover}
    >
      {/* 狗窝 */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.45, 0.5, 0.16, 24]} />
        <meshStandardMaterial color="#9CA3AF" roughness={1} />
      </mesh>
      <group ref={body} position={[0, 0.22, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.22, 16, 16]} />
          <meshStandardMaterial color="#D4A574" roughness={0.85} />
        </mesh>
        <mesh position={[0.18, 0.12, 0.08]} castShadow>
          <sphereGeometry args={[0.14, 16, 16]} />
          <meshStandardMaterial color="#E8C49A" roughness={0.85} />
        </mesh>
        <mesh position={[0.22, 0.22, 0.02]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#1F2937" />
        </mesh>
        <mesh position={[0.28, 0.1, 0.12]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      </group>
      {activeId === "dog" && <HotspotGlow active />}
    </group>
  );
}

function Skateboard() {
  return (
    <group position={[-2.4, 0.06, 1.6]} rotation={[0, 0.6, 0]}>
      <RoundedBox args={[0.7, 0.04, 0.22]} radius={0.02} castShadow>
        <meshStandardMaterial color="#0284C7" roughness={0.45} metalness={0.15} />
      </RoundedBox>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.18, 12]} />
          <meshStandardMaterial color="#1F2937" />
        </mesh>
      ))}
    </group>
  );
}

function SceneContent({ onSelect, activeId }: OfficeSceneProps) {
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 12, 26]} />
      <ambientLight intensity={0.62} color="#F8FAFC" />
      <directionalLight
        position={[4, 9, 3]}
        intensity={1.05}
        castShadow
        shadow-mapSize={[1024, 1024]}
        color="#FFFFFF"
      />
      <hemisphereLight args={["#F0F9FF", "#CBD5E1", 0.45]} />
      <pointLight position={[-2, 3.5, 2]} intensity={0.35} distance={10} color={ACCENT} />

      <RoomShell />
      <DeskSet onSelect={onSelect} activeId={activeId} />
      <TechChair />
      <BulletinBoard onSelect={onSelect} activeId={activeId} />
      <JourneyMap onSelect={onSelect} activeId={activeId} />
      <PolaroidWall />
      <Plant onSelect={onSelect} activeId={activeId} />
      <FloorLamp />
      <DogBuddy onSelect={onSelect} activeId={activeId} />
      <Skateboard />

      <ContactShadows position={[0, 0.01, 0]} opacity={0.22} scale={12} blur={2.4} far={4} />

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={2.8}
        maxDistance={7.5}
        minPolarAngle={0.55}
        maxPolarAngle={1.35}
        minAzimuthAngle={-1.1}
        maxAzimuthAngle={1.1}
        target={[0.1, 1.1, 0]}
        rotateSpeed={0.55}
      />
    </>
  );
}

export function OfficeScene({ onSelect, activeId }: OfficeSceneProps) {
  const [dpr, setDpr] = useState(1.5);

  return (
    <Canvas
      className="h-full w-full touch-none"
      shadows
      dpr={dpr}
      camera={{ position: [2.8, 2.4, 4.2], fov: 42, near: 0.1, far: 40 }}
      onCreated={() => setDpr(Math.min(2, window.devicePixelRatio || 1.5))}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
    >
      <SceneContent onSelect={onSelect} activeId={activeId} />
    </Canvas>
  );
}
