import Link from "next/link";
import { ideaWikiDraft, signalLabel, type DiscoveryIdea, type DiscoveryReport } from "@/lib/discovery/ideas";
import { DiscoveryWikiButton } from "./discovery-wiki-button";

function RefLinks({ refs, messageId }: { refs: readonly string[]; messageId: number }) {
  const unique = [...new Set(refs)];
  if (!unique.length) return null;
  return <span className="ml-1 inline-flex flex-wrap gap-1">
    {unique.map((ref) => <a key={ref} href={`#chat-${messageId}-discovery-${ref}`} className="font-semibold text-brand underline underline-offset-2" aria-label={`근거 ${ref} 보기`}>[{ref}]</a>)}
  </span>;
}

const VERDICT_LABEL = { supported: "뒷받침됨", contradicted: "반박됨", insufficient: "근거 부족" } as const;

function Score({ label, value }: { label: string; value: number }) {
  return <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-2">{label} {value}/5</span>;
}

function IdeaCard({ idea, index, messageId, report }: { idea: DiscoveryIdea; index: number; messageId: number; report: DiscoveryReport }) {
  return <section className="mt-4 rounded-xl border border-line bg-panel-2/40 p-3" aria-labelledby={`chat-${messageId}-idea-${index}`}>
    <h4 id={`chat-${messageId}-idea-${index}`} className="text-sm font-semibold text-ink">{index + 1}. {idea.title}</h4>
    <p className="mt-1 text-sm leading-6 text-ink-2">{idea.hypothesis}<RefLinks refs={idea.termRefs} messageId={messageId} /></p>
    {idea.critique && <div className="mt-2 flex flex-wrap gap-1.5" aria-label="비평 점수">
      <Score label="근거" value={idea.critique.grounding} />
      <Score label="새로움" value={idea.critique.novelty} />
      <Score label="실현성" value={idea.critique.feasibility} />
      <Score label="영향" value={idea.critique.impact} />
    </div>}
    {idea.verification && <div className="mt-2 rounded-lg border border-line bg-panel p-2 text-xs leading-5 text-ink-2" aria-label="용어집 검증">
      <p><span className="font-semibold text-ink">용어집 검증 · {VERDICT_LABEL[idea.verification.verdict]}</span>{idea.verification.note ? ` — ${idea.verification.note}` : ""}</p>
      <p className="mt-0.5 text-ink-3">확인한 고리: {idea.verification.query}</p>
      {idea.verification.citations.length > 0 && <ul className="mt-1 space-y-0.5">
        {idea.verification.citations.map((citation) => <li key={citation.id}>
          {citation.wikiSlug ? <Link href={`/w/${citation.wikiSlug}`} className="text-brand underline">{citation.title}</Link> : citation.slug ? <Link href={`/g/${citation.slug}`} className="text-brand underline">{citation.title}</Link> : citation.title}
          {citation.revision !== undefined && <span className="text-ink-3"> · 리비전 {citation.revision}</span>}
          <span className="text-ink-3"> — {citation.excerpt.slice(0, 160)}</span>
        </li>)}
      </ul>}
    </div>}
    {idea.alreadyConnected && <p className="mt-2 text-xs text-warn">인용한 용어가 이미 관계·위키로 이어져 있어 기존 지식의 재진술일 수 있습니다.</p>}
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-ink">추론 과정과 검증 계획</summary>
      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm leading-6 text-ink-2">
        {idea.reasoning.map((step, stepIndex) => <li key={stepIndex}>{step.text}<RefLinks refs={step.evidenceRefs} messageId={messageId} /></li>)}
      </ol>
      <dl className="mt-2 space-y-1.5 text-sm leading-6 text-ink-2">
        {idea.whyNovel && <div><dt className="text-xs font-semibold text-ink">왜 아직 시도되지 않았나</dt><dd>{idea.whyNovel}<RefLinks refs={idea.signalRefs} messageId={messageId} /></dd></div>}
        {idea.firstExperiment && <div><dt className="text-xs font-semibold text-ink">첫 실험</dt><dd>{idea.firstExperiment}</dd></div>}
        {idea.successMetric && <div><dt className="text-xs font-semibold text-ink">성공 지표</dt><dd>{idea.successMetric}</dd></div>}
        {idea.risks.length > 0 && <div><dt className="text-xs font-semibold text-ink">위험</dt><dd><ul className="list-disc pl-5">{idea.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></dd></div>}
        {idea.openQuestions.length > 0 && <div><dt className="text-xs font-semibold text-ink">전문가에게 물을 질문</dt><dd><ul className="list-disc pl-5">{idea.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></dd></div>}
        {idea.critique?.comment && <div><dt className="text-xs font-semibold text-ink">비평</dt><dd>{idea.critique.comment}</dd></div>}
      </dl>
    </details>
    <DiscoveryWikiButton draft={ideaWikiDraft(idea, report)} />
  </section>;
}

export function ChatDiscovery({ report, answer, messageId }: { report: DiscoveryReport; answer: string; messageId: number }) {
  const { stats } = report;
  return <div>
    <p className="text-sm leading-6 text-ink">
      {report.ideas.length
        ? `용어 ${stats.terms.toLocaleString("ko-KR")}개·관계 ${stats.relations.toLocaleString("ko-KR")}개·공개 위키 ${stats.wikiPages.toLocaleString("ko-KR")}건의 구조에서 아직 이어지지 않은 곳을 찾아 도전 가설 ${report.ideas.length}개를 만들었습니다.`
        : answer}
    </p>
    {report.dropped > 0 && <p className="mt-1 text-xs text-ink-3">비평 단계에서 근거가 약하거나 진부한 가설 {report.dropped}개를 제외했습니다.</p>}
    {stats.truncated && <p className="mt-1 text-xs text-warn">용어집이 커서 그래프 일부만 분석했습니다.</p>}
    {report.ideas.map((idea, index) => <IdeaCard key={idea.title} idea={idea} index={index} messageId={messageId} report={report} />)}
    {(report.signals.length > 0 || report.terms.length > 0) && <section className="mt-4 border-t border-line pt-3" aria-label="발굴 근거">
      <p className="text-xs font-semibold text-ink">발굴 근거</p>
      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-ink-2">
        {report.signals.map((signal) => <li key={signal.ref} id={`chat-${messageId}-discovery-${signal.ref}`} tabIndex={-1} className="scroll-mt-4">
          <span className="font-semibold text-ink">[{signal.ref}] {signalLabel(signal.kind)}</span> · {signal.summary}
        </li>)}
        {report.terms.map((term) => <li key={term.ref} id={`chat-${messageId}-discovery-${term.ref}`} tabIndex={-1} className="scroll-mt-4">
          <span className="font-semibold text-ink">[{term.ref}]</span>{" "}
          <Link href={`/g/${term.termId}`} className="text-brand underline">{term.name}</Link>
          {term.domains.length > 0 && <span className="text-ink-3"> · {term.domains.join(", ")}</span>}
          <span className="text-ink-3"> · 리비전 {term.revision}</span>
          <p className="break-words">{term.definition}</p>
        </li>)}
      </ul>
      <p className="mt-2 text-[11px] text-ink-3">S는 그래프 구조에서 계산한 신호, T는 용어집 리비전입니다. 가설은 추론이며 검증된 사실이 아닙니다.</p>
    </section>}
  </div>;
}
