import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ChatPanel } from "@/components/chat-panel";
import { isUuid } from "@/lib/api-error";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata = { title: "용어 챗봇" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const config = publicAiConfig(await loadAiConfig());
  return (
    <AppShell user={user} title="용어 챗봇" current="chat" roomy dense>
      <ChatPanel enabled={config.enabled && config.secretsReadable} initialSessionId={id} />
    </AppShell>
  );
}
