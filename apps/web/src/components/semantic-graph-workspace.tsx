"use client";
import { useState, type ReactNode } from "react";
import { TermGraph } from "./term-graph";
import { RelationManager } from "./relation-manager";
import type { GraphTerm } from "@/lib/terms/query";
import type { SemanticRelation } from "@/lib/terms/relation-values";

export function SemanticGraphWorkspace({ terms, relations, domainColors, topBar }: { terms: GraphTerm[]; relations: SemanticRelation[]; domainColors: { label: string; color: string }[]; topBar?: ReactNode }) {
  const [selectedTerm, setSelectedTerm] = useState<{ id: string; name: string } | null>(null);
  const [graphKey, setGraphKey] = useState(0);
  return <>
    <div className="h-full min-h-[480px]">
      <TermGraph key={graphKey} terms={terms} domainColors={domainColors} mode="semantic" semanticRelations={relations} onSelectTerm={setSelectedTerm} topBar={topBar} />
    </div>
    <RelationManager selectedTerm={selectedTerm} onClearSelection={() => { setSelectedTerm(null); setGraphKey((key) => key + 1); }} />
  </>;
}
