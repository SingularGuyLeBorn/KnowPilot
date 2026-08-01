"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * 浏览器原生语音合成（TTS，speechSynthesis）。纯本地引擎，免费、无需 API key。
 * 支持朗读、暂停、停止、语速/音调/音量调节、选择语音（zh-CN 优先）。
 */

export interface UseSpeechSynthesisOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface UseSpeechSynthesisResult {
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  /** 当前正在朗读的文本（用于 UI 高亮） */
  speakingText: string;
  voices: SpeechSynthesisVoice[];
  speak: (text: string) => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  // 优先精确匹配 lang 的本地语音，其次前缀匹配，再次任意中文
  const local = voices.filter((v) => v.localService);
  const pool = local.length > 0 ? local : voices;
  const exact = pool.find((v) => v.lang === lang);
  if (exact) return exact;
  const prefix = lang.split("-")[0];
  const byPrefix = pool.find((v) => v.lang.startsWith(prefix));
  if (byPrefix) return byPrefix;
  return pool[0] ?? null;
}

const emptySubscribe = () => () => {};

export function useSpeechSynthesis(
  opts: UseSpeechSynthesisOptions = {},
): UseSpeechSynthesisResult {
  const { lang = "zh-CN", rate = 1, pitch = 1, volume = 1 } = opts;
  // useSyncExternalStore：SSR 用 false，客户端 hydration 后读真实值，避免 hydration mismatch（不触发 set-state-in-effect）
  const supported = useSyncExternalStore(
    emptySubscribe,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speakingText, setSpeakingText] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const optsRef = useRef({ lang, rate, pitch, volume });
  useEffect(() => {
    optsRef.current = { lang, rate, pitch, volume };
  }, [lang, rate, pitch, volume]);

  useEffect(() => {
    if (!supported) return;
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) setVoices(v);
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, [supported]);

  const cancel = useCallback(() => {
    if (!supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    setSpeaking(false);
    setPaused(false);
    setSpeakingText("");
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      // 切换朗读目标时先取消旧的
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
      const clean = text.replace(/```[\s\S]*?```/g, "（代码块）").replace(/[#*`_~>\[\]()!]/g, "").trim();
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean);
      const { lang: l, rate: r, pitch: p, volume: vol } = optsRef.current;
      u.lang = l;
      u.rate = r;
      u.pitch = p;
      u.volume = vol;
      const v = pickVoice(window.speechSynthesis.getVoices(), l);
      if (v) u.voice = v;
      u.onstart = () => {
        setSpeaking(true);
        setPaused(false);
        setSpeakingText(text);
      };
      u.onend = () => {
        setSpeaking(false);
        setPaused(false);
        setSpeakingText("");
      };
      u.onerror = () => {
        setSpeaking(false);
        setPaused(false);
        setSpeakingText("");
      };
      try {
        window.speechSynthesis.speak(u);
      } catch {
        // ignore
      }
    },
    [supported],
  );

  const pause = useCallback(() => {
    if (!supported) return;
    try {
      window.speechSynthesis.pause();
      setPaused(true);
    } catch {
      // ignore
    }
  }, [supported]);

  const resume = useCallback(() => {
    if (!supported) return;
    try {
      window.speechSynthesis.resume();
      setPaused(false);
    } catch {
      // ignore
    }
  }, [supported]);

  useEffect(() => {
    return () => {
      if (supported) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [supported]);

  return { supported, speaking, paused, speakingText, voices, speak, cancel, pause, resume };
}
