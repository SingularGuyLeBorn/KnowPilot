/**
 * math_block / math_inline 可编辑 NodeView：
 * 低对比编辑条 + 下方实时 KaTeX + Copilot（空公式块自动抽 10 行上下文调模型）。
 */

import katex from "katex";
import { mathBlockSchema, mathInlineSchema } from "@milkdown/plugin-math";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView, NodeView } from "@milkdown/prose/view";
import { $view } from "@milkdown/utils";
import {
  applyLatexCompletion,
  latexGhostSuffix,
  matchLatexCompletion,
  type LatexCompletion,
} from "@/components/editor/latexCompletions";
import {
  extractFormulaContext,
  requestFormulaCopilot,
} from "@/components/editor/mathFormulaCopilot";
import {
  normalizeMathAlign,
  type MathBlockAlign,
} from "@/components/editor/mathBlockAlign";

function renderKatex(target: HTMLElement, tex: string, displayMode: boolean) {
  target.replaceChildren();
  try {
    katex.render(tex, target, { displayMode, throwOnError: false });
  } catch {
    target.textContent = tex;
  }
}

function alignIconSvg(kind: MathBlockAlign): string {
  if (kind === "left") {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 6H3M15 12H3M17 18H3"/></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 6H3M17 12H7M19 18H5"/></svg>`;
}

function createMathBlockView(
  node: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("div");
  dom.className = "kp-math-block";
  dom.dataset.type = "math_block";

  const toolbar = document.createElement("div");
  toolbar.className = "kp-math-block-toolbar";

  const btnLeft = document.createElement("button");
  btnLeft.type = "button";
  btnLeft.className = "kp-math-align-btn";
  btnLeft.title = "靠左";
  btnLeft.setAttribute("aria-label", "公式靠左");
  btnLeft.innerHTML = alignIconSvg("left");

  const btnCenter = document.createElement("button");
  btnCenter.type = "button";
  btnCenter.className = "kp-math-align-btn";
  btnCenter.title = "居中";
  btnCenter.setAttribute("aria-label", "公式居中");
  btnCenter.innerHTML = alignIconSvg("center");

  toolbar.append(btnLeft, btnCenter);

  const idle = document.createElement("div");
  idle.className = "kp-math-block-idle";

  const edit = document.createElement("div");
  edit.className = "kp-math-block-edit";
  edit.hidden = true;

  const sourceRow = document.createElement("div");
  sourceRow.className = "kp-math-block-source";

  const ghost = document.createElement("div");
  ghost.className = "kp-math-block-ghost";
  ghost.setAttribute("aria-hidden", "true");

  const textarea = document.createElement("textarea");
  textarea.className = "kp-math-block-input";
  textarea.rows = 1;
  textarea.wrap = "soft";
  textarea.placeholder = "正在根据上下文补全…";
  textarea.spellcheck = false;

  const hint = document.createElement("div");
  hint.className = "kp-math-block-hint";

  const live = document.createElement("div");
  live.className = "kp-math-block-live";

  sourceRow.append(ghost, textarea);
  edit.append(sourceRow, hint, live);
  dom.append(toolbar, idle, edit);

  let editing = false;
  let value = String(node.attrs.value ?? "");
  let align: MathBlockAlign = normalizeMathAlign(node.attrs.align);
  /** 本地片段补全（\frac 等） */
  let localCompletion: LatexCompletion | null = null;
  /** 模型建议的完整 LaTeX */
  let modelLatex: string | null = null;
  let modelLoading = false;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  let abortCtrl: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 是否已对「空块首次进入」发起过自动补全 */
  let autoStarted = false;
  dom.dataset.value = value;
  dom.dataset.align = align;

  const syncAlignUi = () => {
    dom.dataset.align = align;
    btnLeft.dataset.active = align === "left" ? "true" : "false";
    btnCenter.dataset.active = align === "center" ? "true" : "false";
  };
  syncAlignUi();

  const measureGhostHeight = () => {
    if (!ghost.textContent) return 0;
    // inset:0 会把 ghost 锁在 textarea 当前高度内，需临时放开才能量到多行内容真实高度
    const prevBottom = ghost.style.bottom;
    const prevHeight = ghost.style.height;
    ghost.style.bottom = "auto";
    ghost.style.height = "auto";
    const h = ghost.scrollHeight;
    ghost.style.bottom = prevBottom;
    ghost.style.height = prevHeight;
    return h;
  };

  const autosize = () => {
    // ghost 为 absolute，不撑开 sourceRow；按 max(输入, 幽灵) 抬高，避免叠到下方 live 预览
    // 超过 CSS max-height 后保持封顶高度，由 textarea overflow-y 纵向滚动（禁止横向）
    textarea.style.height = "auto";
    const textH = Math.max(28, textarea.scrollHeight);
    const needed = Math.max(textH, measureGhostHeight());
    const cs = window.getComputedStyle(textarea);
    const maxH = Number.parseFloat(cs.maxHeight);
    const capped = Number.isFinite(maxH) && maxH > 0 ? Math.min(needed, maxH) : needed;
    textarea.style.height = `${capped}px`;
  };

  const renderIdle = () => {
    const tex = value.trim();
    if (!tex) {
      idle.classList.add("is-empty");
      idle.textContent = "公式";
      return;
    }
    idle.classList.remove("is-empty");
    renderKatex(idle, tex, true);
  };

  const renderLive = () => {
    const typed = textarea.value.trim();
    const previewTex = typed || modelLatex?.trim() || "";
    if (!previewTex) {
      live.classList.add("is-empty");
      live.classList.remove("is-suggestion");
      live.textContent = modelLoading ? "补全中…" : "预览";
      return;
    }
    live.classList.remove("is-empty");
    live.classList.toggle("is-suggestion", !typed && Boolean(modelLatex));
    renderKatex(live, previewTex, true);
  };

  const paintGhost = (typedBefore: string, suffix: string, hintText: string) => {
    ghost.replaceChildren();
    const typed = document.createElement("span");
    typed.className = "kp-math-ghost-typed";
    typed.textContent = typedBefore;
    const sug = document.createElement("span");
    sug.className = "kp-math-ghost-suffix";
    sug.textContent = suffix;
    ghost.append(typed, sug);
    hint.textContent = hintText;
    autosize();
  };

  const syncGhost = () => {
    const cur = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, cur);
    const after = textarea.value.slice(cur);
    localCompletion = null;
    ghost.replaceChildren();

    if (after.length > 0) {
      hint.textContent = modelLoading ? "补全中…" : "";
      autosize();
      return;
    }

    // 1) 本地片段优先（用户在打 \fr…）
    const local = matchLatexCompletion(before);
    if (local) {
      localCompletion = local;
      if (local.insert.startsWith(local.trigger)) {
        paintGhost(before, latexGhostSuffix(local), `Tab 接受 · ${local.label}`);
      } else {
        hint.textContent = `Tab → ${local.insert} · ${local.label}`;
        autosize();
      }
      return;
    }

    // 2) 模型幽灵：空输入显示全文；有前缀则显示后缀
    if (modelLatex) {
      if (!before) {
        paintGhost("", modelLatex, "Tab 接受 AI 补全 · Esc 忽略");
        return;
      }
      if (modelLatex.startsWith(before)) {
        paintGhost(before, modelLatex.slice(before.length), "Tab 接受 AI 补全 · Esc 忽略");
        return;
      }
      hint.textContent = "Tab 用 AI 结果替换当前输入 · Esc 忽略";
      autosize();
      return;
    }

    if (modelLoading) {
      hint.textContent = "正在根据上下文补全…";
      textarea.placeholder = "正在根据上下文补全…";
    } else if (!before.trim()) {
      hint.textContent = "Backspace 删除公式块 · Esc 完成";
      textarea.placeholder = "LaTeX… 清空后 Backspace 删除";
    } else {
      hint.textContent = "";
      textarea.placeholder = "LaTeX… Tab 补全 · Esc 完成";
    }
    autosize();
  };

  const writeAttrs = (next: { value?: string; align?: MathBlockAlign }) => {
    if (next.value !== undefined) {
      value = next.value;
      dom.dataset.value = value;
    }
    if (next.align !== undefined) {
      align = next.align;
      syncAlignUi();
    }
    const pos = getPos();
    if (typeof pos !== "number") return;
    const current = view.state.doc.nodeAt(pos);
    if (!current || current.type.name !== "math_block") return;
    if (current.attrs.value === value && normalizeMathAlign(current.attrs.align) === align) {
      return;
    }
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value, align }));
  };

  const commit = () => {
    writeAttrs({ value: textarea.value });
  };

  /** 删掉整个公式块，光标落到相邻位置（空内容 + Backspace） */
  const deleteSelf = () => {
    cancelCopilot();
    const pos = getPos();
    if (typeof pos !== "number") return;
    const current = view.state.doc.nodeAt(pos);
    if (!current || current.type.name !== "math_block") return;
    view.dispatch(view.state.tr.delete(pos, pos + current.nodeSize));
    view.focus();
  };

  const setAlign = (next: MathBlockAlign) => {
    if (align === next) return;
    writeAttrs({ value: editing ? textarea.value : value, align: next });
  };

  btnLeft.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAlign("left");
  });
  btnCenter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAlign("center");
  });

  const cancelCopilot = () => {
    abortCtrl?.abort();
    abortCtrl = null;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    modelLoading = false;
  };

  const runCopilot = (partial: string) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    cancelCopilot();
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    modelLoading = true;
    modelLatex = null;
    syncGhost();
    renderLive();

    const ctx = extractFormulaContext(view, pos);
    requestFormulaCopilot({
      before: ctx.before,
      after: ctx.after,
      partial: partial || undefined,
      signal: ctrl.signal,
    })
      .then((res) => {
        if (ctrl.signal.aborted || !editing) return;
        modelLoading = false;
        abortCtrl = null;
        if (!res?.latex) {
          syncGhost();
          renderLive();
          return;
        }
        modelLatex = res.latex;
        syncGhost();
        renderLive();
      })
      .catch(() => {
        if (ctrl.signal.aborted || !editing) return;
        modelLoading = false;
        abortCtrl = null;
        hint.textContent = "补全失败，可手动输入或再试";
        renderLive();
      });
  };

  const scheduleCopilot = (partial: string, delayMs: number) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runCopilot(partial);
    }, delayMs);
  };

  const showEdit = () => {
    if (editing) return;
    editing = true;
    textarea.value = value;
    idle.hidden = true;
    edit.hidden = false;
    dom.classList.add("is-editing");
    renderLive();
    autosize();
    syncGhost();
    requestAnimationFrame(() => {
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
      syncGhost();
    });

    // 空公式块：立刻按上下文自动补全（Copilot）
    if (!value.trim() && !autoStarted) {
      autoStarted = true;
      runCopilot("");
    }
  };

  const showIdle = () => {
    if (!editing) return;
    editing = false;
    cancelCopilot();
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    commit();
    localCompletion = null;
    modelLatex = null;
    edit.hidden = true;
    idle.hidden = false;
    dom.classList.remove("is-editing");
    renderIdle();
  };

  const acceptCompletion = () => {
    // 本地片段
    if (localCompletion) {
      const cur = textarea.selectionStart ?? textarea.value.length;
      const { next, cursor } = applyLatexCompletion(textarea.value, cur, localCompletion);
      textarea.value = next;
      textarea.setSelectionRange(cursor, cursor);
      localCompletion = null;
      modelLatex = null;
      autosize();
      renderLive();
      syncGhost();
      return true;
    }
    // 模型建议
    if (modelLatex) {
      const typed = textarea.value;
      if (!typed || modelLatex.startsWith(typed)) {
        textarea.value = modelLatex;
      } else {
        textarea.value = modelLatex;
      }
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
      modelLatex = null;
      autosize();
      renderLive();
      syncGhost();
      return true;
    }
    return false;
  };

  idle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showEdit();
  });

  textarea.addEventListener("input", () => {
    autosize();
    // 用户改字后：若与模型建议分叉，清幽灵；空着则防抖再请模型
    const typed = textarea.value;
    if (modelLatex && typed && !modelLatex.startsWith(typed)) {
      modelLatex = null;
    }
    renderLive();
    syncGhost();
    if (!typed.trim()) {
      scheduleCopilot("", 600);
    }
  });
  textarea.addEventListener("click", () => syncGhost());
  textarea.addEventListener("keyup", () => syncGhost());

  textarea.addEventListener("blur", () => {
    blurTimer = setTimeout(() => {
      if (!dom.contains(document.activeElement)) showIdle();
    }, 120);
  });

  edit.addEventListener("mousedown", (e) => {
    if (e.target === textarea) return;
    e.preventDefault();
    textarea.focus();
  });

  textarea.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Tab" && (localCompletion || modelLatex)) {
      e.preventDefault();
      acceptCompletion();
      return;
    }
    // 内容已清空（或光标在开头且无字）→ Backspace/Delete 删掉整块
    if (e.key === "Backspace" || e.key === "Delete") {
      const empty = !textarea.value.trim();
      const atStart =
        (textarea.selectionStart ?? 0) === 0 && (textarea.selectionEnd ?? 0) === 0;
      if (empty || (e.key === "Backspace" && atStart && !textarea.value)) {
        e.preventDefault();
        deleteSelf();
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (localCompletion || modelLatex || modelLoading) {
        cancelCopilot();
        localCompletion = null;
        modelLatex = null;
        ghost.replaceChildren();
        hint.textContent = "";
        renderLive();
        syncGhost();
        return;
      }
      // 空块 Esc 也删掉，避免留下占位
      if (!textarea.value.trim()) {
        deleteSelf();
        return;
      }
      showIdle();
      view.focus();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      showIdle();
      view.focus();
    }
  });

  textarea.addEventListener("mousedown", (e) => e.stopPropagation());

  renderIdle();

  if (!value.trim()) {
    requestAnimationFrame(() => showEdit());
  }

  return {
    dom,
    update(updated) {
      if (updated.type.name !== "math_block") return false;
      align = normalizeMathAlign(updated.attrs.align);
      syncAlignUi();
      if (!editing) {
        value = String(updated.attrs.value ?? "");
        dom.dataset.value = value;
        renderIdle();
      }
      return true;
    },
    selectNode() {
      showEdit();
    },
    deselectNode() {},
    stopEvent(event) {
      if (!editing) return false;
      const t = event.target as Node | null;
      return Boolean(t && edit.contains(t));
    },
    ignoreMutation: () => true,
    destroy() {
      cancelCopilot();
      if (blurTimer) clearTimeout(blurTimer);
    },
  };
}

function createMathInlineView(
  node: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("span");
  dom.className = "kp-math-inline";
  dom.dataset.type = "math_inline";

  const idle = document.createElement("span");
  idle.className = "kp-math-inline-idle";

  const edit = document.createElement("span");
  edit.className = "kp-math-inline-edit";
  edit.hidden = true;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "kp-math-inline-input";
  input.placeholder = "LaTeX";
  input.spellcheck = false;

  const live = document.createElement("span");
  live.className = "kp-math-inline-live";

  edit.append(input, live);
  dom.append(idle, edit);

  let editing = false;
  let value = node.textContent;
  let completion: LatexCompletion | null = null;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  dom.dataset.value = value;

  const renderIdle = () => {
    const tex = value.trim();
    if (!tex) {
      idle.classList.add("is-empty");
      idle.textContent = "公式";
      return;
    }
    idle.classList.remove("is-empty");
    renderKatex(idle, tex, false);
  };

  const renderLive = () => {
    const tex = input.value.trim();
    if (!tex) {
      live.classList.add("is-empty");
      live.textContent = "";
      return;
    }
    live.classList.remove("is-empty");
    renderKatex(live, tex, false);
  };

  const commit = () => {
    value = input.value;
    dom.dataset.value = value;
    const pos = getPos();
    if (typeof pos !== "number") return;
    const current = view.state.doc.nodeAt(pos);
    if (!current || current.type.name !== "math_inline") return;
    if (current.textContent === value) return;
    view.dispatch(view.state.tr.insertText(value, pos + 1, pos + current.nodeSize - 1));
  };

  const deleteSelf = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const current = view.state.doc.nodeAt(pos);
    if (!current || current.type.name !== "math_inline") return;
    view.dispatch(view.state.tr.delete(pos, pos + current.nodeSize));
    view.focus();
  };

  const refreshCompletion = () => {
    const cur = input.selectionStart ?? input.value.length;
    if (cur < input.value.length) {
      completion = null;
      return;
    }
    completion = matchLatexCompletion(input.value.slice(0, cur));
  };

  const showEdit = () => {
    if (editing) return;
    editing = true;
    input.value = value;
    idle.hidden = true;
    edit.hidden = false;
    dom.classList.add("is-editing");
    renderLive();
    requestAnimationFrame(() => {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
      refreshCompletion();
    });
  };

  const showIdle = () => {
    if (!editing) return;
    editing = false;
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    commit();
    edit.hidden = true;
    idle.hidden = false;
    dom.classList.remove("is-editing");
    renderIdle();
  };

  idle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showEdit();
  });

  input.addEventListener("input", () => {
    renderLive();
    refreshCompletion();
  });

  input.addEventListener("blur", () => {
    blurTimer = setTimeout(() => {
      if (!dom.contains(document.activeElement)) showIdle();
    }, 120);
  });

  edit.addEventListener("mousedown", (e) => {
    if (e.target === input) return;
    e.preventDefault();
    input.focus();
  });

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Tab" && completion) {
      e.preventDefault();
      const cur = input.selectionStart ?? input.value.length;
      const { next, cursor } = applyLatexCompletion(input.value, cur, completion);
      input.value = next;
      input.setSelectionRange(cursor, cursor);
      completion = null;
      renderLive();
      refreshCompletion();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      const empty = !input.value;
      const atStart =
        (input.selectionStart ?? 0) === 0 && (input.selectionEnd ?? 0) === 0;
      if (empty || (e.key === "Backspace" && atStart && !input.value)) {
        e.preventDefault();
        deleteSelf();
        return;
      }
    }
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      if (e.key === "Escape" && completion) {
        completion = null;
        return;
      }
      if (e.key === "Escape" && !input.value.trim()) {
        deleteSelf();
        return;
      }
      showIdle();
      view.focus();
    }
  });

  input.addEventListener("mousedown", (e) => e.stopPropagation());

  renderIdle();

  return {
    dom,
    update(updated) {
      if (updated.type.name !== "math_inline") return false;
      if (!editing) {
        value = updated.textContent;
        dom.dataset.value = value;
        renderIdle();
      }
      return true;
    },
    selectNode() {
      showEdit();
    },
    deselectNode() {},
    stopEvent(event) {
      if (!editing) return false;
      const t = event.target as Node | null;
      return Boolean(t && edit.contains(t));
    },
    ignoreMutation: () => true,
    destroy() {
      if (blurTimer) clearTimeout(blurTimer);
    },
  };
}

export const mathBlockEditableView = $view(mathBlockSchema.node, () => {
  return (node, view, getPos) =>
    createMathBlockView(node, view, getPos as () => number | undefined);
});

export const mathInlineEditableView = $view(mathInlineSchema.node, () => {
  return (node, view, getPos) =>
    createMathInlineView(node, view, getPos as () => number | undefined);
});
