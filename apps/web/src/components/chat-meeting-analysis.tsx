import Link from "next/link";
import { MarkdownContent } from "./markdown-content";
import type {
  MeetingAnalysis,
  MeetingCitation,
  MeetingEvidenceItem,
  MeetingInsight,
  MeetingActionItem,
} from "@/lib/ai/meeting-values";

function citationLabels(evidence: MeetingCitation[]): Map<string, string> {
  let meeting = 0;
  let glossary = 0;
  let wiki = 0;
  return new Map(evidence.map((item) => [item.id, item.source === "meeting" ? `M${++meeting}` : item.source === "wiki" ? `W${++wiki}` : `G${++glossary}`]));
}

function CitationLinks({ evidenceIds, labels, messageId }: { evidenceIds: string[]; labels: Map<string, string>; messageId: number }) {
  return <span className="ml-1 inline-flex flex-wrap gap-1">
    {[...new Set(evidenceIds)].map((id) => {
      const label = labels.get(id);
      return label ? <a key={id} href={`#chat-${messageId}-meeting-evidence-${label}`} className="font-semibold text-brand underline underline-offset-2" aria-label={`근거 ${label} 보기`}>[{label}]</a> : null;
    })}
  </span>;
}

function EvidenceSection({ title, items, labels, messageId, render }: {
  title: string;
  items: MeetingEvidenceItem[];
  labels: Map<string, string>;
  messageId: number;
  render?: (item: MeetingEvidenceItem) => string;
}) {
  if (!items.length) return null;
  return <section className="mt-4" aria-labelledby={`chat-${messageId}-${title}`}>
    <h4 id={`chat-${messageId}-${title}`} className="text-xs font-semibold text-ink">{title}</h4>
    <ul className="mt-1.5 space-y-1.5 text-sm leading-6 text-ink-2">
      {items.map((item, index) => <li key={`${title}-${index}`} className="pl-4 before:mr-1 before:content-['•']">
        <span>{render ? render(item) : item.text}</span>
        <CitationLinks evidenceIds={item.evidenceIds} labels={labels} messageId={messageId} />
      </li>)}
    </ul>
  </section>;
}

function EvidenceBlock({ analysis, labels, messageId }: { analysis: MeetingAnalysis; labels: Map<string, string>; messageId: number }) {
  if (!analysis.evidence.length) return null;
  return <section className="mt-4 border-t border-line pt-3" aria-label="회의 분석 근거">
    <p className="text-xs font-semibold text-ink">분석 근거</p>
    <div className="mt-2 space-y-2">
      {analysis.evidence.map((item) => {
        const label = labels.get(item.id) ?? "근거";
        const title = item.source === "meeting" ? `${item.title ? `${item.title} ` : "회의록 "}${label}` : item.source === "wiki" ? `${item.title ? `${item.title} ` : "위키 "}${label}` : `${label} ${item.title ?? "용어집"}`;
        return <blockquote key={item.id} id={`chat-${messageId}-meeting-evidence-${label}`} tabIndex={-1} className="scroll-mt-4 rounded-lg border border-line bg-panel-2/50 p-2.5 text-xs focus:outline focus:outline-2 focus:outline-brand">
          <p className="font-semibold text-ink">[{label}] {title}</p>
          {item.source === "glossary" && item.revision !== undefined && <p className="mt-0.5 text-[11px] text-ink-3">리비전 {item.revision} · 용어집 근거</p>}
          {item.source === "wiki" && item.revision !== undefined && <p className="mt-0.5 text-[11px] text-ink-3">리비전 {item.revision} · 공개 위키 근거</p>}
          {item.source === "meeting" && item.meetingDate && <p className="mt-0.5 text-[11px] text-ink-3">회의일 {new Date(item.meetingDate).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} · 기존 회의 자료 근거</p>}
          <p className="mt-1 whitespace-pre-wrap break-words leading-5 text-ink-2">{item.excerpt}</p>
          {item.source === "glossary" && item.slug && <div className="mt-2 flex flex-wrap gap-3">
            <Link href={`/g/${item.termId ?? item.slug}`} className="text-brand underline">현재 용어</Link>
            {item.revision !== undefined && <Link href={`/history/${item.termId ?? item.slug}#revision-${item.revision}`} className="text-brand underline">기준 이력</Link>}
          </div>}
          {item.source === "wiki" && item.wikiSlug && <div className="mt-2 flex flex-wrap gap-3"><Link href={`/w/${item.wikiSlug}`} className="text-brand underline">위키 문서에서 보기</Link></div>}
        </blockquote>;
      })}
    </div>
    <p className="mt-2 text-[11px] text-ink-3">M은 분석에 제공한 회의록, W는 공개 위키, G는 용어집 리비전에서 가져온 근거입니다. 회의록 원문은 Confluence에서 관리하세요.</p>
  </section>;
}

export function ChatMeetingAnalysis({ analysis, messageId }: {
  analysis: MeetingAnalysis;
  messageId: number;
}) {
  const labels = citationLabels(analysis.evidence);
  return <div>
    <div className="rounded-lg border border-brand/20 bg-brand-soft/40 p-2.5 text-xs text-ink-2">
      <p className="font-semibold text-ink">회의록 분석</p>
      <p className="mt-0.5">회의록 원문·용어집·공개 위키를 분리해 근거로 사용했습니다. 용어 후보는 자동으로 등록하지 않습니다.</p>
    </div>

    <section className="mt-3" aria-labelledby={`chat-${messageId}-meeting-summary`}>
      <h4 id={`chat-${messageId}-meeting-summary`} className="text-xs font-semibold text-ink">회의 요약</h4>
      <MarkdownContent className="mt-1 break-words text-sm leading-6">{analysis.summary.text}</MarkdownContent>
      <CitationLinks evidenceIds={analysis.summary.evidenceIds} labels={labels} messageId={messageId} />
    </section>

    <EvidenceSection title="주요 주제" items={analysis.topics} labels={labels} messageId={messageId} />
    <EvidenceSection title="결정 사항" items={analysis.decisions} labels={labels} messageId={messageId} />
    <EvidenceSection
      title="액션 아이템"
      items={analysis.actionItems}
      labels={labels}
      messageId={messageId}
      render={(item) => {
        const action = item as MeetingActionItem;
        return `${action.text} · 담당: ${action.owner ?? "미지정"} · 기한: ${action.dueDate ?? "미지정"} · 상태: ${action.status}`;
      }}
    />
    <EvidenceSection title="리스크" items={analysis.risks} labels={labels} messageId={messageId} />
    <EvidenceSection title="미해결 질문" items={analysis.openQuestions} labels={labels} messageId={messageId} />
    <EvidenceSection
      title="도메인 인사이트"
      items={analysis.insights}
      labels={labels}
      messageId={messageId}
      render={(item) => {
        const insight = item as MeetingInsight;
        return `${insight.title}: ${insight.text} (${insight.kind}, 신뢰도 ${insight.confidence})${insight.discussionQuestion ? ` · 토론 질문: ${insight.discussionQuestion}` : ""}`;
      }}
    />

    {analysis.termMatches.length > 0 && <section className="mt-4" aria-labelledby={`chat-${messageId}-meeting-term-matches`}>
      <h4 id={`chat-${messageId}-meeting-term-matches`} className="text-xs font-semibold text-ink">용어집에서 확인한 용어</h4>
      <ul className="mt-1.5 space-y-1 text-sm leading-6 text-ink-2">
        {analysis.termMatches.map((item) => <li key={item.slug} className="pl-4 before:mr-1 before:content-['•']">
          <Link href={`/g/${item.slug}`} className="font-medium text-brand underline">{item.title}</Link>: {item.reason}
          <CitationLinks evidenceIds={item.evidenceIds} labels={labels} messageId={messageId} />
        </li>)}
      </ul>
    </section>}

    {analysis.termCandidates.length > 0 && <section className="mt-4" aria-labelledby={`chat-${messageId}-meeting-term-candidates`}>
      <h4 id={`chat-${messageId}-meeting-term-candidates`} className="text-xs font-semibold text-ink">정리할 용어 후보</h4>
      <div className="mt-1.5 space-y-2">
        {analysis.termCandidates.map((item, index) => <div key={`${item.surface}-${index}`} className="rounded-lg border border-warn/25 bg-warn-soft/50 p-2.5 text-xs text-ink-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{item.surface}</span>
            <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-warn">{item.suggestedAction}</span>
            {item.existingTerm && <Link href={`/g/${item.existingTerm.slug}`} className="text-brand underline">{item.existingTerm.title} 확인</Link>}
          </div>
          <p className="mt-1">{item.reason}</p>
          <p className="mt-1 text-ink-3">회의 맥락: {item.context}</p>
          <CitationLinks evidenceIds={item.evidenceIds} labels={labels} messageId={messageId} />
        </div>)}
      </div>
    </section>}

    {analysis.uncertainties.length > 0 && <section className="mt-4 rounded-lg border border-warn/25 bg-warn-soft p-2.5" aria-label="확인할 사항">
      <p className="text-xs font-semibold text-ink">확인할 사항</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-2">{analysis.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </section>}
    <EvidenceBlock analysis={analysis} labels={labels} messageId={messageId} />
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
      <p className="mr-auto text-[11px] text-ink-3">원문은 Confluence에 두고, 이 분석에서 재사용할 지식만 승격하세요.</p>
      <Link href="/w/new?from=meeting" className="btn-primary btn-sm">위키 초안 만들기</Link>
      <Link href="/new" className="btn-ghost btn-sm">용어 등록</Link>
    </div>
  </div>;
}
