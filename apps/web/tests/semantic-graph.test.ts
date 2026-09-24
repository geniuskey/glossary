import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { buildSemanticGraphModel, TermGraph } from "../src/components/term-graph.js";
import type { GraphTerm } from "../src/lib/terms/query.js";
import type { SemanticRelation } from "../src/lib/terms/relation-values.js";

function term(id: string): GraphTerm {
  return { id, slug: id, nameEn: id, nameKo: null, qualityProfile: "auto", domain: ["QA"], categories: [], category: null,
    categoryLabel: null, categoryLabels: [], topic: null, tags: [], ownerId: null, ownerName: null, status: "active", definitionMd: null };
}
const relation: SemanticRelation = { id: "edge-1", sourceTermId: "a", targetTermId: "b", relationType: "part_of", evidenceMd: "A는 B의 구성 요소다." };

test("의미 그래프는 분류 허브 없이 저장된 방향·종류·근거를 유지한다", () => {
  const model = buildSemanticGraphModel([term("a"), term("b"), term("c")], [relation]);
  expect(model.nodes).toHaveLength(2);
  expect(model.nodes.every((node) => node.kind === "term")).toBe(true);
  expect(model.edges).toEqual([{ key: relation.id, source: "n:a", target: "n:b", relation }]);
  expect(model.omittedEdgeCount).toBe(0);
});

test("화면 밖 관계를 표시하지 않고 생략 수를 반환한다", () => {
  const model = buildSemanticGraphModel([term("a")], [relation]);
  expect(model.edges).toHaveLength(0);
  expect(model.omittedEdgeCount).toBe(1);
});

test("의미 그래프는 방향 화살표와 키보드 안내를 렌더링하고 분류 범례는 숨긴다", () => {
  const html = renderToStaticMarkup(createElement(TermGraph, { terms: [term("a"), term("b")], semanticRelations: [relation], mode: "semantic" }));
  expect(html).toContain("승인된 의미 관계도");
  expect(html).toContain("marker-end=");
  expect(html).toContain("표시된 의미 관계 1개");
  expect(html).toContain("Home 전체 맞춤");
  expect(html).not.toContain("graph-topic-swatch");
});

test("의미 그래프는 관계 없는 용어를 연결된 것처럼 보여주지 않는다", () => {
  const model = buildSemanticGraphModel(Array.from({ length: 100 }, (_, i) => term(String(i))), []);
  expect(model.nodes).toHaveLength(0);
  const connected = buildSemanticGraphModel([term("a"), term("b"), term("c")], [relation]);
  expect(connected.nodes).toHaveLength(2);
  expect(connected.edges).toHaveLength(1);
  for (const node of connected.nodes) {
    expect(node.x).toBe(Math.round(node.x * 1_000_000) / 1_000_000);
    expect(node.y).toBe(Math.round(node.y * 1_000_000) / 1_000_000);
  }
});

test("같은 두 용어의 여러 관계는 서로 다른 곡선으로 그린다", () => {
  const relations: SemanticRelation[] = [relation, { ...relation, id: "edge-2", relationType: "used_in" }];
  const html = renderToStaticMarkup(createElement(TermGraph, { terms: [term("a"), term("b")], semanticRelations: relations, mode: "semantic" }));
  const paths = [...html.matchAll(/<path d="([^"]+)" fill="none" marker-end=/g)].map((match) => match[1]);
  expect(paths).toHaveLength(2);
  expect(new Set(paths).size).toBe(2);
});
