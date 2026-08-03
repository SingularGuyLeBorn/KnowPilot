"use client";

import { motion } from "framer-motion";

interface GardenNetworkProps {
  className?: string;
}

const NODES = [
  { x: 50, y: 50, r: 18, label: "Posts" },
  { x: 140, y: 90, r: 14, label: "Agent" },
  { x: 220, y: 40, r: 12, label: "Skills" },
  { x: 300, y: 110, r: 16, label: "Memories" },
  { x: 90, y: 160, r: 13, label: "Tasks" },
  { x: 180, y: 180, r: 15, label: "Runs" },
  { x: 270, y: 190, r: 12, label: "Sources" },
  { x: 350, y: 70, r: 11, label: "Files" },
];

const LINKS = [
  [0, 1], [0, 4], [1, 2], [1, 5], [2, 3], [3, 7], [4, 5], [5, 6], [6, 7], [1, 6],
];

export function GardenNetwork({ className = "" }: GardenNetworkProps) {
  return (
    <div className={className} aria-hidden>
      <svg viewBox="0 0 400 240" className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(31,138,122,0.25)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {LINKS.map(([a, b], i) => (
          <motion.line
            key={i}
            x1={NODES[a].x}
            y1={NODES[a].y}
            x2={NODES[b].x}
            y2={NODES[b].y}
            stroke="rgba(125,145,127,0.25)"
            strokeWidth="1.5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.2, delay: 0.4 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}

        {NODES.map((node, i) => (
          <g key={node.label}>
            <motion.circle
              cx={node.x}
              cy={node.y}
              r={node.r + 10}
              fill="url(#node-glow)"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
            />
            <motion.circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill="var(--kp-bg-alt)"
              stroke="var(--kp-brand-light)"
              strokeWidth="1.5"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 + i * 0.1, type: "spring", stiffness: 200, damping: 14 }}
            />
            <motion.text
              x={node.x}
              y={node.y + 4}
              textAnchor="middle"
              fill="var(--kp-text-2)"
              fontSize="10"
              fontWeight="600"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 + i * 0.1 }}
            >
              {node.label}
            </motion.text>
          </g>
        ))}

        {/* Floating data packets */}
        {LINKS.slice(0, 5).map(([a, b], i) => (
          <motion.circle
            key={`packet-${i}`}
            r="3"
            fill="#1f8a7a"
            initial={{ opacity: 0 }}
            animate={{
              cx: [NODES[a].x, NODES[b].x, NODES[a].x],
              cy: [NODES[a].y, NODES[b].y, NODES[a].y],
              opacity: [0, 1, 0],
            }}
            transition={{ duration: 3 + i * 0.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
          />
        ))}
      </svg>
    </div>
  );
}
