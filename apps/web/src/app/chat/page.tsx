import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ChatPanel } from "@/components/chat-panel";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/api-error";

export const metadata = { title: "용어 챗봇" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ session?: string | string[]; prompt?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const session = params.session;
  if (typeof session === "string" && isUuid(session)) redirect(`/c/${session}`);
  const config = publicAiConfig(await loadAiConfig());
  const rawPrompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;
  const initialQuestion = rawPrompt?.trim().slice(0, 20_000) || undefined;
  return (
    <AppShell user={user} title="용어 챗봇" current="chat" wide>
      <ChatPanel enabled={config.enabled && config.secretsReadable} initialQuestion={initialQuestion} />
    </AppShell>
  );
}
