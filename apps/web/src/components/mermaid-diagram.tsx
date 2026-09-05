"use client";

import { useEffect, useId, useState } from "react";

type DiagramState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

function activeTheme(): "default" | "dark" {
  const selected = document.documentElement.dataset.theme;
  if (selected === "dark") return "dark";
  if (selected === "light") return "default";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default";
}

export function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [appearanceVersion, setAppearanceVersion] = useState(0);
  const [state, setState] = useState<DiagramState>({ status: "loading" });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => setAppearanceVersion((version) => version + 1);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", refresh);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: activeTheme(),
        suppressErrorRendering: true,
      });
      const id = `mermaid-${reactId.replaceAll(":", "")}-${appearanceVersion}`;
      const { svg } = await mermaid.render(id, source);
      if (!cancelled) setState({ status: "ready", svg });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error
        ? error.message.split("\n")[0] || "다이어그램 문법을 확인해 주세요."
        : "다이어그램 문법을 확인해 주세요.";
      setState({ status: "error", message });
    });

    return () => { cancelled = true; };
  }, [appearanceVersion, reactId, source]);

  if (state.status === "error") {
    return (
      <div className="mermaid-error" role="alert">
        <p>Mermaid를 렌더링하지 못했습니다: {state.message}</p>
        <pre><code className="language-mermaid">{source}</code></pre>
      </div>
    );
  }

  if (state.status === "loading") {
    return <div className="mermaid-diagram mermaid-loading" aria-label="Mermaid 다이어그램 렌더링 중">다이어그램 렌더링 중…</div>;
  }

  return (
    <div
      className="mermaid-diagram"
      role="img"
      aria-label="Mermaid 다이어그램"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
