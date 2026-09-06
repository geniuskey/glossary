import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { listManagedUsers } from "@/lib/admin/users";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { listDefinitionReviewCandidates } from "@/lib/ai/definition-review";
import { getCurrentUser } from "@/lib/auth/current-user";
import { authMode, oauth2ProxyEnabled, proxyHeaderNames } from "@/lib/auth/sso/proxy-headers";
import { getHomeContent } from "@/lib/workspace/home-content";
import { getTermQualityOverview, getTermQualitySettings } from "@/lib/workspace/term-quality";
import { cx } from "@/lib/ui/format";
import { AiSettingsPanel } from "./ai-settings-panel";
import { HomeContentPanel } from "./home-content-panel";
import { TermQualityPanel } from "./term-quality-panel";
import { DefinitionReviewPanel } from "./definition-review-panel";
import { UsersPanel } from "./users-panel";
import { SsoSettingsForm } from "@/app/settings/sso/sso-settings-form";

export const metadata = { title: "관리자" };

const ADMIN_TABS = [
  { key: "home", label: "홈 화면" },
  { key: "quality", label: "콘텐츠 완성도" },
  { key: "ai", label: "AI 연결" },
  { key: "sso", label: "로그인 · SSO" },
  { key: "users", label: "사용자" },
] as const;
type AdminTab = (typeof ADMIN_TABS)[number]["key"];

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const rawTab = (await searchParams).tab;
  const requestedTab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab: AdminTab = ADMIN_TABS.some((item) => item.key === requestedTab) ? requestedTab as AdminTab : "home";

  let panel: ReactNode;
  if (tab === "home") panel = <HomeContentPanel initialContent={await getHomeContent()} />;
  else if (tab === "quality") {
    const settings = await getTermQualitySettings();
    const [overview, candidates] = await Promise.all([
      getTermQualityOverview(settings),
      listDefinitionReviewCandidates(),
    ]);
    panel = <div className="space-y-8">
      <TermQualityPanel overview={overview} />
      <DefinitionReviewPanel initialCandidates={candidates} />
    </div>;
  } else if (tab === "ai") panel = <AiSettingsPanel initialConfig={publicAiConfig(await loadAiConfig())} />;
  else if (tab === "sso") panel = (
    <div>
      <header className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-ink">로그인 및 SSO</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-2">
          사용할 회사 로그인 방식을 고르고, 계정 정보와 그룹을 어떤 값에서 읽을지 설정합니다.
        </p>
      </header>
      <SsoSettingsForm
        runtime={{
          authMode: authMode(),
          proxyAvailable: oauth2ProxyEnabled(),
          proxyHeaderNames: proxyHeaderNames(),
        }}
      />
    </div>
  );
  else panel = <UsersPanel initialUsers={await listManagedUsers()} viewerId={user.id} />;

  return (
    <AppShell user={user} title="관리자 패널" current="admin" roomy>
      <header className="mb-6">
        <p className="text-xl font-semibold tracking-tight lg:hidden">관리자 패널</p>
        <nav className="mt-4 flex overflow-x-auto border-b border-line" aria-label="관리자 하위 메뉴">
          {ADMIN_TABS.map((item) => (
            <Link
              key={item.key}
              href={item.key === "home" ? "/admin" : `/admin?tab=${item.key}`}
              aria-current={tab === item.key ? "page" : undefined}
              className={cx(
                "relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition",
                tab === item.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {panel}
    </AppShell>
  );
}
