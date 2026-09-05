import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MarkdownContent } from "../src/components/markdown-content.js";

test("Markdown 수식을 KaTeX로 렌더링한다", () => {
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: "인라인 $E = mc^2$\n\n$$\n\\sum_{i=1}^{n} i\n$$",
  }));

  expect(html).toContain('class="katex"');
  expect(html).toContain('class="katex-display"');
});

test("구분자와 내용이 같은 줄에 있는 여러 줄 행렬도 블록 수식으로 렌더링한다", () => {
  const matrix = String.raw`$$J_n = \begin{bmatrix}
\lambda & 1 & 0 & \cdots & 0 \\
0 & \lambda & 1 & \cdots & 0 \\
\vdots & \vdots & \ddots & \ddots & \vdots \\
0 & 0 & \cdots & \lambda & 1 \\
0 & 0 & \cdots & 0 & \lambda
\end{bmatrix}_{n \times n}$$`;
  const html = renderToStaticMarkup(createElement(MarkdownContent, { children: matrix }));

  expect(html).toContain('class="katex-display"');
  expect(html).toContain("mtable");
  expect(html).toContain("<mo>×</mo>");
});

test("mermaid 코드 블록은 클라이언트 다이어그램 자리로 렌더링한다", () => {
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: "```mermaid\nflowchart LR\n  A --> B\n```",
  }));

  expect(html).toContain("Mermaid 다이어그램 렌더링 중");
  expect(html).not.toContain("<pre><code");
});
