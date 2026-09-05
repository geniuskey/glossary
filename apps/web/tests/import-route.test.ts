import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { afterAll, expect, test, vi } from "vitest";
import { apiKeys, createDb, terms } from "@glossary/db";
import { generateApiKey } from "../src/lib/auth/api-key.js";
import { SESSION_COOKIE } from "../src/lib/auth/session.js";

// terms-lookup.test.ts(R83)와 같은 이유: 이 라우트의 요청은 실제 Next 요청
// 컨텍스트 밖에서 만들어지므로, next/headers의 cookies()를 모킹하지 않으면
// getCurrentUser가 던지고 withApiErrors가 그걸 500으로 바꿔 "인증 없으면 401"
// 이라는 의도와 다른 경로를 테스트하게 된다.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE ? undefined : undefined),
  }),
}));

const { POST: importPost } = await import("../src/app/api/v1/import/route.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
const createdKeyIds: string[] = [];
const createdTermIds: string[] = [];

async function makeWriteKey(): Promise<string> {
  const { token, prefix, hash } = generateApiKey();
  const [key] = await db
    .insert(apiKeys)
    .values({ name: "import 라우트 테스트 키", prefix, keyHash: hash, scopes: ["write"] })
    .returning();
  createdKeyIds.push(key!.id);
  return token;
}

// R118 테스트 파일 작성 중 발견: exceljs의 index.d.ts는 자체 앰비언트
// `interface Buffer extends ArrayBuffer {}`를 선언해 writeBuffer()의 반환
// 타입을 사실상 ArrayBuffer의 별칭으로 만든다(모듈 스코프라 @types/node의
// 전역 Buffer와는 다른 타입). 그 값을 Node 전역 Buffer나 Uint8Array 뷰로
// 감싸면 TS 5.7+의 Uint8Array<ArrayBufferLike> 제네릭과 DOM lib의
// BlobPart(ArrayBufferView<ArrayBuffer> 요구)가 서로 어긋나 tsc가 거부한다
// (TS2352/TS2322, 실측). import-parse.test.ts와 같은 패턴대로 `as
// ArrayBuffer`로 직접 캐스팅해 순수 ArrayBuffer로 다루면 BlobPart 유니온의
// ArrayBuffer 분기와 바로 맞는다.
async function buildXlsx(nameEn: string): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("glossary");
  ws.addRow(["name_en"]);
  ws.addRow([nameEn]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

afterAll(async () => {
  for (const id of createdTermIds) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdKeyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

test("인증 없이 호출하면 401 규약을 반환한다", async () => {
  const buf = await buildXlsx("ID14Route Auth");
  const form = new FormData();
  form.set("file", new File([buf], "t.xlsx"));
  form.set("dryRun", "true");

  const res = await importPost(new Request("http://x/api/v1/import", { method: "POST", body: form }));

  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe("unauthorized");
});

// R118: formData()가 실제로 던지는 경로 — content-type이 multipart가 아닌
// 본문(JSON)을 보내면 request.formData()가 throw한다. withApiErrors가 감싸
// 500으로 새지 않게 하는 것만으로는 부족하다 — 이건 재시도해도 절대 성공하지
// 않는 영구적 요청 오류이므로 400이어야 한다(R41/R59와 같은 원칙).
test("R118: multipart가 아닌 본문을 보내면 400 validation_failed를 반환한다", async () => {
  const token = await makeWriteKey();
  const res = await importPost(
    new Request("http://x/api/v1/import", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ not: "multipart" }),
    }),
  );

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});

// R119: Content-Length 헤더가 상한을 넘으면 formData()를 부르기 전에 곧바로
// 거부한다. 실제 바디 크기가 헤더와 다르더라도(여기선 일부러 작은 바디를 붙임)
// 헤더만으로 먼저 걸러지는지 확인한다.
test("R119: Content-Length 헤더가 상한을 넘으면 413을 즉시 반환한다", async () => {
  const token = await makeWriteKey();
  const res = await importPost(
    new Request("http://x/api/v1/import", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        authorization: `Bearer ${token}`,
        "content-length": String(20 * 1024 * 1024),
      },
      body: "tiny body, header lies about size",
    }),
  );

  expect(res.status).toBe(413);
  const body = await res.json();
  expect(body.error.code).toBe("payload_too_large");
});

test("파일이 없는 form-data는 400 validation_failed를 반환한다", async () => {
  const token = await makeWriteKey();
  const form = new FormData();
  form.set("dryRun", "true");

  const res = await importPost(
    new Request("http://x/api/v1/import", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  );

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});

test("dry-run 요청은 실제로 DB에 아무 것도 쓰지 않고 report를 돌려준다", async () => {
  const token = await makeWriteKey();
  const buf = await buildXlsx("ID14Route DryRun");
  const form = new FormData();
  form.set("file", new File([buf], "t.xlsx"));
  form.set("dryRun", "true");

  const res = await importPost(
    new Request("http://x/api/v1/import", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.dryRun).toBe(true);
  expect(body.report).toMatchObject({ total: 1, ready: 1 });

  const rows = await db.select().from(terms).where(eq(terms.nameEn, "ID14Route DryRun"));
  expect(rows).toEqual([]);
});

test("dryRun=false 요청은 실제로 term을 생성한다", async () => {
  const token = await makeWriteKey();
  const buf = await buildXlsx("ID14Route Apply");
  const form = new FormData();
  form.set("file", new File([buf], "t.xlsx"));
  form.set("dryRun", "false");

  const res = await importPost(
    new Request("http://x/api/v1/import", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.dryRun).toBe(false);
  expect(body.created).toBe(1);

  const rows = await db.select().from(terms).where(eq(terms.nameEn, "ID14Route Apply"));
  expect(rows).toHaveLength(1);
  createdTermIds.push(rows[0]!.id);
});

// P3(검증 라운드): 위 두 테스트는 dryRun을 항상 명시적으로 보낸다. 그래서
// 기본값 자체가 뒤집혀도(`!== "false"` -> `=== "true"`) 전체 스위트가 통과했다
// - 실측했다. 그 회귀의 결과는 "dryRun 필드를 빠뜨린 클라이언트가 실수로
// 실제 임포트를 실행하는 것"이라 조용하고 되돌리기 어렵다. 안전한 기본값은
// 그 자체로 계약이므로 따로 고정한다.
test("P3: dryRun 필드를 아예 보내지 않으면 dry-run으로 처리하고 DB에 쓰지 않는다", async () => {
  const token = await makeWriteKey();
  const buf = await buildXlsx("ID14Route Default");
  const form = new FormData();
  form.set("file", new File([buf], "t.xlsx"));
  // dryRun을 의도적으로 넣지 않는다.

  const res = await importPost(
    new Request("http://x/api/v1/import", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  );

  expect(res.status).toBe(200);
  const parsed = await res.json();
  expect(parsed.dryRun).toBe(true);

  const rows = await db.select().from(terms).where(eq(terms.nameEn, "ID14Route Default"));
  expect(rows).toEqual([]);
});

// R134(검증 라운드): route.ts 주석은 "Content-Length가 없거나 거짓이면
// file.size 검사가 두 번째 방어선"이라고 주장한다. 주장은 되돌리기 교란이
// 아니라 실제로 시도해서 확인한다 - 헤더 검사를 통과하는 요청으로 상한을
// 넘겨본다. (FormData 본문은 undici가 실제 크기로 content-length를 채우므로,
// 10MB를 살짝 넘는 파일은 헤더 검사(MAX_BYTES + 64KB 여유)를 통과해
// file.size 검사에 도달한다.)
test("R134: Content-Length 검사를 통과한 요청도 file.size가 10MB를 넘으면 413이다", async () => {
  const token = await makeWriteKey();
  const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
  const form = new FormData();
  form.set("file", new File([oversized], "big.xlsx"));
  form.set("dryRun", "true");

  const res = await importPost(
    new Request("http://x/api/v1/import", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  );

  expect(res.status).toBe(413);
  const parsed = await res.json();
  expect(parsed.error.code).toBe("payload_too_large");
});
