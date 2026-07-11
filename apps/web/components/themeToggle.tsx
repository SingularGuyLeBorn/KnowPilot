"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type ThemeOption = { value: "light" | "dark" | "system"; label: string; icon: React.ReactNode };

const OPTIONS: ThemeOption[] = [
  { value: "light", label: "浅色", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "深色", icon: <Moon className="h-4 w-4" /> },
  { value: "system", label: "跟随系统", icon: <Monitor className="h-4 w-4" /> },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-1", className)}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setTheme(opt.value)}
          title={opt.label}
          aria-label={opt.label}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-[var(--kp-text-3)] transition",
            theme === opt.value && "bg-[var(--kp-bg)] text-[var(--kp-brand-deep)] shadow-sm",
          )}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
