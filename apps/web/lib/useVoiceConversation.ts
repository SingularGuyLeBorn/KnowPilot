"use client";

/**
 * 轻量实时语音对话编排（浏览器原生）：
 * 听（SpeechRecognition）→ 停顿自动发送 → 流式结束后朗读（speechSynthesis）→ 说话可打断朗读。
 * 不做本地 Whisper 实时流；Chrome STT 常需联网，朗读用本机 TTS。
 */

import { useCallback, useEffect, useRef } from "react";
import { useSpeechRecognition } from "@/lib/useSpeechRecognition";
import { useSpeechSynthesis } from "@/lib/useSpeechSynthesis";

const SILENCE_MS = 1400;

export type UseVoiceConversationArgs = {
  enabled: boolean;
  isStreaming: boolean;
  disabled?: boolean;
  /** 流式结束后要朗读的助手正文（父组件传入最新 assistant） */
  replyText: string | null | undefined;
  onSend: (text: string) => void;
  /** 把正在听写的内容同步到输入框（可选） */
  onDraftChange?: (text: string) => void;
};

export function useVoiceConversation({
  enabled,
  isStreaming,
  disabled,
  replyText,
  onSend,
  onDraftChange,
}: UseVoiceConversationArgs) {
  const {
    supported: ttsSupported,
    speaking,
    speak,
    cancel: cancelTts,
  } = useSpeechSynthesis({ lang: "zh-CN", rate: 1.05 });

  const bufferRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStreamingRef = useRef(false);
  const lastSpokenRef = useRef("");
  const isStreamingRef = useRef(isStreaming);
  const onSendRef = useRef(onSend);
  const onDraftRef = useRef(onDraftChange);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);
  useEffect(() => {
    onDraftRef.current = onDraftChange;
  }, [onDraftChange]);

  const flushSend = useCallback(() => {
    const text = bufferRef.current.trim();
    if (!text) return;
    if (isStreamingRef.current || disabled) return;
    bufferRef.current = "";
    onDraftRef.current?.("");
    cancelTts();
    onSendRef.current(text);
  }, [cancelTts, disabled]);

  const scheduleFlush = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      flushSend();
    }, SILENCE_MS);
  }, [flushSend]);

  const {
    supported: sttSupported,
    listening,
    interim,
    error: sttError,
    start: sttStart,
    stop: sttStop,
  } = useSpeechRecognition(
    {
      lang: "zh-CN",
      interimResults: true,
      continuous: true,
      keepAlive: true,
    },
    {
      onSpeechActivity: () => {
        if (speaking) cancelTts();
      },
      onInterim: (t) => {
        const draft = `${bufferRef.current}${bufferRef.current ? " " : ""}${t}`.trim();
        onDraftRef.current?.(draft);
      },
      onFinal: (t) => {
        if (!t) return;
        bufferRef.current = `${bufferRef.current}${bufferRef.current ? " " : ""}${t}`.trim();
        onDraftRef.current?.(bufferRef.current);
        scheduleFlush();
      },
    },
  );

  // 开关语音模式
  useEffect(() => {
    if (!enabled || disabled || !sttSupported) {
      sttStop();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      return;
    }
    sttStart();
    return () => {
      sttStop();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 enabled/disabled/support 变化时启停
  }, [enabled, disabled, sttSupported]);

  // 流式结束：朗读最新回复；若说话期间攒了下一句，稍后再发
  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (!enabled) return;
    if (was && !isStreaming) {
      const reply = (replyText || "").trim();
      if (reply && ttsSupported && reply !== lastSpokenRef.current) {
        lastSpokenRef.current = reply;
        speak(reply);
      }
      // 流式中用户说的下一段，等一轮结束后再发
      if (bufferRef.current.trim()) {
        scheduleFlush();
      }
    }
  }, [enabled, isStreaming, replyText, speak, ttsSupported, scheduleFlush]);

  useEffect(() => {
    if (!enabled) {
      cancelTts();
      bufferRef.current = "";
      lastSpokenRef.current = "";
    }
  }, [enabled, cancelTts]);

  return {
    sttSupported,
    ttsSupported,
    listening,
    speaking,
    interim,
    sttError,
    stopListening: sttStop,
    cancelSpeak: cancelTts,
  };
}
