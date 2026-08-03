"use client";

import { motion, useInView } from "framer-motion";
import { ReactNode, useRef } from "react";

import { useMainScrollRoot } from "@/components/layout/MainScrollContext";

const easeSpring = [0.22, 1, 0.36, 1] as const;

function useMainScrollRootRef() {
  return useMainScrollRoot();
}

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  direction?: "up" | "down" | "left" | "right";
  delay?: number;
  duration?: number;
  distance?: number;
  once?: boolean;
  amount?: number;
  style?: React.CSSProperties;
}

export function ScrollReveal({
  children,
  className,
  direction = "up",
  delay = 0,
  duration = 0.7,
  distance = 28,
  once = true,
  amount = 0.25,
  style,
}: ScrollRevealProps) {
  const root = useMainScrollRootRef();
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { root, once, amount });

  const dir = {
    up: { y: distance, x: 0 },
    down: { y: -distance, x: 0 },
    left: { x: distance, y: 0 },
    right: { x: -distance, y: 0 },
  }[direction];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, ...dir }}
      animate={isInView ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, ...dir }}
      transition={{ duration, delay, ease: easeSpring }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
  stagger?: number;
  once?: boolean;
}

export function StaggerContainer({ children, className, stagger = 0.08, once = true }: StaggerContainerProps) {
  const root = useMainScrollRootRef();
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { root, once, amount: 0.15 });

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={{
        visible: { transition: { staggerChildren: stagger } },
        hidden: {},
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  direction = "up",
}: {
  children: ReactNode;
  className?: string;
  direction?: "up" | "down" | "left" | "right";
}) {
  const dir = {
    up: { y: 24, x: 0 },
    down: { y: -24, x: 0 },
    left: { x: 24, y: 0 },
    right: { x: -24, y: 0 },
  }[direction];

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, ...dir },
        visible: { opacity: 1, x: 0, y: 0, transition: { duration: 0.6, ease: easeSpring } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
