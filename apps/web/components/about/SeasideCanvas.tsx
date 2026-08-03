"use client";

import { useEffect, useRef } from "react";

export function SeasideCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId = 0;
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let time = 0;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      time += 0.007;

      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, height * 0.62);
      sky.addColorStop(0, "#0b1026");
      sky.addColorStop(0.35, "#2e1065");
      sky.addColorStop(0.65, "#9a3412");
      sky.addColorStop(1, "#f59e0b");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // Distant stars
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      for (let i = 0; i < 60; i++) {
        const x = ((i * 137.5) % width);
        const y = ((i * 73.3) % (height * 0.45));
        const twinkle = 0.3 + 0.7 * Math.sin(time * 2 + i);
        ctx.globalAlpha = twinkle * 0.6;
        ctx.beginPath();
        ctx.arc(x, y, 0.7 + (i % 3) * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Sun
      const sunX = width * 0.72;
      const sunY = height * 0.54;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 90);
      glow.addColorStop(0, "rgba(255, 245, 220, 0.9)");
      glow.addColorStop(0.25, "rgba(255, 190, 80, 0.4)");
      glow.addColorStop(0.6, "rgba(255, 100, 40, 0.12)");
      glow.addColorStop(1, "rgba(200, 50, 30, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#fff7ed";
      ctx.beginPath();
      ctx.arc(sunX, sunY, 20, 0, Math.PI * 2);
      ctx.fill();

      // Horizon
      const horizonY = height * 0.62;

      // Ocean base
      const ocean = ctx.createLinearGradient(0, horizonY, 0, height);
      ocean.addColorStop(0, "#1e3a8a");
      ocean.addColorStop(0.3, "#115e59");
      ocean.addColorStop(0.7, "#155e75");
      ocean.addColorStop(1, "#164e63");
      ctx.fillStyle = ocean;
      ctx.fillRect(0, horizonY, width, height - horizonY);

      // Sun reflection
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 14; i++) {
        const y = horizonY + (i / 14) * (height * 0.28);
        const w = 70 * (1 - i / 16) * (0.75 + 0.25 * Math.sin(time * 2.5 + i));
        ctx.fillStyle = `rgba(255, 220, 140, ${0.16 - i * 0.009})`;
        ctx.beginPath();
        ctx.ellipse(sunX, y, Math.max(2, w / 2), 2 + i * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Waves
      for (let layer = 0; layer < 5; layer++) {
        const baseY = horizonY + layer * (height * 0.055) + 10;
        const amp = 3 + layer * 1.2;
        const freq = 0.008 + layer * 0.0015;
        const speed = time * (1.1 + layer * 0.25);
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x += 5) {
          const y = baseY + Math.sin(x * freq + speed) * amp + Math.sin(x * freq * 2.2 - speed * 1.3) * (amp * 0.45);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        const waveGrad = ctx.createLinearGradient(0, baseY - 8, 0, baseY + 45);
        waveGrad.addColorStop(0, `rgba(56, 189, 248, ${0.14 - layer * 0.018})`);
        waveGrad.addColorStop(1, `rgba(8, 145, 178, ${0.28 - layer * 0.035})`);
        ctx.fillStyle = waveGrad;
        ctx.fill();
      }

      // Beach / shore
      const shoreBase = height * 0.84;
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, shoreBase + Math.sin(time * 0.8) * 2);
      for (let x = 0; x <= width; x += 6) {
        const y = shoreBase + Math.sin(x * 0.009 + time) * 4 + Math.cos(x * 0.021 - time * 0.6) * 3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      const sand = ctx.createLinearGradient(0, shoreBase, 0, height);
      sand.addColorStop(0, "#e7d3b8");
      sand.addColorStop(0.5, "#cbb28f");
      sand.addColorStop(1, "#a69078");
      ctx.fillStyle = sand;
      ctx.fill();

      // Foam
      ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 6) {
        const y = shoreBase + Math.sin(x * 0.009 + time) * 4 + Math.cos(x * 0.021 - time * 0.6) * 3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Seagulls
      ctx.strokeStyle = "rgba(15, 15, 25, 0.55)";
      ctx.lineWidth = 1.5;
      const gulls = [
        { x: width * 0.16, y: height * 0.22, s: 1 },
        { x: width * 0.24, y: height * 0.17, s: 0.8 },
        { x: width * 0.1, y: height * 0.27, s: 0.65 },
      ];
      for (const g of gulls) {
        const wing = Math.sin(time * 3 + g.x) * 4;
        ctx.beginPath();
        ctx.moveTo(g.x - 8 * g.s, g.y + wing * g.s);
        ctx.quadraticCurveTo(g.x - 3 * g.s, g.y - 4 * g.s, g.x, g.y + (wing - 1) * g.s);
        ctx.quadraticCurveTo(g.x + 3 * g.s, g.y - 4 * g.s, g.x + 8 * g.s, g.y + wing * g.s);
        ctx.stroke();
      }

      animationId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}
