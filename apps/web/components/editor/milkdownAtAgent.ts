/**
 * WYSIWYG：键入 @agent 唤起编辑器 Agent 补全（不切源码）。
 */

import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";
import { detectEditorAgentAtTrigger } from "@/lib/editorCompleteContext";
import { saveMilkdownSelectionRange } from "@/components/editor/milkdownSelectionApi";

export type MilkdownAtAgentHit = {
  query: string;
};

type Handler = (hit: MilkdownAtAgentHit) => void;

let handler: Handler | null = null;
let lastFiredAt = 0;

export function registerMilkdownAtAgentHandler(next: Handler | null) {
  handler = next;
}

function textBeforeCursor(view: EditorView): { text: string; from: number } {
  const { $from } = view.state.selection;
  const parentStart = $from.start();
  const text = view.state.doc.textBetween(parentStart, $from.pos, "\n", "\n");
  return { text, from: parentStart };
}

export const milkdownAtAgent = $prose(
  () =>
    new Plugin({
      key: new PluginKey("kp-milkdown-at-agent"),
      view() {
        return {
          update(view, prevState) {
            if (!handler) return;
            if (view.composing) return;
            if (view.state.doc.eq(prevState.doc)) return;
            const { from, to } = view.state.selection;
            if (from !== to) return;

            const { text, from: blockFrom } = textBeforeCursor(view);
            const hit = detectEditorAgentAtTrigger(text, text.length);
            if (!hit) return;

            // 防抖：同一次输入链路只弹一次
            const now = Date.now();
            if (now - lastFiredAt < 400) return;
            lastFiredAt = now;

            const delFrom = blockFrom + hit.tokenStart;
            const delTo = from;
            const tr = view.state.tr.delete(delFrom, delTo);
            view.dispatch(tr);
            // 冻结光标，供 Accept 插入
            saveMilkdownSelectionRange();
            handler({ query: hit.query });
          },
        };
      },
    }),
);
