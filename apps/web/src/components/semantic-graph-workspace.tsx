"use client";
import { useState } from "react";
import { TermGraph } from "./term-graph";
import { RelationManager } from "./relation-manager";
import type { GraphTerm } from "@/lib/terms/query";
import type { SemanticRelation } from "@/lib/terms/relation-values";

export function SemanticGraphWorkspace({ terms, relations, omitted, domainColors }: { terms: GraphTerm[]; relations: SemanticRelation[]; omitted: number; domainColors: { label: string; color: string }[] }) {
  const [selectedTerm, setSelectedTerm] = useState<{ id: string; name: string } | null>(null);
  const [graphKey, setGraphKey] = useState(0);
  return <>
    <p className="mb-3 text-xs text-ink-2">승인된 의미 관계 {relations.length}개 표시 · 그래프와 챗봇은 같은 승인·재검토 기준을 사용합니다.
      {omitted > 0 && ` 필터·표시 제한으로 연결 ${omitted}개를 생략했습니다. 전체 연결은 아래 관리 목록에서 확인하세요.`}</p>
    <div className="min-h-[480px]">
      <TermGraph key={graphKey} terms={terms} domainColors={domainColors} mode="semantic" semanticRelations={relations} onSelectTerm={setSelectedTerm} />
    </div>
    <RelationManager selectedTerm={selectedTerm} onClearSelection={() => { setSelectedTerm(null); setGraphKey((key) => key + 1); }} />
  </>;
}
