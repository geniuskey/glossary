import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ChatPanel } from "@/components/chat-panel";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/api-error";

export const metadata = { title: "용어 챗봇" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ session?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const session = (await searchParams).session;
  if (typeof session === "string" && isUuid(session)) redirect(`/c/${session}`);
  const config = publicAiConfig(await loadAiConfig());
  return (
    <AppShell user={user} title="용어 챗봇" current="chat" wide>
      <ChatPanel enabled={config.enabled && config.secretsReadable} />
    </AppShell>
  );
}
