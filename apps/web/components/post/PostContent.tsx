"use client";

import { memo, useMemo, useState, useId, isValidElement, type ReactNode, type ReactElement, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { Check, Copy, Link2, Eye, Code2, Maximize2, Minimize2, WrapText, ListOrdered } from "lucide-react";
import { transformWikiLinks } from "./WikiLink";
import { PostMarkdownLink } from "./PostMarkdownLink";
import { memoizeMarkdownTransform } from "@knowpilot/shared";
import { useShowCodeLineNumbers } from "@/lib/codeBlockPrefs";
import { MarkdownTable } from "@/components/post/MarkdownTable";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";

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

/** iframe 预览：sandbox 隔离，allow-scripts 但不给 allow-same-origin（防访问父页 cookie/storage） */
function CodePreview({ code, language }: { code: string; language: string }) {
  const srcDoc = useMemo(() => {
    // SVG 直接作为文档；HTML 原样渲染
    if (language.toLowerCase() === "svg") {
      return code;
    }
    return code;
  }, [code, language]);
  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
      className="h-full w-full border-0 bg-white"
      title="代码预览"
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

function Heading({
  level,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { level: 2 | 3 | 4 }) {
  const fallbackId = useId();
  const text = getText(children);
  const id = slugify(text) || `heading-${level}-${fallbackId.replace(/[^a-z0-9]/gi, "").slice(0, 6)}`;
  const Tag = `h${level}` as "h2" | "h3" | "h4";
  return (
    <Tag id={id} className="group relative scroll-mt-28" {...props}>
      {children}
      <a
        href={`#${id}`}
        className="kp-heading-anchor"
        aria-label="复制锚点链接"
        onClick={(e) => {
          e.preventDefault();
          history.replaceState(null, "", `#${id}`);
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        <Link2 className="h-4 w-4" />
      </a>
    </Tag>
  );
}

function Pre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  let language = "";

  if (isValidElement(children)) {
    const childClass = ((children as ReactElement<{ className?: string }>).props.className) || "";
    const match = /language-(\w+)/.exec(childClass);
    if (match) language = match[1];
  }

  const codeText = getText(children);
  const lineCount = useMemo(() => countCodeLines(codeText), [codeText]);
  const [showLineNumbers, setShowLineNumbers] = useShowCodeLineNumbers();
  const [state, setState] = useState<CodeBlockState>({ mode: "code", wrap: false, maximized: false });
  const canPreview = PREVIEWABLE_LANGS.has(language.toLowerCase());
  const update = (next: Partial<CodeBlockState>) => setState((prev) => ({ ...prev, ...next }));
  const toggleLineNumbers = () => setShowLineNumbers(!showLineNumbers);

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
        <div className="h-[360px] w-full">
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
    const walk = (node: RehypeNode) => {
      if (node.type !== "element") return;
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
      for (const child of el.children) walk(child);
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

  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(
    () =>
      [
        rehypeRaw,
        rehypeNormalizeCustomTags,
        rehypeHighlight,
        [rehypeKatex, { throwOnError: false, strict: false }],
      ] as NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>,
    [],
  );

  const components = useMemo(
    () => ({
    a: ({ href, children, ...props }) => (
      <PostMarkdownLink href={href} postSlug={postSlug} postGarden={postGarden} {...props}>
        {children}
      </PostMarkdownLink>
    ),
    h2: (props) => <Heading level={2} {...props} />,
    h3: (props) => <Heading level={3} {...props} />,
    h4: (props) => <Heading level={4} {...props} />,
    img: ({ src, alt }) => {
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
    code: ({ className, children, ...props }) => {
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
        <code {...props}>
          {children}
        </code>
      );
    },
    pre: Pre,
    table: ({ children, ...props }) => (
      <MarkdownTable {...props}>{children}</MarkdownTable>
    ),
    thinkingnode: ({
      category,
      children,
      ...props
    }: ComponentPropsWithoutRef<"aside"> & { category?: string }) => (
      <ThinkingNode category={typeof category === "string" ? category : undefined} {...props}>
        {children}
      </ThinkingNode>
    ),
  }) as Components,
    [postSlug, postGarden],
  );

  return (
    <div className={`prose prose-stone dark:prose-invert max-w-none ${className || ""}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});
