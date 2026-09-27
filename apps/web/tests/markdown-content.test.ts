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

test("내부 첨부 이미지를 Markdown 콘텐츠로 렌더링한다", () => {
  const hash = "b".repeat(64);
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: `![도표](/api/v1/attachments/${hash})`,
  }));

  expect(html).toContain(`src="/api/v1/attachments/${hash}"`);
  expect(html).toContain('alt="도표"');
});

test("외부 HTTPS 이미지도 원본 URL과 대체 텍스트를 유지해 렌더링한다", () => {
  const url = "https://images.example.com/sensor.png";
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: `![센서 원본](${url})`,
  }));

  expect(html).toContain("<img ");
  expect(html).toContain(`src="${url}"`);
  expect(html).toContain('alt="센서 원본"');
  expect(html).toContain('referrerPolicy="no-referrer"');
});

test("Markdown 이미지 제목의 width/height 메타데이터를 img 속성으로 적용한다", () => {
  const url = "https://images.example.com/figure.png";
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: `![센서 구조](<${url}> \"width=960 height=540\")`,
  }));

  expect(html).toContain(`src=\"${url}\"`);
  expect(html).toContain('width=\"960\"');
  expect(html).toContain('height=\"540\"');
  expect(html).not.toContain('title=\"width=960 height=540\"');
});

test("Markdown 이미지 제목의 width만 지정되면 원본 width를 img 속성으로 적용한다", () => {
  const url = "https://images.example.com/figure.png";
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: `![센서 구조](<${url}> "width=400")`,
  }));

  expect(html).toContain(`src="${url}"`);
  expect(html).toContain('width="400"');
  expect(html).not.toContain("height=");
  expect(html).not.toContain('title="width=400"');
});

test("Markdown 이미지 제목의 height만 지정되면 원본 height를 img 속성으로 적용한다", () => {
  const url = "https://images.example.com/portrait.png";
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: `![센서 단면](<${url}> "height=400")`,
  }));

  expect(html).toContain(`src="${url}"`);
  expect(html).toContain('height="400"');
  expect(html).not.toContain("width=");
  expect(html).not.toContain('title="height=400"');
});

test("지원하지 않는 이미지 URL scheme은 이미지로 렌더링하지 않는다", () => {
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: "![안전하지 않은 이미지](javascript:alert%281%29)",
  }));

  expect(html).not.toContain("<img");
  expect(html).not.toContain("javascript:");
});

test("크기 메타데이터가 있는 첨부 이미지는 렌더링 공간을 미리 확보한다", () => {
  const hash = "c".repeat(64);
  const html = renderToStaticMarkup(createElement(MarkdownContent, {
    children: `![도표](/api/v1/attachments/${hash}?width=1200&height=800)`,
  }));

  expect(html).toContain('width="1200"');
  expect(html).toContain('height="800"');
});
