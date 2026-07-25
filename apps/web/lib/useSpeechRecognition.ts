"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * 语音识别类型声明（Chrome/Edge 的 webkitSpeechRecognition，非 W3C 标准）
 * 识别走浏览器内置引擎（Chrome 联 Google 服务器，免费、无需 API key）。
 */
type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
};
type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  lang?: string;
  /** 识别期间是否持续输出 interim 文本 */
  interimResults?: boolean;
  /** 是否连续识别（用户停顿后是否继续） */
  continuous?: boolean;
}

export interface UseSpeechRecognitionResult {
  supported: boolean;
  listening: boolean;
  /** 当前 interim（未定稿）文本 */
  interim: string;
  /** 错误信息（如麦克风被拒、网络错误） */
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * 浏览器原生语音识别（STT）。识别结果通过 onFinal/onInterim 回调返回，
 * 由调用方决定如何填入输入框（避免 hook 直接耦合 UI state）。
 */
export function useSpeechRecognition(
  opts: UseSpeechRecognitionOptions = {},
  callbacks: { onFinal?: (text: string) => void; onInterim?: (text: string) => void } = {},
): UseSpeechRecognitionResult {
  const { lang = "zh-CN", interimResults = true, continuous = false } = opts;
  // useSyncExternalStore：SSR 用 false，客户端 hydration 后读真实值，避免 hydration mismatch（不触发 set-state-in-effect）
  const supported = useSyncExternalStore(
    () => () => {},
    () => getCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  }, [callbacks]);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      // ignore
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("当前浏览器不支持语音识别（需 Chrome/Edge）");
      return;
    }
    if (recRef.current) {
      try {
        recRef.current.abort();
      } catch {
        // ignore
      }
      recRef.current = null;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setListening(true);
      setError(null);
      setInterim("");
    };
    rec.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const alt = r[0];
        if (!alt) continue;
        if (r.isFinal) finalText += alt.transcript;
        else interimText += alt.transcript;
      }
      if (interimText) {
        setInterim(interimText);
        cbRef.current.onInterim?.(interimText);
      }
      if (finalText) {
        setInterim("");
        cbRef.current.onFinal?.(finalText.trim());
      }
    };
    rec.onerror = (e) => {
      const msg =
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "麦克风权限被拒绝"
          : e.error === "no-speech"
            ? "未检测到语音"
            : e.error === "network"
              ? "语音识别网络错误"
              : `语音识别错误：${e.error}`;
      setError(msg);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      recRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动语音识别失败");
      setListening(false);
    }
  }, [lang, continuous, interimResults]);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        // ignore
      }
      recRef.current = null;
    };
  }, []);

  return { supported, listening, interim, error, start, stop };
}
