import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { buildGraphModel, buildTermColorHues, TermGraph } from "../src/components/term-graph.js";
import type { GraphTerm } from "../src/lib/terms/query.js";

function term(index: number, overrides: Partial<GraphTerm> = {}): GraphTerm {
  return {
    id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    slug: `term-${index}`,
    qualityProfile: "auto",
    nameEn: `Term ${index}`,
    nameKo: null,
    domain: [`Domain ${index}`],
    categories: [],
    category: null,
    categoryLabel: null,
    categoryLabels: [],
    topic: null,
    ownerId: null,
    ownerName: null,
    status: "active",
    definitionMd: null,
    ...overrides,
  };
}

test("관계도 모델은 허브 18개와 용어 100개 제한을 지킨다", () => {
  const model = buildGraphModel(Array.from({ length: 120 }, (_, index) => term(index)));

  expect(model.nodes.filter((node) => node.kind !== "term")).toHaveLength(18);
  expect(model.nodes.filter((node) => node.kind === "term")).toHaveLength(100);
});

test("초기 SVG 좌표는 hydration에서 엔진별 삼각함수 오차가 드러나지 않도록 고정 정밀도를 쓴다", () => {
  const model = buildGraphModel(Array.from({ length: 18 }, (_, index) => term(index)));

  for (const node of model.nodes) {
    expect(node.x).toBe(Math.round(node.x * 1_000_000) / 1_000_000);
    expect(node.y).toBe(Math.round(node.y * 1_000_000) / 1_000_000);
  }
});

test("하나의 용어는 업무 분류, 주제, 도메인 허브에 모두 연결된다", () => {
  const model = buildGraphModel([
    term(1, { domain: ["ISP", "AE"], category: "design", categoryLabel: "설계", topic: "노출" }),
  ]);
  const targets = model.edges.map((edge) => edge.target);

  expect(targets).toEqual(expect.arrayContaining(["c:design", "t:노출", "d:ISP", "d:AE"]));
  expect(new Set(targets).size).toBe(4);
});

test("관계도는 확대, 초기화와 조작 도움말을 제공한다", () => {
  const html = renderToStaticMarkup(createElement(TermGraph, { terms: [term(1)] }));

  expect(html).toContain('aria-label="축소"');
  expect(html).toContain('aria-label="확대"');
  expect(html).toContain("초기화");
  expect(html).toContain("노드를 드래그해 배치를 바꾸거나");
  expect(html).toContain('aria-live="polite"');
});

test("용어가 많아도 모든 용어 이름을 채운 배지로 표시한다", () => {
  const terms = Array.from({ length: 60 }, (_, index) => term(index));
  const html = renderToStaticMarkup(createElement(TermGraph, { terms }));

  expect(html).toContain("Term 0");
  expect(html).toContain("Term 59");
});

test("업무 분류가 다른 용어는 서로 다른 배지 색상을 사용한다", () => {
  const html = renderToStaticMarkup(createElement(TermGraph, { terms: [
    term(1, { category: "product", categoryLabel: "제품" }),
    term(2, { category: "design", categoryLabel: "설계" }),
  ] }));
  const hues = [...html.matchAll(/--graph-category-hue:(\d+)/g)].map((match) => match[1]);

  expect(new Set(hues).size).toBeGreaterThanOrEqual(2);
  expect(html).toContain("graph-category-node");
  expect(html).toContain("graph-category-label");
  expect(html).toContain("용어 · 분류색");
});

test("업무 분류가 없는 용어는 분류 체계에 저장한 대표 도메인 색상을 사용한다", () => {
  const terms = [
    term(1, { domain: ["IT"] }),
    term(2, { domain: ["반도체"] }),
    term(3, { domain: ["IT"] }),
  ];
  const domainColors = [{ label: "IT", color: "p07" }, { label: "반도체", color: "p31" }];
  const hues = buildTermColorHues(terms, domainColors);

  expect(hues.get(terms[0]!.id)).not.toBe(hues.get(terms[1]!.id));
  expect(hues.get(terms[0]!.id)).toBe(hues.get(terms[2]!.id));

  const html = renderToStaticMarkup(createElement(TermGraph, { terms, domainColors }));
  expect((html.match(/graph-category-node/g) ?? [])).toHaveLength(5);
  expect(html).not.toContain("fill-panel-2 stroke-line-strong\" transition-[stroke-width]");
});

test("업무 분류는 도메인보다 우선하여 용어 색상을 결정한다", () => {
  const terms = [
    term(1, { domain: ["IT"], category: "design", categoryLabel: "설계" }),
    term(2, { domain: ["반도체"], category: "design", categoryLabel: "설계" }),
  ];
  const hues = buildTermColorHues(terms);

  expect(hues.get(terms[0]!.id)).toBe(hues.get(terms[1]!.id));
});

test("도메인 허브는 저장한 옅은 색이고 업무 분류는 용어 색상에 우선한다", () => {
  const domainColors = [{ label: "ISP", color: "p12" }];
  const html = renderToStaticMarkup(createElement(TermGraph, { terms: [
    term(1, { domain: ["ISP"], category: "design", categoryLabel: "설계" }),
  ], domainColors }));

  expect(html).not.toContain("fill-panel-2 stroke-line-strong");
  expect((html.match(/graph-category-node/g) ?? [])).toHaveLength(3);
  expect(html).toContain("도메인");
  expect(html).toContain("용어 · 분류색");
});

test("마우스 이동만으로 선택 안내를 변경하지 않는다", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(testDir, "../src/components/term-graph.tsx"), "utf8");

  expect(source).not.toContain("setHovered");
  expect(source).not.toContain("onMouseEnter");
  expect(source).not.toContain("onMouseLeave");
});
