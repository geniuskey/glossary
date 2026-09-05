import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CompletionBadge, CompletionProgress, MissingFields } from "@/components/term-completion";
import { CategoryBadges, DomainBadges, OwnerBadge, StatusBadge, TopicBadge } from "@/components/term-badges";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TERM_TYPE_LABEL } from "@/lib/terms/enums";
import { listContributionTerms } from "@/lib/terms/query";
import { displayName, relativeTime } from "@/lib/ui/format";

export const metadata = { title: "함께 정리" };

export default async function ContributePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const queue = await listContributionTerms(60, user.id);

  return (
    <AppShell user={user} title="함께 정리" current="contribute">
      <header className="mb-7 border-b border-line pb-5">
        <p className="text-xs font-semibold tracking-[0.16em] text-brand">집단지성 대기열</p>
        <p className="mt-2 text-xl font-semibold tracking-tight text-balance lg:hidden">함께 정리해 주세요</p>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-2">
          누군가 먼저 남긴 초안에 알고 있는 정보 하나만 보태도 됩니다. 핵심 정보가 채워진 초안은
          내용을 검토한 뒤 팀에 공개해 주세요.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="참여 방법">
        <Guide number="1" title="아는 용어 고르기" body="제품이나 업무에서 자주 본 표현을 고릅니다." />
        <Guide number="2" title="한 항목만 채우기" body="한줄 정의, 본문, 분야 중 아는 것부터 적습니다." />
        <Guide number="3" title="검토 후 공개하기" body="충분히 읽을 수 있는 수준이 되면 상태를 공개 · 사용으로 바꿉니다." />
      </section>

      <section className="mt-9" aria-labelledby="queue-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="queue-heading" className="text-base font-semibold text-ink text-balance">정리를 기다리는 용어</h2>
            <p className="mt-1 text-xs text-ink-3">비어 있는 항목이 많고 오래 기다린 순서이며, 완성된 초안도 공개 검토를 기다립니다.</p>
          </div>
          <span className="font-mono text-sm tabular-nums text-ink-2">{queue.total.toLocaleString("ko-KR")}개</span>
        </div>

        {queue.items.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {queue.items.map((term) => (
              <li key={term.id} className="card flex min-w-0 flex-col p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CompletionBadge completion={term.completion} />
                      <StatusBadge status={term.status} />
                    </div>
                    <h3 className="mt-3 break-words text-base font-semibold text-ink">{displayName(term)}</h3>
                    {(term.fullNameEn || term.fullNameKo) && (
                      <p className="mt-1 line-clamp-2 text-xs text-ink-3">
                        {[term.fullNameEn, term.fullNameKo].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <span className="chip shrink-0">{TERM_TYPE_LABEL[term.termType]}</span>
                </div>

                <div className="mt-4">
                  <CompletionProgress completion={term.completion} />
                  <div className="mt-2.5">
                    {term.status === "draft" && term.completion.complete ? (
                      <p className="text-xs leading-5 text-brand">
                        핵심 정보가 채워졌습니다. 내용을 확인한 뒤 공개 상태로 바꿔 주세요.
                      </p>
                    ) : (
                      <MissingFields completion={term.completion} />
                    )}
                  </div>
                </div>

                {term.definitionMd && (
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-ink-2">{term.definitionMd}</p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4 mt-4">
                  <DomainBadges domain={term.domain} />
                  <CategoryBadges categories={term.categories} labels={term.categoryLabels} />
                  <TopicBadge topic={term.topic} />
                  <OwnerBadge ownerName={term.ownerName} mine={term.ownerId === user.id} />
                  <span className="text-xs text-ink-3">최근 수정 {relativeTime(new Date(term.updatedAt))}</span>
                  <Link href={`/edit/${term.slug}`} className="btn-primary btn-sm ml-auto">
                    {term.status === "draft" && term.completion.complete ? "검토하고 공개하기" : "아는 정보 보태기"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink">정리하거나 공개를 검토할 용어가 없습니다.</p>
            <p className="mt-1 text-xs text-ink-3">새 초안을 제안하거나 공개된 설명을 더 알기 쉽게 다듬어 주세요.</p>
            <Link href="/new" className="btn-primary mt-4">새 용어 제안하기</Link>
          </div>
        )}

        {queue.total > queue.items.length && (
          <p className="mt-4 text-center text-xs text-ink-3">
            우선 도움이 필요한 {queue.items.length}개를 보여주고 있습니다.
          </p>
        )}
      </section>
    </AppShell>
  );
}

function Guide({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 p-4">
      <span className="font-mono text-xs font-semibold text-brand">{number}</span>
      <h2 className="mt-2 text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-ink-2">{body}</p>
    </div>
  );
}
