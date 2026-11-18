import Link from "next/link";
import type { PublicAiConfig } from "@/lib/ai/config-values";
import type { PublicRagConfig } from "@/lib/rag/config-values";
import type { TermQualityOverview } from "@/lib/workspace/term-quality";
import type { ResolvedWorkspaceMenuSettings } from "@/lib/workspace/menu-settings-values";
import { WORKSPACE_MENU_OPTIONS } from "@/lib/workspace/menu-settings-values";
import { cx } from "@/lib/ui/format";
import { AdminPanelHeader, StatusBadge, type AdminTone } from "./admin-ui";

interface AdminOverviewPanelProps {
  menuSettings: ResolvedWorkspaceMenuSettings;
  quality: TermQualityOverview;
  ai: PublicAiConfig;
  rag: PublicRagConfig;
  users: { total: number; admins: number; activeSessions: number };
}

interface AttentionItem { text: string; href: string; action: string; tone: "warn" | "danger" }

export function AdminOverviewPanel({ menuSettings, quality, ai, rag, users }: AdminOverviewPanelProps) {
  const enabledMenus = WORKSPACE_MENU_OPTIONS.filter((item) => menuSettings[item.key]).length;
  const qualityPercent = quality.total > 0 ? Math.round((quality.complete / quality.total) * 100) : 100;
  const n = (value: number) => value.toLocaleString("ko-KR");

  // 기능을 꺼 둔 것은 조직의 선택이지 장애가 아니다. 켜 놓았는데 쓸 수 없는
  // 상태(비밀값을 못 읽음, 색인 실패)만 확인할 일로 올린다.
  const attention: AttentionItem[] = [
    ai.enabled && !ai.secretsReadable ? { text: "AI 연결의 비밀값을 읽을 수 없습니다. 챗봇과 자동 검토가 멈춰 있습니다.", href: "/admin?tab=ai", action: "AI 연결 확인", tone: "danger" as const } : null,
    rag.enabled && !rag.secretsReadable ? { text: "검색 인프라의 비밀값을 읽을 수 없습니다. 새 용어가 색인되지 않습니다.", href: "/admin?tab=rag", action: "검색 인프라 확인", tone: "danger" as const } : null,
    rag.stats.failed > 0 ? { text: `검색 색인에 실패한 항목이 ${n(rag.stats.failed)}건 있습니다.`, href: "/admin?tab=rag", action: "색인 상태 보기", tone: "warn" as const } : null,
    quality.incomplete > 0 ? { text: `필요한 정보가 비어 있는 용어가 ${n(quality.incomplete)}개 있습니다.`, href: "/admin?tab=quality", action: "보완 현황 보기", tone: "warn" as const } : null,
  ].filter((item): item is AttentionItem => item !== null);

  return (
    <section aria-labelledby="admin-overview-heading">
      <AdminPanelHeader
        id="admin-overview-heading"
        title="운영 개요"
        description="용어집의 현재 상태와 확인이 필요한 항목입니다. 카드를 누르면 해당 설정으로 이동합니다."
        status={attention.length === 0 ? <StatusBadge tone="ok">확인할 항목 없음</StatusBadge> : <StatusBadge tone={attention.some((item) => item.tone === "danger") ? "danger" : "warn"}>확인 필요 {attention.length}건</StatusBadge>}
      />

      {attention.length > 0 && (
        <section className="card mb-6 overflow-hidden" aria-labelledby="admin-attention-heading">
          <h3 id="admin-attention-heading" className="border-b border-line bg-panel-2/50 px-4 py-2.5 text-xs font-semibold text-ink-2">확인이 필요한 항목</h3>
          <ul className="divide-y divide-line">
            {attention.map((item) => (
              <li key={item.text} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", item.tone === "danger" ? "bg-danger" : "bg-warn")} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-sm text-ink">{item.text}</span>
                <Link href={item.href} className="btn-ghost btn-sm shrink-0">{item.action}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="관리자 운영 지표">
        <OverviewMetric label="AI 연결" value={!ai.enabled ? "꺼짐" : !ai.secretsReadable ? "확인 필요" : "사용 중"} hint={ai.enabled ? ai.model || "모델 미설정" : "챗봇과 자동 검토를 쓰지 않음"} href="/admin?tab=ai" tone={!ai.enabled ? "neutral" : !ai.secretsReadable ? "danger" : "ok"} />
        <OverviewMetric label="검색 인프라" value={!rag.enabled ? "꺼짐" : !rag.secretsReadable ? "확인 필요" : `${n(rag.stats.indexedTerms)}/${n(rag.stats.totalTerms)}`} hint={rag.enabled ? `용어 색인 · 대기 ${n(rag.stats.queued)} · 실패 ${n(rag.stats.failed)}` : "키워드 검색만 사용"} href="/admin?tab=rag" tone={!rag.enabled ? "neutral" : !rag.secretsReadable ? "danger" : rag.stats.failed > 0 ? "warn" : "ok"} />
        <OverviewMetric label="콘텐츠 완성도" value={`${qualityPercent}%`} hint={quality.incomplete > 0 ? `${n(quality.incomplete)}개 보완 필요` : "모든 용어가 기준 충족"} href="/admin?tab=quality" tone={quality.incomplete > 0 ? "warn" : "ok"} />
        <OverviewMetric label="사용자" value={`${n(users.total)}명`} hint={`관리자 ${n(users.admins)}명 · 활성 세션 ${n(users.activeSessions)}개`} href="/admin?tab=users" />
        <OverviewMetric label="표시 메뉴" value={`${enabledMenus}/${WORKSPACE_MENU_OPTIONS.length}`} hint="사용자 사이드바에 보이는 메뉴" href="/admin?tab=menus" />
      </div>
    </section>
  );
}

function OverviewMetric({ label, value, hint, href, tone }: { label: string; value: string; hint: string; href: string; tone?: AdminTone }) {
  return (
    <Link href={href} className="card group block px-4 py-3.5 transition-colors hover:border-brand/40 hover:bg-brand-soft/10">
      <span className="flex items-center gap-2 text-xs text-ink-3">
        {tone && <span className={cx("h-1.5 w-1.5 rounded-full", tone === "ok" && "bg-ok", tone === "warn" && "bg-warn", tone === "danger" && "bg-danger", tone === "neutral" && "bg-ink-3")} aria-hidden="true" />}
        {label}
        <span className="ml-auto text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">→</span>
      </span>
      <span className={cx("mt-1 block truncate text-xl font-semibold tabular-nums", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</span>
      <span className="mt-1 block truncate text-[11px] text-ink-3">{hint}</span>
    </Link>
  );
}
