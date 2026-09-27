import { isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { internalAttachmentDimensions, isExternalImageUrl, isInternalAttachmentUrl, markdownImageDimensions } from "@/lib/markdown/images";
import { normalizeDisplayMath } from "@/lib/markdown/normalize";
import { MermaidDiagram } from "./mermaid-diagram";

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
  img({ src, alt, title, node: _node, ...props }) {
    const internal = typeof src === "string" && isInternalAttachmentUrl(src);
    const external = typeof src === "string" && isExternalImageUrl(src);
    if (typeof src !== "string" || (!internal && !external)) {
      return <span className="text-sm text-danger">이미지 URL이 안전하지 않아 표시할 수 없습니다{alt ? `: ${alt}` : ""}</span>;
    }
    const markdownDimensions = markdownImageDimensions(title);
    const dimensions = (internal ? internalAttachmentDimensions(src) : null) ?? markdownDimensions;
    // 새 첨부 URL은 저장된 크기를 포함해 로드 전에도 레이아웃 공간을 확보한다.
    return <img {...props} {...(markdownDimensions ? {} : { title })} src={src} alt={alt ?? ""} width={dimensions?.width} height={dimensions?.height} loading="lazy" {...(external ? { referrerPolicy: "no-referrer" } : {})} className="my-4 h-auto max-h-[70vh] max-w-full rounded-lg border border-line" />;
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
