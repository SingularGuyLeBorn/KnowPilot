"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError] 全局错误边界捕获:", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          backgroundColor: "#f5f3f0",
          color: "#2d2824",
        }}
      >
        <div
          style={{
            padding: "24px 32px",
            borderRadius: "16px",
            border: "1px solid #e0d9d0",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            textAlign: "center",
            maxWidth: "480px",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 600 }}>
            应用发生了严重错误
          </h2>
          <p style={{ margin: "0 0 16px", fontSize: "14px", color: "#6b6359" }}>
            根布局渲染异常。请尝试刷新页面，或清除浏览器缓存后重试。
          </p>
          {process.env.NODE_ENV !== "production" && (
            <pre
              style={{
                margin: "0 0 16px",
                padding: "12px",
                maxHeight: "160px",
                overflow: "auto",
                borderRadius: "8px",
                background: "#f0ede8",
                fontSize: "12px",
                color: "#8a8278",
                textAlign: "left",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {error.message}
              {error.digest ? `\n digest: ${error.digest}` : ""}
            </pre>
          )}
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <button
              onClick={reset}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "none",
                background: "#6b5b4e",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              重试
            </button>
            <Link
              href="/"
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #e0d9d0",
                background: "transparent",
                color: "#6b6359",
                fontSize: "14px",
                fontWeight: 500,
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              返回首页
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
