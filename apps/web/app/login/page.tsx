"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Lock, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { setAuthToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/chat";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation({
    onSuccess: (res) => {
      if (res.success && res.data?.token) {
        setAuthToken(res.data.token);
        router.replace(redirect);
      }
    },
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate({ password });
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-8 shadow-lg"
      >
        <div className="mb-6 space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-[var(--kp-text-1)]">KnowPilot 登录</h1>
          <p className="text-xs text-[var(--kp-text-3)]">
            远程访问已启用密码保护（AUTH_MODE=password）
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入访问密码"
            data-testid="login-password"
            className="w-full rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-4 py-3 text-sm outline-none focus:border-[var(--kp-brand-deep)]"
            autoFocus
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button
            type="submit"
            disabled={login.isPending || !password}
            className="w-full rounded-xl bg-[var(--kp-brand-deep)] text-white hover:opacity-90"
          >
            {login.isPending ? "验证中…" : "进入控制台"}
          </Button>
        </form>

        <p className="mt-6 flex items-center justify-center gap-1 text-[10px] text-[var(--kp-text-3)]">
          <Sparkles className="h-3 w-3" />
          本地开发可在 .env 设置 AUTH_MODE=none 关闭鉴权
        </p>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[70vh] items-center justify-center text-sm text-[var(--kp-text-3)]">
          加载登录页…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
