import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { listManagedUsers } from "@/lib/admin/users";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { getAiObservabilitySnapshot } from "@/lib/ai/telemetry";
import { listReviewQueue } from "@/lib/ai/auto-review";
import { loadRagConfig, publicRagConfig } from "@/lib/rag/config";
import { getRagIndexStats } from "@/lib/rag/indexer";
import { getCurrentUser } from "@/lib/auth/current-user";
import { authMode, oauth2ProxyEnabled, proxyHeaderNames } from "@/lib/auth/sso/proxy-headers";
import { getHomeContent } from "@/lib/workspace/home-content";
import { getWorkspaceMenuSettings } from "@/lib/workspace/menu-settings";
import { getTermQualityOverview, getTermQualitySettings } from "@/lib/workspace/term-quality";
import { AiSettingsPanel } from "./ai-settings-panel";
import { AiObservabilityPanel } from "./ai-observability-panel";
import { RagSettingsPanel } from "./rag-settings-panel";
import { HomeContentPanel } from "./home-content-panel";
import { TermQualityPanel } from "./term-quality-panel";
import { UsersPanel } from "./users-panel";
import { DataExportPanel } from "./data-export-panel";
import { SsoSettingsForm } from "@/app/settings/sso/sso-settings-form";
import { BrandSettingsPanel } from "./brand-settings-panel";
import { MenuSettingsPanel } from "./menu-settings-panel";
import { AdminOverviewPanel } from "./admin-overview-panel";
import { ADMIN_NAV_GROUPS, AdminNavigation, type AdminTab } from "./admin-navigation";

export const metadata = { title: "관리자" };

function isAdminTab(value: string | undefined): value is AdminTab {
  return value === "overview" || ADMIN_NAV_GROUPS.some((group) => group.items.some((item) => item.key === value));
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const rawTab = (await searchParams).tab;
  const requestedTab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab: AdminTab = isAdminTab(requestedTab) ? requestedTab : "overview";

  let panel: ReactNode;
  if (tab === "overview") {
    const [menuSettings, qualitySettings, aiConfig, ragConfig, ragStats, managedUsers] = await Promise.all([
      getWorkspaceMenuSettings(),
      getTermQualitySettings(),
      loadAiConfig(),
      loadRagConfig(),
      getRagIndexStats(),
      listManagedUsers(),
    ]);
    panel = <AdminOverviewPanel
      menuSettings={menuSettings}
      quality={await getTermQualityOverview(qualitySettings)}
      ai={publicAiConfig(aiConfig)}
      rag={publicRagConfig(ragConfig, ragStats)}
      users={{
        total: managedUsers.length,
        admins: managedUsers.filter((item) => item.role === "admin").length,
        activeSessions: managedUsers.reduce((sum, item) => sum + item.activeSessions, 0),
      }}
    />;
  }
  else if (tab === "home") {
    const [content, menuSettings, aiConfig] = await Promise.all([getHomeContent(), getWorkspaceMenuSettings(), loadAiConfig()]);
    const ai = publicAiConfig(aiConfig);
    panel = <HomeContentPanel
      initialContent={content}
      initialMode={menuSettings.homeMode}
      aiAvailable={ai.enabled && ai.secretsReadable}
    />;
  }
  else if (tab === "brand") panel = <BrandSettingsPanel initialPreset={(await getWorkspaceMenuSettings()).brandPreset} />;
  else if (tab === "menus") panel = <MenuSettingsPanel initialSettings={await getWorkspaceMenuSettings()} />;
  else if (tab === "quality") {
    const settings = await getTermQualitySettings();
    panel = <TermQualityPanel overview={await getTermQualityOverview(settings)} />;
  } else if (tab === "ai") panel = <AiSettingsPanel initialConfig={publicAiConfig(await loadAiConfig())} />;
  else if (tab === "observability") {
    const [snapshot, aiConfig, ragConfig, ragStats, reviewQueue] = await Promise.all([
      getAiObservabilitySnapshot(24),
      loadAiConfig(),
      loadRagConfig(),
      getRagIndexStats(),
      listReviewQueue(20),
    ]);
    const publicAi = publicAiConfig(aiConfig);
    const publicRag = publicRagConfig(ragConfig, ragStats);
    panel = <AiObservabilityPanel
      initialSnapshot={snapshot}
      initialQueues={{ rag: ragStats, review: reviewQueue }}
      initialReadiness={{
        aiEnabled: publicAi.enabled,
        aiSecretsReadable: publicAi.secretsReadable,
        ragEnabled: publicRag.enabled,
        ragSecretsReadable: publicRag.secretsReadable,
      }}
    />;
  }
  else if (tab === "rag") {
    const [config, stats] = await Promise.all([loadRagConfig(), getRagIndexStats()]);
    panel = <RagSettingsPanel initialConfig={publicRagConfig(config, stats)} />;
  }
  else if (tab === "data") panel = <DataExportPanel />;
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
    <AppShell user={user} title="관리자" current="admin" roomy>
      <header className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Admin workspace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">관리자</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">서비스 구성, AI·검색, 조직 접근과 데이터를 한곳에서 관리합니다.</p>
      </header>

      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <AdminNavigation current={tab} />
        <div className="min-w-0">{panel}</div>
      </div>
    </AppShell>
  );
}
