import Link from "next/link";
import type { PublicAiConfig } from "@/lib/ai/config-values";
import type { PublicRagConfig } from "@/lib/rag/config-values";
import type { TermQualityOverview } from "@/lib/workspace/term-quality";
import type { ResolvedWorkspaceMenuSettings } from "@/lib/workspace/menu-settings-values";
import { WORKSPACE_MENU_OPTIONS } from "@/lib/workspace/menu-settings-values";
import { cx } from "@/lib/ui/format";

interface AdminOverviewPanelProps {
  menuSettings: ResolvedWorkspaceMenuSettings;
  quality: TermQualityOverview;
  ai: PublicAiConfig;
  rag: PublicRagConfig;
  users: { total: number; admins: number; activeSessions: number };
}

export function AdminOverviewPanel({ menuSettings, quality, ai, rag, users }: AdminOverviewPanelProps) {
  const enabledMenus = WORKSPACE_MENU_OPTIONS.filter((item) => menuSettings[item.key]).length;
  const qualityPercent = quality.total > 0 ? Math.round((quality.complete / quality.total) * 100) : 100;
  const aiState = !ai.enabled ? "꺼짐" : !ai.secretsReadable ? "확인 필요" : "활성";
  const ragState = !rag.enabled ? "꺼짐" : !rag.secretsReadable ? "확인 필요" : "활성";
  const attention = [
    quality.incomplete > 0 ? `콘텐츠 보완이 필요한 용어 ${quality.incomplete.toLocaleString("ko-KR")}개` : null,
    ai.enabled && !ai.secretsReadable ? "AI 연결의 비밀값을 읽을 수 없음" : null,
    rag.enabled && !rag.secretsReadable ? "검색 인프라의 비밀값을 읽을 수 없음" : null,
    rag.stats.failed > 0 ? `RAG 색인 실패 ${rag.stats.failed.toLocaleString("ko-KR")}건` : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <section aria-labelledby="admin-overview-heading">
      <header className="mb-6 flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Admin workspace</p>
          <h2 id="admin-overview-heading" className="mt-1 text-2xl font-semibold tracking-tight text-ink">운영 개요</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">용어집의 현재 상태와 점검이 필요한 항목을 한눈에 확인하고, 필요한 설정으로 바로 이동하세요.</p>
        </div>
        <Link href="/admin?tab=menus" className="btn-primary btn-sm shrink-0">메뉴 구성 열기</Link>
      </header>

      {attention.length > 0 && (
        <div className="note note-warn mb-5" role="status">
          <p className="font-medium">확인이 필요한 항목</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {attention.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="관리자 운영 지표">
        <OverviewMetric label="표시 메뉴" value={`${enabledMenus}/${WORKSPACE_MENU_OPTIONS.length}`} hint="사용자 사이드바" href="/admin?tab=menus" />
        <OverviewMetric label="콘텐츠 완성도" value={`${qualityPercent}%`} hint={`${quality.incomplete.toLocaleString("ko-KR")}개 보완 필요`} href="/admin?tab=quality" tone={quality.incomplete > 0 ? "warn" : "normal"} />
        <OverviewMetric label="AI 연결" value={aiState} hint={ai.model || "모델 미설정"} href="/admin?tab=ai" tone={aiState === "확인 필요" ? "warn" : "normal"} />
        <OverviewMetric label="검색 인프라" value={ragState} hint={`${rag.stats.indexedTerms.toLocaleString("ko-KR")}/${rag.stats.totalTerms.toLocaleString("ko-KR")}개 용어 색인`} href="/admin?tab=rag" tone={ragState === "확인 필요" ? "warn" : "normal"} />
        <OverviewMetric label="사용자" value={users.total.toLocaleString("ko-KR")} hint={`관리자 ${users.admins}명 · 활성 세션 ${users.activeSessions}개`} href="/admin?tab=users" />
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        <section className="card overflow-hidden" aria-labelledby="admin-overview-workspace-heading">
          <div className="border-b border-line px-4 py-3">
            <h3 id="admin-overview-workspace-heading" className="text-sm font-semibold text-ink">서비스 구성</h3>
            <p className="mt-1 text-xs text-ink-3">사용자가 보는 경험과 콘텐츠 기준을 관리합니다.</p>
          </div>
          <div className="divide-y divide-line">
            <OverviewLink href="/admin?tab=menus" label="메뉴 구성" description="부가 기능을 조직의 사용 범위에 맞춰 표시하거나 숨깁니다." />
            <OverviewLink href="/admin?tab=home" label="홈 콘텐츠" description="첫 화면의 소개 문구를 수정합니다." />
            <OverviewLink href="/admin?tab=quality" label="콘텐츠 완성도" description="용어 작성 기준과 보완 현황을 확인합니다." />
          </div>
        </section>

        <section className="card overflow-hidden" aria-labelledby="admin-overview-ai-heading">
          <div className="border-b border-line px-4 py-3">
            <h3 id="admin-overview-ai-heading" className="text-sm font-semibold text-ink">AI · 검색</h3>
            <p className="mt-1 text-xs text-ink-3">연결 상태와 검색 색인 운영 화면으로 이동합니다.</p>
          </div>
          <div className="divide-y divide-line">
            <OverviewLink href="/admin?tab=ai" label="AI 연결" description="챗봇과 자동 검토에 사용할 모델을 설정합니다." />
            <OverviewLink href="/admin?tab=rag" label="검색 인프라" description="Embedding, Reranker와 색인 정책을 관리합니다." />
            <OverviewLink href="/admin?tab=observability" label="AI 운영" description="호출량, 실패, 지연과 작업 큐를 확인합니다." />
          </div>
        </section>
      </div>
    </section>
  );
}

function OverviewMetric({ label, value, hint, href, tone = "normal" }: { label: string; value: string; hint: string; href: string; tone?: "normal" | "warn" }) {
  return (
    <Link href={href} className="card block px-4 py-3 transition-colors hover:border-brand/40 hover:bg-brand-soft/10">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={cx("mt-1 truncate text-xl font-semibold tabular-nums", tone === "warn" ? "text-warn" : "text-ink")}>{value}</p>
      <p className="mt-1 truncate text-[11px] text-ink-3">{hint}</p>
    </Link>
  );
}

function OverviewLink({ href, label, description }: { href: string; label: string; description: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-panel-2/55">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-soft text-xs font-semibold text-brand" aria-hidden="true">↗</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-ink-3">{description}</span>
      </span>
    </Link>
  );
}
