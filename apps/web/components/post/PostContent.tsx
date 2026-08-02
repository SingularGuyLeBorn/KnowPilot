"use client";

import { memo, useMemo, useState, useId, useRef, useEffect, isValidElement, type ReactNode, type ReactElement, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { Check, Copy, Eye, Code2, Maximize2, Minimize2, WrapText, ListOrdered } from "lucide-react";
import { cn } from "@/lib/utils";
// KaTeX CSS 只在根布局 layout.tsx 导入一次，避免 client chunk 延迟加载导致公式初始闪烁
import { transformWikiLinks } from "./WikiLink";
import { PostMarkdownLink } from "./PostMarkdownLink";
import { RoughAnnotation, type RoughAnnotationProps } from "./RoughAnnotation";
import { memoizeMarkdownTransform } from "@knowpilot/shared";
import { useShowCodeLineNumbers } from "@/lib/codeBlockPrefs";
import { MarkdownTable } from "@/components/post/MarkdownTable";
import { isMathClassName } from "@/components/post/KatexFormula";
import { KatexHtml } from "@/components/post/KatexHtml";
import { buildTocItems, type TocItem } from "@/components/post/TableOfContents";
import dynamic from "next/dynamic";
import "highlight.js/styles/github.css";

/** Remotion 很重：按需加载，避免整页卡在 Next「Rendering…」 */
const VizEmbed = dynamic(
  () => import("@/components/post/VizEmbed").then((m) => m.VizEmbed),
  {
    ssr: false,
    // padding 外框与真实 VizEmbed 对齐，禁止 my-6 margin（Virtuoso 测不到）在加载完成时跳变滚顶
    loading: () => (
      <div className="py-6" data-no-edit-click>
        <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-[var(--kp-divider)] bg-white text-sm text-[var(--kp-text-3)]">
          加载动画…
        </div>
      </div>
    ),
  },
);

/** 手写画板预览：按需加载，避免文章页主包绑死 BoardCanvas */
const BoardPreview = dynamic(
  () => import("@/components/editor/BoardCanvas").then((m) => m.BoardPreview),
  {
    ssr: false,
    loading: () => (
      <div
        className="my-4 flex h-40 items-center justify-center rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] text-sm text-[var(--kp-text-3)]"
        data-no-edit-click
      >
        加载画板…
      </div>
    ),
  },
);

interface PostContentProps {
  content: string;
  className?: string;
  postSlug?: string;
  /** 当前文章所属花园；内链解析优先同库匹配 */
  postGarden?: string;
}

function urlTransform(url: string) {
  const colonIndex = url.indexOf(":");
  // 没有协议说明是相对路径，放行
  if (colonIndex === -1) return url;
  const scheme = url.slice(0, colonIndex + 1).toLowerCase();
  const allowed = ["http:", "https:", "mailto:", "tel:", "data:", "wiki:"];
  return allowed.includes(scheme) ? url : "";
}

/** 将 Markdown 中的相对图片地址解析为可访问的静态资源 URL */
function resolveAssetUrl(src: string, postSlug?: string) {
  if (!postSlug) return src;
  // 协议链接、协议相对链接或绝对路径保持原样
  if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src)) return src;

  const slugDir = postSlug.replace(/\/[^/]+$/, "");
  const base = `http://a/${slugDir ? `${slugDir}/` : ""}`;
  const resolved = new URL(src, base).pathname;
  return `/api/posts/assets${resolved}`;
}

/** 可渲染为 iframe 预览的语言（HTML/可独立运行的标记） */
const PREVIEWABLE_LANGS = new Set(["html", "htm", "svg"]);

interface CodeBlockState {
  mode: "code" | "preview";
  wrap: boolean;
  maximized: boolean;
}

/** 逻辑行数：末尾单独换行不计入空行 */
function countCodeLines(code: string): number {
  if (!code) return 1;
  const parts = code.split("\n");
  const n = code.endsWith("\n") ? parts.length - 1 : parts.length;
  return Math.max(n, 1);
}

function CodeToolbar({
  language,
  code,
  state,
  setState,
  showLineNumbers,
  onToggleLineNumbers,
}: {
  language: string;
  code: string;
  state: CodeBlockState;
  setState: (next: Partial<CodeBlockState>) => void;
  showLineNumbers: boolean;
  onToggleLineNumbers: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const canPreview = PREVIEWABLE_LANGS.has(language.toLowerCase());

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="kp-code-toolbar">
      <span className="font-mono uppercase tracking-wider">{language || "text"}</span>
      <div className="flex items-center gap-1">
        {/* 代码 / 预览 切换（仅可渲染语言显示） */}
        {canPreview && (
          <div className="flex items-center rounded-md bg-[var(--kp-bg)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setState({ mode: "code" })}
              className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors ${
                state.mode === "code"
                  ? "bg-[var(--kp-brand)] text-white"
                  : "text-[var(--kp-text-2)] hover:text-[var(--kp-text-1)]"
              }`}
              aria-label="代码视图"
            >
              <Code2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setState({ mode: "preview" })}
              className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors ${
                state.mode === "preview"
                  ? "bg-[var(--kp-brand)] text-white"
                  : "text-[var(--kp-text-2)] hover:text-[var(--kp-text-1)]"
              }`}
              aria-label="预览视图"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 行号：全局偏好，一处切换全站代码块同步 */}
        <button
          type="button"
          onClick={onToggleLineNumbers}
          className={`rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg)] hover:text-[var(--kp-text-1)] ${
            showLineNumbers ? "text-[var(--kp-brand)]" : ""
          }`}
          aria-label={showLineNumbers ? "隐藏行号" : "显示行号"}
          title={showLineNumbers ? "隐藏行号（全局）" : "显示行号（全局）"}
          aria-pressed={showLineNumbers}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>

        {/* 换行切换 */}
        <button
          type="button"
          onClick={() => setState({ wrap: !state.wrap })}
          className={`group/wrap rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg)] hover:text-[var(--kp-text-1)] ${
            state.wrap ? "text-[var(--kp-brand)]" : ""
          }`}
          aria-label={state.wrap ? "关闭自动换行" : "开启自动换行"}
          title={state.wrap ? "关闭自动换行" : "开启自动换行"}
        >
          <WrapText className="h-3.5 w-3.5" />
        </button>

        {/* 复制 */}
        <button
          type="button"
          onClick={handleCopy}
          className="group/copy rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg)] hover:text-[var(--kp-text-1)]"
          aria-label={copied ? "已复制" : "复制代码"}
          title={copied ? "已复制" : "复制代码"}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>

        {/* 最大化 / 还原 */}
        <button
          type="button"
          onClick={() => setState({ maximized: !state.maximized })}
          className="rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg)] hover:text-[var(--kp-text-1)]"
          aria-label={state.maximized ? "还原" : "最大化"}
          title={state.maximized ? "还原" : "最大化"}
        >
          {state.maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

/** 代码预览：用 Shadow DOM 渲染，无内部滚动条，随页面自然滚动；
 * 样式与脚本隔离在 shadow root 内，不污染父页。 */
function CodePreview({ code }: { code: string; language: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let shadow = el.shadowRoot;
    if (!shadow) {
      shadow = el.attachShadow({ mode: "open" });
    }
    // SVG 需要根标签，HTML 直接写入
    shadow.innerHTML = code;
  }, [code]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg bg-white"
      data-no-edit-click
    />
  );
}

function getText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getText).join("");
  if (isValidElement(node)) return getText((node as ReactElement<{ children?: ReactNode }>).props.children);
  return "";
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]/g, "")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "");
}

function MarkdownSpan({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  // 公式已改走 KatexHtml（renderToString）；此处不再拦截 katex 根节点
  return (
    <span className={className} {...props}>
      {children}
    </span>
  );
}

function Heading({
  level,
  id: propId,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { level: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const fallbackId = useId();
  const text = getText(children);
  const id =
    (typeof propId === "string" && propId) ||
    slugify(text) ||
    `heading-${level}-${fallbackId.replace(/[^a-z0-9]/gi, "").slice(0, 6)}`;
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const hashes = "#".repeat(level);
  return (
    <Tag id={id} className="group relative scroll-mt-40" {...props}>
      {children}
      <a
        href={`#${id}`}
        className="kp-heading-anchor"
        aria-label={`${level} 级标题 ${hashes} · 复制锚点链接`}
        title={`${level} 级标题 · ${hashes}`}
        onClick={(e) => {
          e.preventDefault();
          history.replaceState(null, "", `#${id}`);
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        <span className="kp-heading-level" aria-hidden>
          {hashes}
        </span>
      </a>
    </Tag>
  );
}

function Pre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  let language = "";
  let childClass = "";

  if (isValidElement(children)) {
    childClass = ((children as ReactElement<{ className?: string }>).props.className) || "";
    const match = /language-([\w-]+)/.exec(childClass);
    if (match) language = match[1];
  }

  const isMathBlock = isMathClassName(childClass) || language === "math";
  const isBoardBlock = language === "kp-board" || language === "board";
  const isVizBlock = language === "viz" || language === "algoviz";
  const codeText = getText(children);
  const lineCount = useMemo(() => countCodeLines(codeText), [codeText]);
  const [showLineNumbers, setShowLineNumbers] = useShowCodeLineNumbers();
  const [state, setState] = useState<CodeBlockState>({ mode: "code", wrap: false, maximized: false });
  const canPreview = PREVIEWABLE_LANGS.has(language.toLowerCase());
  const update = (next: Partial<CodeBlockState>) => setState((prev) => ({ ...prev, ...next }));
  const toggleLineNumbers = () => setShowLineNumbers(!showLineNumbers);

  // 展示型公式：官方 HTML 字符串注入（hooks 已全部调用完再分支）
  if (isMathBlock) {
    return <KatexHtml tex={codeText} display />;
  }

  if (isBoardBlock) {
    return <BoardPreview raw={codeText} />;
  }

  if (isVizBlock) {
    return (
      <div className="py-6">
        <VizEmbed raw={codeText} />
      </div>
    );
  }

  const codeView = (
    <div className={`kp-code-body${showLineNumbers ? " kp-code-body--lines" : ""}`}>
      {showLineNumbers && (
        <div className="kp-code-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
      )}
      <pre
        {...props}
        className={`kp-code-pre text-sm ${
          state.wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
        }`}
      >
        {children}
      </pre>
    </div>
  );

  const body = (
    <>
      {state.mode === "preview" && canPreview ? (
        <div className="min-h-[400px] h-[60vh] w-full">
          <CodePreview code={codeText} language={language} />
        </div>
      ) : (
        codeView
      )}
    </>
  );

  const toolbar = (
    <CodeToolbar
      language={language}
      code={codeText}
      state={state}
      setState={update}
      showLineNumbers={showLineNumbers}
      onToggleLineNumbers={toggleLineNumbers}
    />
  );

  return (
    <>
      <div className="kp-code-block my-6 overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]">
        {toolbar}
        {body}
      </div>
      {/* 最大化 overlay：fixed 全屏，Esc 还原 */}
      {state.maximized && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-[var(--kp-bg)]"
          role="dialog"
          aria-modal="true"
          aria-label="代码最大化视图"
          onKeyDown={(e) => {
            if (e.key === "Escape") update({ maximized: false });
          }}
          tabIndex={-1}
        >
          {toolbar}
          <div className="flex-1 overflow-auto">{body}</div>
        </div>
      )}
    </>
  );
}

const HTML5_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "blockquote", "br", "caption", "cite", "code",
  "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "iframe", "img", "ins", "kbd",
  "li", "main", "mark", "nav", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "section", "small",
  "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time",
  "tr", "u", "ul", "var", "video", "audio", "source", "input", "label", "form", "button",
]);

const CUSTOM_TAGS = new Set(["thinkingnode"]);

type RehypeElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown> & { className?: string | string[] };
  children: RehypeNode[];
};

type RehypeNode = RehypeElement | { type: string; children?: RehypeNode[] };

type RehypeRoot = { type: "root"; children: RehypeNode[] };

/** 将未知自定义 HTML 标签降级为 div，避免 React 控制台报错 */
function rehypeNormalizeCustomTags() {
  return (tree: RehypeRoot) => {
    if (!tree || !Array.isArray(tree.children)) return;
    const walk = (node: RehypeNode) => {
      if (!node || node.type !== "element") return;
      const el = node as RehypeElement;
      if (el.tagName === "llmguidepage") {
        el.tagName = "div";
        el.properties = { ...el.properties, "data-removed": "llmguidepage" };
        el.children = [];
      } else if (!HTML5_TAGS.has(el.tagName) && !CUSTOM_TAGS.has(el.tagName)) {
        el.properties = {
          ...el.properties,
          className: ["kp-md-fallback", ...(Array.isArray(el.properties?.className) ? el.properties.className : el.properties?.className ? [String(el.properties.className)] : [])],
          "data-original-tag": el.tagName,
        };
        el.tagName = "div";
      }
      if (Array.isArray(el.children)) {
        for (const child of el.children) walk(child);
      }
    };
    for (const child of tree.children) walk(child);
  };
}

/** rehype-raw 不带 sanitize：iframe/object/embed 可嵌入任意第三方内容，整节点丢弃（script 已在 components 层丢弃） */
const UNSAFE_EMBED_TAGS = new Set(["iframe", "object", "embed"]);

function rehypeDropUnsafeEmbeds() {
  return (tree: RehypeRoot) => {
    if (!tree || !Array.isArray(tree.children)) return;
    const walk = (node: RehypeRoot | RehypeNode) => {
      const children = node.children;
      if (!Array.isArray(children)) return;
      // 先过滤掉嵌入节点本身，再递归其余子节点
      const kept = children.filter(
        (child) => !(child.type === "element" && UNSAFE_EMBED_TAGS.has((child as RehypeElement).tagName)),
      );
      node.children = kept;
      for (const child of kept) walk(child);
    };
    walk(tree);
  };
}

/**
 * 把 TOC 预计算的 id 写回 h2-h4。
 * 与 TableOfContents 共用 buildTocItems，彻底消除「重复标题 id 冲突」
 * 和「math/特殊字符导致正文与目录 id 不一致」两种跳转失效。
 * index 必须放在返回函数内部：React 严格模式/重渲染时插件会被多次调用，
 * 闭包外的 index 会累加导致第二次调用跳过所有标题。
 */
function rehypeHeadingIds(items: TocItem[]) {
  return (tree: RehypeRoot) => {
    let index = 0;
    // 防御：某些 rehype 调用链（如空内容/SSR 片段）可能传非 root 或 undefined
    if (!tree || !Array.isArray(tree.children)) return;
    const walk = (node: RehypeNode) => {
      if (!node || node.type !== "element") return;
      const el = node as RehypeElement;
      if (/^h[2-4]$/.test(el.tagName) && index < items.length) {
        const item = items[index++];
        if (item?.id) {
          el.properties = { ...el.properties, id: item.id };
        }
      }
      if (Array.isArray(el.children)) {
        for (const child of el.children) walk(child);
      }
    };
    for (const child of tree.children) walk(child);
  };
}

function ThinkingNode({
  category,
  children,
  ...props
}: ComponentPropsWithoutRef<"aside"> & { category?: string }) {
  return (
    <aside
      {...props}
      className="my-4 rounded-xl border border-[var(--kp-brand)]/20 bg-[var(--kp-brand)]/5 px-4 py-3 not-prose"
    >
      {category && (
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--kp-brand-deep)]">
          {category}
        </div>
      )}
      <div className="text-sm leading-relaxed text-[var(--kp-text-2)]">{children}</div>
    </aside>
  );
}

export const PostContent = memo(function PostContent({
  content,
  className,
  postSlug,
  postGarden,
}: PostContentProps) {
  const processedContent = useMemo(
    () => memoizeMarkdownTransform(content, transformWikiLinks),
    [content],
  );

  const tocItems = useMemo(() => buildTocItems(content), [content]);
  // 公式：remark-math 产出 code.language-math → KatexHtml(renderToString)
  // 不再用 rehype-katex→React 子树（空 strut 易丢，下标飞掉）
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(
    () =>
      [
        rehypeRaw,
        rehypeNormalizeCustomTags,
        rehypeDropUnsafeEmbeds,
        rehypeHeadingIds(tocItems),
        rehypeHighlight,
      ] as NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>,
    [tocItems],
  );

  const components = useMemo<Components>(
    () =>
      ({
        // rehype-raw 可能带进正文里的 <script>；React 客户端永不执行，直接丢弃避免控制台报错
        script: () => null,
        a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) => (
          <PostMarkdownLink href={href} postSlug={postSlug} postGarden={postGarden} {...props}>
            {children}
          </PostMarkdownLink>
        ),
        h1: (props: ComponentPropsWithoutRef<"h1"> & { node?: unknown }) => <Heading level={1} {...props} />,
        h2: (props: ComponentPropsWithoutRef<"h2"> & { node?: unknown }) => <Heading level={2} {...props} />,
        h3: (props: ComponentPropsWithoutRef<"h3"> & { node?: unknown }) => <Heading level={3} {...props} />,
        h4: (props: ComponentPropsWithoutRef<"h4"> & { node?: unknown }) => <Heading level={4} {...props} />,
        h5: (props: ComponentPropsWithoutRef<"h5"> & { node?: unknown }) => <Heading level={5} {...props} />,
        h6: (props: ComponentPropsWithoutRef<"h6"> & { node?: unknown }) => <Heading level={6} {...props} />,
        img: ({ src, alt }: ComponentPropsWithoutRef<"img"> & { node?: unknown }) => {
          if (typeof src !== "string") return null;
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveAssetUrl(src, postSlug)}
              alt={alt || ""}
              className="rounded-xl border border-[var(--kp-divider)]"
              loading="lazy"
            />
          );
        },
        code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => {
          const cls = typeof className === "string" ? className : "";
          // 行内公式在此直接渲染；块级 math-display 保持 <code> 交给 Pre（否则 Pre 认不出）
          if (cls.includes("math-inline")) {
            return <KatexHtml tex={getText(children)} display={false} />;
          }

          const isBlock =
            typeof className === "string" &&
            (className.includes("language-") || className.includes("hljs"));

          if (isBlock) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }

          return (
            <code className="kp-inline-code" {...props}>
              {children}
            </code>
          );
        },
        span: MarkdownSpan as Components["span"],
        pre: Pre as Components["pre"],
        // 用 div 代替 p：避免 display 公式 / 代码块等块级结构落入 <p> 触发 hydration
        p: ({ children, className, ...props }: ComponentPropsWithoutRef<"div"> & { node?: unknown }) => (
          <div className={["kp-md-p", className].filter(Boolean).join(" ")} {...props}>
            {children}
          </div>
        ),
        table: ({ children, ...props }: ComponentPropsWithoutRef<"table"> & { node?: unknown }) => (
          <MarkdownTable {...props}>{children}</MarkdownTable>
        ),
        thinkingnode: ({
          category,
          children,
          ...props
        }: ComponentPropsWithoutRef<"aside"> & { category?: unknown; node?: unknown }) => (
          <ThinkingNode category={typeof category === "string" ? category : undefined} {...props}>
            {children}
          </ThinkingNode>
        ),
        kbd: ({ children, ...props }: ComponentPropsWithoutRef<"kbd"> & { node?: unknown }) => (
          <kbd
            className="rounded border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-1.5 py-0.5 font-mono text-xs shadow-xs text-[var(--kp-text-1)]"
            {...props}
          >
            {children}
          </kbd>
        ),
        mark: ({ children, ...props }: ComponentPropsWithoutRef<"mark"> & { node?: unknown }) => {
          const rest = props as Record<string, unknown>;
          const annotationType =
            typeof rest["data-annotation"] === "string"
              ? rest["data-annotation"]
              : typeof rest["dataAnnotation"] === "string"
              ? rest["dataAnnotation"]
              : undefined;
          if (!annotationType) {
            return (
              <mark className="rounded-sm bg-[var(--kp-brand-soft)] px-1 py-0.5 text-inherit" {...props}>
                {children}
              </mark>
            );
          }
          const color =
            typeof rest["data-color"] === "string"
              ? rest["data-color"]
              : typeof rest["dataColor"] === "string"
              ? rest["dataColor"]
              : undefined;
          const bracket =
            typeof rest["data-bracket"] === "string"
              ? rest["data-bracket"]
              : typeof rest["dataBracket"] === "string"
              ? rest["dataBracket"]
              : undefined;
          const target =
            typeof rest["data-target"] === "string"
              ? rest["data-target"]
              : typeof rest["dataTarget"] === "string"
              ? rest["dataTarget"]
              : undefined;

          return (
            <RoughAnnotation
              type={annotationType}
              color={color}
              bracket={bracket as RoughAnnotationProps["bracket"]}
              target={target}
              strokeWidth={
                typeof rest["data-stroke-width"] === "string"
                  ? Number(rest["data-stroke-width"])
                  : typeof rest["dataStrokeWidth"] === "string"
                  ? Number(rest["dataStrokeWidth"])
                  : undefined
              }
              padding={
                typeof rest["data-padding"] === "string"
                  ? Number(rest["data-padding"])
                  : typeof rest["dataPadding"] === "string"
                  ? Number(rest["dataPadding"])
                  : undefined
              }
              iterations={
                typeof rest["data-iterations"] === "string"
                  ? Number(rest["data-iterations"])
                  : typeof rest["dataIterations"] === "string"
                  ? Number(rest["dataIterations"])
                  : undefined
              }
              multiline={rest["data-multiline"] !== "false" && rest["dataMultiline"] !== "false"}
              animate={rest["data-animate"] !== "false" && rest["dataAnimate"] !== "false"}
              animationDuration={
                typeof rest["data-animation-duration"] === "string"
                  ? Number(rest["data-animation-duration"])
                  : typeof rest["dataAnimationDuration"] === "string"
                  ? Number(rest["dataAnimationDuration"])
                  : undefined
              }
            >
              {children}
            </RoughAnnotation>
          );
        },
        video: ({ src, children, ...props }: ComponentPropsWithoutRef<"video"> & { node?: unknown }) => {
          const resolved = typeof src === "string" ? src : undefined;
          return (
            <video
              {...props}
              src={resolved}
              className="my-6 aspect-video w-full overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-black"
              controls
              playsInline
              preload="metadata"
            >
              {children}
            </video>
          );
        },
      }) as Components,
    [postSlug, postGarden],
  );

  return (
    <div
      className={cn("prose prose-stone dark:prose-invert max-w-none kp-post-content", className)}
      spellCheck={false}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={{ allowDangerousHtml: true }}
        urlTransform={urlTransform}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});
