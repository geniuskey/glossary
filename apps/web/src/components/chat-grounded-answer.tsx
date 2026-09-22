import Link from "next/link";
import { MarkdownContent } from "./markdown-content";
import { EVIDENCE_FIELD_LABELS, type GroundedChatAnswer } from "@/lib/ai/grounding-values";

function CitationLinks({ evidenceIds, numbers, messageId }: { evidenceIds: string[]; numbers: Map<string, number>; messageId: number }) {
  return <>{[...new Set(evidenceIds)].map((id) => {
    const number = numbers.get(id);
    return number ? <a key={id} href={`#chat-${messageId}-evidence-${number}`} className="rounded px-1.5 font-semibold text-brand underline underline-offset-2 hover:bg-brand-soft" aria-label={`근거 ${number} 보기`}>[{number}]</a> : null;
  })}</>;
}

export function ChatGroundedAnswer({ answer, messageId }: { answer: GroundedChatAnswer; messageId: number }) {
  const numbers = new Map(answer.evidence.map((item, index) => [item.id, index + 1]));
  const anchor = (index: number) => `chat-${messageId}-evidence-${index}`;
  return <div>
    <div className="space-y-3">
      {answer.claims.map((claim, index) => <div key={index}>
        <MarkdownContent className="break-words text-sm leading-6">{claim.text}</MarkdownContent>
        <div className="mt-1 flex flex-wrap gap-1" aria-label={`${index + 1}번째 답변의 근거`}>
          {[...new Set(claim.evidenceIds)].map((id) => {
            const number = numbers.get(id);
            return number ? <a key={id} href={`#${anchor(number)}`} className="rounded px-1.5 text-xs font-semibold text-brand underline underline-offset-2 hover:bg-brand-soft" aria-label={`근거 ${number} 보기`}>[{number}]</a> : null;
          })}
        </div>
      </div>)}
    </div>
    {answer.insights?.length > 0 && <section className="mt-3 rounded-lg border border-brand/20 bg-brand-soft/35 p-2.5" aria-label="도메인 관점">
      <p className="text-xs font-semibold text-ink">도메인 관점</p>
      <ul className="mt-1.5 space-y-2 text-xs leading-5 text-ink-2">
        {answer.insights.map((insight, index) => <li key={`${insight.title}-${index}`}>
          <p><span className="font-semibold text-ink">{insight.title}</span>: {insight.text} <span className="text-ink-3">({insight.confidence})</span>
            <span className="ml-1"><CitationLinks evidenceIds={insight.evidenceIds} numbers={numbers} messageId={messageId} /></span>
          </p>
          {insight.discussionQuestion && <p className="mt-0.5 text-ink-3">토론 질문: {insight.discussionQuestion}</p>}
        </li>)}
      </ul>
    </section>}
    {answer.ontology && answer.ontology.length > 0 && <section className="mt-3 rounded-lg border border-line bg-panel-2/50 p-2.5" aria-label="온톨로지 경로">
      <p className="text-xs font-semibold text-ink">검색된 승인 관계 경로</p>
      <ul className="mt-1.5 space-y-1 text-xs leading-5 text-ink-2">
        {answer.ontology.slice(0, 8).map((path) => <li key={path.id}>
          <span className="font-medium text-ink">{path.source.title}</span>
          <span className="mx-1 text-ink-3">— {path.predicateLabel ?? path.predicateKey} →</span>
          <span className="font-medium text-ink">{path.target.title}</span>
          <span className="ml-1 text-[11px] text-ink-3">(검색 씨앗에서 {path.depth}단계 · 신뢰도 {path.confidence}%)</span>
        </li>)}
      </ul>
      <p className="mt-1.5 text-[11px] text-ink-3">관계 경로는 승인된 연결과 공개 위키의 명시적 연결을 보여주며, 사실 판단은 함께 표시된 근거 구절을 기준으로 합니다.</p>
    </section>}
    {answer.uncertainties.length > 0 && <div className="mt-3 rounded-lg border border-warn/25 bg-warn-soft p-2.5">
      <p className="text-xs font-semibold text-ink">확인할 사항</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-2">{answer.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div>}
    <div className="mt-3 border-t border-line pt-2 text-xs text-ink-3">
      검색 범위: {answer.domain ?? "전체 도메인"} · 검색 {answer.searchedQueries.length}회
      <details className="mt-1"><summary className="cursor-pointer hover:text-brand">사용한 검색어</summary><ul className="mt-1 space-y-1">{answer.searchedQueries.map((query, index) => <li key={index}>{query}</li>)}</ul></details>
    </div>
    {answer.evidence.length > 0 && <section className="mt-3 space-y-2" aria-label="답변에 연결된 근거 구절">
      <p className="text-xs font-semibold text-ink">답변에 연결된 근거</p>
      {answer.evidence.map((item, index) => <div key={item.id} id={anchor(index + 1)} tabIndex={-1} className="scroll-mt-4 rounded-lg border border-line bg-panel-2/50 p-2.5 focus:outline focus:outline-2 focus:outline-brand">
        <p className="text-xs font-semibold text-ink">[{index + 1}] {item.title} · {EVIDENCE_FIELD_LABELS[item.field]}</p>
        <p className="mt-1 text-[11px] text-ink-3">{item.source === "meeting" ? `회의록 리비전 ${item.revision}` : item.source === "wiki" ? `위키 리비전 ${item.revision}` : `용어집 리비전 ${item.revision}`} · {new Date(item.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국 시간){item.meetingDate ? ` · 회의 ${new Date(item.meetingDate).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}</p>
        <blockquote className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words border-l-2 border-brand/30 pl-2 text-xs leading-5 text-ink-2">{item.excerpt}</blockquote>
        {item.images && item.images.length > 0 && <div className="mt-3 space-y-2" aria-label="근거에 포함된 이미지">
          <p className="text-[11px] font-semibold text-ink-2">관련 이미지</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {item.images.map((image) => <MarkdownContent key={image.url} className="text-xs">{`![${image.alt.replaceAll("\\", "\\\\").replaceAll("]", "\\]")}](${image.url})`}</MarkdownContent>)}
          </div>
        </div>}
        {item.source === "meeting" ? (
          <div className="mt-2 flex flex-wrap gap-3 text-xs"><Link href="/meetings" className="text-brand underline">회의 지식 인박스에서 보기</Link></div>
        ) : item.source === "wiki" ? (
          <div className="mt-2 flex flex-wrap gap-3 text-xs"><Link href={`/w/${item.wikiSlug ?? item.slug}`} className="text-brand underline">위키 문서에서 보기</Link></div>
        ) : <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <Link href={`/g/${item.termId ?? item.slug}`} className="text-brand underline">현재 용어</Link>
            <Link href={`/history/${item.termId ?? item.slug}#revision-${item.revision}`} className="text-brand underline">기준 이력</Link>
            {item.relatedTerm && <Link href={`/history/${item.relatedTerm.termId ?? item.relatedTerm.slug}#revision-${item.relatedTerm.revision}`} className="text-brand underline">{item.relatedTerm.title} · 리비전 {item.relatedTerm.revision}</Link>}
          </div>}
      </div>)}
      <p className="text-[11px] text-ink-3">답변 당시의 구절을 보관합니다. 인용 연결은 내용의 정확성이나 공식 승인을 뜻하지 않습니다.</p>
    </section>}
  </div>;
}
