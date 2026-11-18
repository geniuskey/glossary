import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { listManagedUsers } from "@/lib/admin/users";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { getAiObservabilitySnapshot } from "@/lib/ai/telemetry";
import { listReviewQueue } from "@/lib/ai/auto-review";
import { loadRagConfig, publicRagConfig } from "@/lib/rag/config";
import { getRagIndexStats } from "@/lib/rag/indexer";
import { getSyncStatus } from "@/lib/sync/status";
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
import { SyncPanel } from "./sync-panel";
import { SsoSettingsForm } from "@/app/settings/sso/sso-settings-form";
import { BrandSettingsPanel } from "./brand-settings-panel";
import { MenuSettingsPanel } from "./menu-settings-panel";
import { AdminOverviewPanel } from "./admin-overview-panel";
import { ADMIN_NAV_GROUPS, ADMIN_TAB_ALIASES, AdminNavigation, adminTabHref, type AdminTab } from "./admin-navigation";
import { AdminPanelHeader } from "./admin-ui";

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
  const alias = requestedTab ? ADMIN_TAB_ALIASES[requestedTab] : undefined;
  if (alias) redirect(adminTabHref(alias));
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
  else if (tab === "data") panel = (
    <section aria-labelledby="admin-data-heading">
      <AdminPanelHeader
        id="admin-data-heading"
        title="백업 · 동기화"
        description="전체 용어집을 백업용 스냅샷으로 내려받거나, 네트워크로 연결되지 않은 서버 사이에서 번들 파일로 데이터를 옮깁니다."
      />
      <div className="grid gap-8">
        <DataExportPanel />
        <SyncPanel initialStatus={await getSyncStatus()} />
      </div>
    </section>
  );
  else if (tab === "sso") panel = (
    <section aria-labelledby="admin-sso-heading">
      <AdminPanelHeader
        id="admin-sso-heading"
        title="로그인 방식"
        description="이메일·비밀번호 로그인과 Google 계정 로그인 또는 회사 SSO 연결을 설정합니다."
      />
      <SsoSettingsForm
        runtime={{
          authMode: authMode(),
          proxyAvailable: oauth2ProxyEnabled(),
          proxyHeaderNames: proxyHeaderNames(),
        }}
      />
    </section>
  );
  else panel = <UsersPanel initialUsers={await listManagedUsers()} viewerId={user.id} />;

  return (
    <AppShell user={user} title="관리자" current="admin" roomy>
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <AdminNavigation current={tab} />
        <div className="min-w-0">{panel}</div>
      </div>
    </AppShell>
  );
}
