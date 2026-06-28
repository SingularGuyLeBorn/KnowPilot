"use client";

import { useState, useId, isValidElement, type ReactNode, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { Check, Copy, Link2 } from "lucide-react";
import { WikiLink, transformWikiLinks } from "./WikiLink";
import Link from "next/link";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  postSlug?: string;
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

function CodeToolbar({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

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
      <button
        type="button"
        onClick={handleCopy}
        className="group/copy"
        aria-label={copied ? "已复制" : "复制代码"}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-green-600" />
            <span>已复制</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            <span>复制</span>
          </>
        )}
      </button>
    </div>
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

  return (
    <div className="my-6 overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]">
      <CodeToolbar language={language} code={codeText} />
      <pre {...props} className="!m-0 overflow-x-auto p-4 text-sm leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content, className, postSlug }: MarkdownRendererProps) {
  const components: Components = {
    a: ({ href, children, ...props }) => {
      if (!href) return <span {...props}>{children}</span>;
      if (href.startsWith("wiki://")) {
        const target = decodeURIComponent(href.slice(7));
        return <WikiLink target={target}>{children}</WikiLink>;
      }
      if (href.startsWith("/")) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
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
        <code className="bg-[var(--kp-bg-mute)] text-[var(--kp-brand-dark)]" {...props}>
          {children}
        </code>
      );
    },
    pre: Pre,
  };

  return (
    <div className={`prose prose-stone max-w-none ${className || ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeHighlight, [rehypeKatex, { throwOnError: false, strict: false }]]}
        urlTransform={urlTransform}
        components={components}
      >
        {transformWikiLinks(content)}
      </ReactMarkdown>
    </div>
  );
}
