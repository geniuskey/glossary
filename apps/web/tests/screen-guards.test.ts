import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// F6(review §2 Q1): R97 때문에 /terms 화면 자체는 jsdom/RTL 없이 렌더
// 테스트를 하지 않지만("구현을 지워도 통과하는 테스트는 없느니만 못하다"가
// 렌더 테스트 부재를 정당화하지는 않는다), 아래 세 가지는 회귀가 정확히
// 소스 문자열 하나로 나타나는 종류라 파일을 읽는 것만으로 의미 있게
// 검증된다(프로토타입을 깨끗한 트리 통과 + 실제 회귀 재현 둘 다로 확인함,
// review §2 Q1). R96/R98의 구조 테스트는 "값이 화면에 있는가"를 grep이
// 보증하지 못해 거짓 안심을 주므로 여기 포함하지 않는다(review 판단 그대로).

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(testDir, "..", "src");
const appDir = path.join(srcDir, "app");
const componentsDir = path.join(srcDir, "components");

function walk(dir: string, filter: (name: string) => boolean, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, acc);
    else if (filter(entry.name)) acc.push(full);
  }
  return acc;
}

// PROTO A는 주석을 먼저 제거해야 한다 — logout-button.tsx의 주석 안에 정확히
// `<Link href="/api/v1/auth/logout">` 문자열이 그대로 들어 있어서, 주석을
// 지우지 않은 단순 grep은 깨끗한 트리에서도 실패한다.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// PROTO A: src/app·src/components의 .tsx 어디에도 상태를 바꾸는 GET 링크
// (href="/api/...")가 없다 — R95(보안 불변식)가 걸린 CSRF 방어의 전부다.
test("PROTO A: src/app·src/components의 .tsx에 href=\"/api/...\"가 하나도 없다 (R95)", () => {
  const files = [...walk(appDir, (n) => n.endsWith(".tsx")), ...walk(componentsDir, (n) => n.endsWith(".tsx"))];
  expect(files.length).toBeGreaterThan(0); // vacuity 가드

  const offenders = files.filter((f) => /href\s*=\s*["'`]\/api\//.test(stripComments(readFileSync(f, "utf8"))));
  expect(offenders).toEqual([]);
});

// PROTO B: 허용목록 밖의 모든 page.tsx는 getCurrentUser(와 redirect("/login")를
// 모두 포함한다. getCurrentUser(만 검사하면 "호출은 남기고 redirect만 지우는"
// 회귀(R3/R6)를 못 잡는다 — 반드시 두 토큰을 함께 요구해야 한다.
const PROTO_B_ALLOWLIST = new Set<string>([
  "page.tsx", // app/page.tsx: 무조건 /terms로 redirect한다 — 인증 게이트는 그 화면 몫이다.
  path.join("login", "page.tsx"), // 로그인 화면 자신 — 인증 게이트의 대상이 아니다.
  path.join("settings", "api-keys", "page.tsx"), // Task 8 산물, "use client" 전용. 호출하는 /api/v1/keys*가 requireAuth로 막혀 있어 데이터 유출은 아니다(review §2 Q1).
]);

test('PROTO B: 허용목록 밖의 모든 page.tsx는 getCurrentUser(와 redirect("/login")를 모두 포함한다 (R3/R6)', () => {
  const pages = walk(appDir, (n) => n === "page.tsx");
  const checked = pages.filter((f) => !PROTO_B_ALLOWLIST.has(path.relative(appDir, f)));
  expect(checked.length).toBeGreaterThan(0); // vacuity 가드

  for (const f of checked) {
    const content = readFileSync(f, "utf8");
    expect(content.includes("getCurrentUser("), `${f}: getCurrentUser( 없음`).toBe(true);
    expect(content.includes('redirect("/login")'), `${f}: redirect("/login") 없음`).toBe(true);
  }
});

// PROTO D: 로그아웃 요청은 반드시 POST다(logout.ts:22의 문자열 검사 —
// 동작 버전 검증은 tests/logout.test.ts가 fetch mock 호출 인자로 한다).
test("PROTO D: 로그아웃 fetch는 method: \"POST\"다 (R95)", () => {
  const content = readFileSync(path.join(srcDir, "lib", "auth", "logout.ts"), "utf8");
  expect(
    /\w+\(\s*["'`]\/api\/v1\/auth\/logout["'`]\s*,\s*\{\s*method:\s*["'`]POST["'`]\s*\}\s*\)/.test(content),
  ).toBe(true);
});
