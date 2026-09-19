import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, meetingDocuments, users } from "@glossary/db";

const identity = vi.hoisted(() => ({ user: null as { id: string; role: "admin" | "editor" } | null }));
vi.mock("../src/lib/auth/current-user", () => ({ getCurrentUser: async () => identity.user }));
const { GET: listMeetings, POST: createMeeting } = await import("../src/app/api/v1/meetings/route.js");
const { GET: getMeeting, PATCH: patchMeeting } = await import("../src/app/api/v1/meetings/[id]/route.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
let userId = "";
const meetingIds: string[] = [];

beforeAll(async () => {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@meeting-route.test`, name: "회의록 API 사용자", role: "editor" }).returning();
  userId = user!.id;
  identity.user = { id: userId, role: "editor" };
});

afterAll(async () => {
  for (const id of meetingIds) await db.delete(meetingDocuments).where(eq(meetingDocuments.id, id));
  await db.delete(users).where(eq(users.id, userId));
  identity.user = null;
});

test("회의록 API는 저장·조회·revision 수정·보관을 제공한다", async () => {
  const createdResponse = await createMeeting(new Request("https://glossary.example.com/api/v1/meetings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "상품팀 회의", source: "Notion", team: "상품팀", content: "결정: 베타를 진행한다." }),
  }));
  expect(createdResponse.status).toBe(201);
  const createdBody = await createdResponse.json() as { meeting: { id: string; revision: number; content: string } };
  meetingIds.push(createdBody.meeting.id);
  expect(createdBody.meeting).toMatchObject({ revision: 1, content: "결정: 베타를 진행한다." });

  const listResponse = await listMeetings(new Request("https://glossary.example.com/api/v1/meetings?pageSize=10"));
  expect(listResponse.status).toBe(200);
  await expect(listResponse.json()).resolves.toMatchObject({ items: [expect.objectContaining({ id: createdBody.meeting.id, title: "상품팀 회의" })] });

  const detailResponse = await getMeeting(new Request(`https://glossary.example.com/api/v1/meetings/${createdBody.meeting.id}`), { params: Promise.resolve({ id: createdBody.meeting.id }) });
  expect(detailResponse.status).toBe(200);
  await expect(detailResponse.json()).resolves.toMatchObject({ meeting: { content: "결정: 베타를 진행한다." } });

  const updatedResponse = await patchMeeting(new Request("https://glossary.example.com/api/v1/meetings/id", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "결정: 베타를 진행한다.\n담당: 민수" }),
  }), { params: Promise.resolve({ id: createdBody.meeting.id }) });
  expect(updatedResponse.status).toBe(200);
  await expect(updatedResponse.json()).resolves.toMatchObject({ meeting: { revision: 2, content: expect.stringContaining("민수") } });

  const archivedResponse = await patchMeeting(new Request("https://glossary.example.com/api/v1/meetings/id", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "archived" }),
  }), { params: Promise.resolve({ id: createdBody.meeting.id }) });
  expect(archivedResponse.status).toBe(200);
  const activeList = await listMeetings(new Request("https://glossary.example.com/api/v1/meetings?pageSize=10"));
  await expect(activeList.json()).resolves.not.toMatchObject({ items: [expect.objectContaining({ id: createdBody.meeting.id })] });
  const archivedList = await listMeetings(new Request("https://glossary.example.com/api/v1/meetings?status=archived&pageSize=10"));
  await expect(archivedList.json()).resolves.toMatchObject({ items: [expect.objectContaining({ id: createdBody.meeting.id, status: "archived" })] });
});
