"use client";

import { useState } from "react";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";
import { cn } from "@/lib/utils";

interface ShellProps {
  children: React.ReactNode;
  className?: string;
}

export function Shell({ children, className }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar onMenuClick={() => setMobileMenuOpen((v) => !v)} />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <Sidebar className="hidden lg:flex" />

        {/* Mobile sidebar overlay */}
        {mobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <Sidebar className="fixed inset-y-0 left-0 z-50 flex pt-16 lg:hidden" />
          </>
        )}

        <main
          className={cn(
            "flex-1 overflow-y-auto bg-[var(--kp-bg)]",
            className
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
