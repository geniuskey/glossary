import "server-only";
import { and, eq } from "drizzle-orm";
import { chatConversations } from "@glossary/db";
import { getDb } from "@/lib/db";
import type { StoredChatMessage } from "./chat-history-values";

export async function appendChatMessage(sessionId: string, userId: string, message: Omit<StoredChatMessage, "id">) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(chatConversations).where(and(eq(chatConversations.id, sessionId), eq(chatConversations.userId, userId))).for("update");
    if (!row) return null;
    const previous = row.messages as StoredChatMessage[];
    const id = previous.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const messages = [...previous.map((item) => message.role === "assistant" ? {
      ...item, teaching: undefined, teachingBatch: undefined,
      edit: message.edit && item.edit?.termId === message.edit.termId && item.edit.status === "pending"
        ? { ...item.edit, status: "cancelled" as const } : item.edit,
    } : item), { ...message, id }];
    await tx.update(chatConversations).set({ messages, updatedAt: new Date() }).where(eq(chatConversations.id, sessionId));
    return messages;
  });
}
