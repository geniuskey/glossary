import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeDisplayMath } from "@/lib/markdown/normalize";
import { MermaidDiagram } from "./mermaid-diagram";

const INTERNAL_ATTACHMENT_RE = /^\/api\/v1\/attachments\/[a-f0-9]{64}$/;

const components: Components = {
  a({ href, children, ...props }) {
    const external = Boolean(href && /^https?:\/\//i.test(href));
    return (
      <a
        {...props}
        href={href}
        className="link"
        {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      >
        {children}
      </a>
    );
  },
  img({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) {
    if (typeof src !== "string" || !INTERNAL_ATTACHMENT_RE.test(src)) {
      return <span className="text-sm text-danger">외부 이미지는 표시하지 않습니다: {alt || String(src ?? "")}</span>;
    }
    // 첨부 API가 원본 크기를 응답하므로 여기서는 문서 폭만 제한한다.
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} src={src} alt={alt ?? ""} loading="lazy" className="my-4 max-h-[70vh] max-w-full rounded-lg border border-line" />;
  },
  table({ children }) {
    return <div className="my-4 overflow-x-auto"><table>{children}</table></div>;
  },
  pre({ children }) {
    const child = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
    if (child?.props.className?.split(" ").includes("language-mermaid")) {
      const source = String(child.props.children ?? "").replace(/\n$/, "");
      return <MermaidDiagram source={source} />;
    }
    return <pre>{children}</pre>;
  },
  code({ className, children, ...props }) {
    const block = className?.startsWith("language-");
    return block
      ? <code {...props} className={className}>{children}</code>
      : <code {...props} className="rounded bg-panel-2 px-1 py-0.5 text-[0.9em]">{children}</code>;
  },
};

export function MarkdownContent({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components} skipHtml>
        {normalizeDisplayMath(children)}
      </ReactMarkdown>
    </div>
  );
}
