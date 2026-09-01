import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { apiKeys, createDb, terms } from "@grossary/db";
import { generateApiKey } from "../src/lib/auth/api-key.js";
import { SESSION_COOKIE } from "../src/lib/auth/session.js";
import { createTerm } from "../src/lib/terms/create.js";

// R83: 세션 경로가 next/headers의 cookies()를 부르는데 여기는 Next 요청 컨텍스트
// 밖이다. 모킹하지 않으면 던져진 예외를 withApiErrors가 500으로 바꿔, "인증 없이
// 부르면 401"이 아니라 엉뚱한 경로를 테스트하게 된다(terms-lookup.test.ts와 동일).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const { GET: suggestGet, POST: suggestPost } = await import("../src/app/api/v1/terms/suggest/route.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];
const keyIds: string[] = [];

async function makeReadKey(): Promise<string> {
  const { token, prefix, hash } = generateApiKey();
  const [key] = await db
    .insert(apiKeys)
    .values({ name: "suggest 테스트 키", prefix, keyHash: hash, scopes: ["read"] })
    .returning();
  keyIds.push(key!.id);
  return token;
}

function suggestRequest(query: string, token?: string): Request {
  return new Request(`http://x/api/v1/terms/suggest${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeAll(async () => {
  const created = await createTerm(
    {
      termType: "concept",
      nameEn: "ZugbenchXSGST",
      domain: ["HW"],
      status: "active",
      surfaces: [{ text: "ZugXSGST", lang: "en", kind: "abbreviation" }],
    },
    null,
  );
  ids.push(created.term.id);
});

afterAll(async () => {
  for (const id of ids) await db.delete(terms).where(eq(terms.id, id));
  for (const id of keyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

test("인증 없이 부르면 401", async () => {
  // 자동완성은 사전 전체의 표기를 앞부분만으로 흘려보내는 창구다 — 읽기 권한
  // 검사를 빠뜨리면 목록 API를 잠가둔 의미가 사라진다.
  const res = await suggestGet(suggestRequest("?q=Zug"));
  expect(res.status).toBe(401);
  expect((await res.json()).error.code).toBe("unauthorized");
});

test("q가 없거나 비어 있으면 400", async () => {
  const token = await makeReadKey();

  for (const query of ["", "?q=", "?q=%20%20"]) {
    const res = await suggestGet(suggestRequest(query, token));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.field).toBe("q");
  }
});

test("몇 자만 쳐도 그 표기를 가진 용어가 후보로 온다", async () => {
  const token = await makeReadKey();
  const res = await suggestGet(suggestRequest("?q=ZugX", token));

  expect(res.status).toBe(200);
  const { items } = await res.json();
  const hit = items.find((s: { id: string }) => s.id === ids[0]);

  expect(hit).toBeDefined();
  // 화면이 굵게 칠하고 `?from=`을 붙이는 데 필요한 필드들. 하나라도 빠지면
  // 드롭다운은 에러 없이 빈칸을 그린다.
  expect(hit.matchedText).toBe("ZugXSGST");
  expect(hit.matchedKind).toBe("abbreviation");
  expect(hit.prefix).toBe(true);
  expect(hit.slug).toBeTruthy();
  // 정의문·도메인은 싣지 않는다(한 글자마다 오가는 응답이다).
  expect(hit.definitionMd).toBeUndefined();
});

test("GET 외의 메서드는 Allow를 달고 405", async () => {
  const res = await suggestPost();
  expect(res.status).toBe(405);
  // R37: GET을 허용하면 Next가 파생시키는 HEAD도 함께 광고해야 한다.
  expect(res.headers.get("allow")).toBe("GET, HEAD");
});
