// React 19 act() 环境标记：渲染计数测试直接用 createRoot + act（无 RTL）。
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
