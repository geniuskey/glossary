import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// F6(review §2 Q1): R97 때문에 /sheet 화면 자체는 jsdom/RTL 없이 렌더
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

test("테마 초기화 스크립트는 클라이언트 재렌더링에서 실행되지 않는다", () => {
  const layout = readFileSync(path.join(appDir, "layout.tsx"), "utf8");
  const helper = readFileSync(path.join(componentsDir, "inline-script.tsx"), "utf8");

  expect(layout).toContain("<InlineScript html={THEME_SCRIPT} />");
  expect(layout).not.toMatch(/<script\s+dangerouslySetInnerHTML/);
  expect(helper.startsWith('"use client";')).toBe(true);
  expect(helper).toContain('typeof window === "undefined" ? "text/javascript" : "text/plain"');
  expect(helper).toContain("suppressHydrationWarning");
});

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
//
// 줄 맨 앞(들여쓰기 제외)에서 시작하는 `//`만 지운다. 처음에는 `//`가 어디에
// 나오든 그 뒤를 다 지웠는데, 그러면 문자열 리터럴 안의 `//`까지 주석으로
// 보고 같은 줄 뒷부분을 통째로 날려 실제 위반을 가린다 — 수정 라운드 검증
// P4에서 `<Link title="https://x" href="/api/v1/auth/logout">`가 정확히 그렇게
// 빠져나갔다(exit 0). 이 저장소의 주석은 전부 줄 단위라 이 좁힘으로 충분하다.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// PROTO A: src/app·src/components의 .tsx 어디에도 /api/로 직접 향하는
// href/action이 없다 — R95(보안 불변식)가 걸린 CSRF 방어의 전부다.
//
// href만 보면 안 된다. `<form action="/api/...">`는 method를 생략하면 GET이라
// 링크와 정확히 같은 CSRF 벡터인데, href만 검사하던 판은 이걸 통째로 놓쳤다
// (수정 라운드 검증 P3: exit 0). 중괄호 표현식 `href={"/api/..."}`도 마찬가지로
// 빠져나갔다(P2). 두 경우를 모두 덮도록 속성 이름과 `{`를 함께 허용한다.
const API_ATTR = /(?:href|action)\s*=\s*\{?\s*["'`]\/api\//;

test("PROTO A: src/app·src/components의 .tsx에 /api/로 향하는 href/action이 하나도 없다 (R95)", () => {
  const files = [...walk(appDir, (n) => n.endsWith(".tsx")), ...walk(componentsDir, (n) => n.endsWith(".tsx"))];
  expect(files.length).toBeGreaterThan(0); // vacuity 가드

  const offenders = files.filter((f) => API_ATTR.test(stripComments(readFileSync(f, "utf8"))));
  expect(offenders).toEqual([]);
});

// PROTO A의 자기검사: 위 정규식이 실제로 세 형태를 모두 잡는지 확인한다.
// 정규식이 조용히 아무것도 못 잡게 바뀌어도 위 테스트는 깨끗한 트리에서
// 그대로 통과하므로(빈 offenders), 판별식 자체를 따로 단언해야 한다.
test("PROTO A 자기검사: href/action·중괄호·문자열 속 // 세 형태를 모두 잡는다", () => {
  expect(API_ATTR.test(stripComments('<a href="/api/v1/auth/logout">x</a>'))).toBe(true);
  expect(API_ATTR.test(stripComments('<Link href={"/api/v1/auth/logout"}>x</Link>'))).toBe(true);
  expect(API_ATTR.test(stripComments('<form action="/api/v1/auth/logout" />'))).toBe(true);
  expect(API_ATTR.test(stripComments('<a title="https://x" href="/api/v1/auth/logout">x</a>'))).toBe(true);
  // 줄 앞 주석은 여전히 지워진다(logout-button.tsx:6이 깨끗한 트리를 통과하는 이유).
  expect(API_ATTR.test(stripComments('// `<Link href="/api/v1/auth/logout">` 같은 GET'))).toBe(false);
  // 내부 화면 링크는 위반이 아니다.
  expect(API_ATTR.test(stripComments('<Link href="/new">새 용어</Link>'))).toBe(false);
});

// PROTO B: 허용목록 밖의 모든 page.tsx는 getCurrentUser(와 redirect("/login")를
// 모두 포함한다. getCurrentUser(만 검사하면 "호출은 남기고 redirect만 지우는"
// 회귀(R3/R6)를 못 잡는다 — 반드시 두 토큰을 함께 요구해야 한다.
// R135: app/page.tsx는 더 이상 예외가 아니다. 예전에는 무조건 /terms로
// redirect하는 한 줄이라 인증 게이트가 그 화면 몫이었지만, 이제 홈이 직접 DB를
// 읽어 검색 결과를 그리는 화면이라 게이트가 여기 있어야 한다.
const PROTO_B_ALLOWLIST = new Set<string>([
  path.join("setup", "page.tsx"), // 최초 설정 화면 — 아직 계정이 없을 때만 열린다(needsSetup으로 스스로 막는다).
  path.join("login", "page.tsx"), // 로그인 화면 자신 — 인증 게이트의 대상이 아니다.
  // R131: 가입 화면 — 로그인하지 않은 사람을 위한 화면이라 인증 게이트를 걸 수 없다.
  // 계정이 하나도 없을 때는 스스로 /setup으로 보낸다.
  path.join("signup", "page.tsx"),
  // iframe 안에서는 로그인 화면 자체가 frame-ancestors로 막히므로, 새 창 로그인
  // 안내를 자체 렌더링한다. getCurrentUser로 보호되는 읽기 전용 화면이다.
  path.join("embed", "page.tsx"),
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

test("관리자 화면은 사용자 목록을 읽기 전에 관리자 역할을 확인한다", () => {
  const content = stripComments(readFileSync(path.join(appDir, "admin", "page.tsx"), "utf8"));
  const roleGuard = content.indexOf('if (user.role !== "admin") redirect("/")');
  const userQuery = content.indexOf("listManagedUsers()");
  expect(roleGuard).toBeGreaterThan(-1);
  expect(userQuery).toBeGreaterThan(roleGuard);
});

// PROTO D: 로그아웃 요청은 반드시 POST다(logout.ts:22의 문자열 검사 —
// 동작 버전 검증은 tests/logout.test.ts가 fetch mock 호출 인자로 한다).
test("PROTO D: 로그아웃 fetch는 method: \"POST\"다 (R95)", () => {
  const content = readFileSync(path.join(srcDir, "lib", "auth", "logout.ts"), "utf8");
  expect(
    /\w+\(\s*["'`]\/api\/v1\/auth\/logout["'`]\s*,\s*\{\s*method:\s*["'`]POST["'`]\s*\}\s*\)/.test(content),
  ).toBe(true);
});

// PROTO E: 클릭 한 번으로 셀 편집기를 여는 자리에는 e.preventDefault()가 반드시
// 있어야 한다. 셀(td)은 tabIndex=-1이라 mousedown의 기본 동작이 그 칸으로
// 포커스를 옮기는데, 그러면 방금 뜬 편집기가 곧바로 blur돼서 종류·상태 목록이
// 열리는 즉시 닫힌다 — 실제로 그렇게 한 번 나갔다.
//
// 더블클릭 경로만 보면 멀쩡해 보인다는 게 이 회귀의 핵심이다(dblclick에는
// 포커스 기본 동작이 없다). 순수 모듈 테스트로는 잡을 수 없고 렌더 테스트도
// 없으므로, 소스 문자열 하나로 고정한다.
const CLICK_TO_EDIT =
  /if\s*\(\s*!e\.shiftKey\s*&&\s*opensOnClick\(col\)\s*\)\s*\{\s*e\.preventDefault\(\)\s*;\s*beginEdit\(/;

test("PROTO E: 클릭으로 여는 셀 편집기는 mousedown 기본 동작을 막는다", () => {
  const content = stripComments(readFileSync(path.join(componentsDir, "terms-grid.tsx"), "utf8"));
  expect(CLICK_TO_EDIT.test(content)).toBe(true);
});

test("PROTO E 자기검사: preventDefault가 빠진 형태는 통과하지 않는다", () => {
  expect(CLICK_TO_EDIT.test("if (!e.shiftKey && opensOnClick(col)) { beginEdit(r, c); }")).toBe(false);
  expect(CLICK_TO_EDIT.test("if (!e.shiftKey && opensOnClick(col)) {\n e.preventDefault();\n beginEdit(r, c); }")).toBe(
    true,
  );
});

// PROTO F: 메뉴를 닫는 document mousedown 처리기는 메뉴 안에서 시작한 클릭을
// 반드시 걸러야 한다. 무조건 닫으면 mouseup 전에 항목이 DOM에서 사라져
// click도 change도 발생하지 않는다 — 열 체크박스를 눌러도 아무 일이 없던
// R133 회귀가 정확히 이것이었다. 메뉴가 열리는 것까지는 멀쩡해 보여서
// 눈으로도, 순수 함수 테스트로도 잡히지 않는다.
const MENU_CLOSE_GUARD = /closest\(\s*["'`]\[data-menu-root\]["'`]\s*\)\s*\)\s*return/;

test("PROTO F: 메뉴 바깥 클릭 판정은 [data-menu-root] 안을 제외한다 (R133)", () => {
  const content = stripComments(readFileSync(path.join(componentsDir, "terms-grid.tsx"), "utf8"));
  expect(MENU_CLOSE_GUARD.test(content)).toBe(true);
  // 판정만 있고 표식이 없으면 모든 메뉴가 바깥 취급을 받는다. 선택자 1개 +
  // 툴바 메뉴 + 머리글 우클릭 메뉴.
  expect((content.match(/data-menu-root/g) ?? []).length).toBeGreaterThanOrEqual(3);
});

test("PROTO F 자기검사: 무조건 닫는 형태는 통과하지 않는다", () => {
  expect(MENU_CLOSE_GUARD.test("const close = () => setMenu(null);")).toBe(false);
  expect(
    MENU_CLOSE_GUARD.test('if (event.target instanceof Element && event.target.closest("[data-menu-root]")) return;'),
  ).toBe(true);
});

// PROTO G: 붙여넣기 핸들러가 찾는 표식(data-draft-row)과 JSX가 다는 표식은
// 손으로 맞춰 둔 두 곳이다. 표식이 사라지면 "+" 줄에 붙여넣어도 새 행이 생기지
// 않고(입력칸으로 취급해 그냥 통과시킨다), 화면에는 아무 오류도 나오지 않는다.
test("PROTO G: '+' 줄 붙여넣기 표식이 핸들러와 JSX 양쪽에 있다 (R134)", () => {
  const content = stripComments(readFileSync(path.join(componentsDir, "terms-grid.tsx"), "utf8"));

  expect(/closest\(\s*["'`]\[data-draft-row\]["'`]\s*\)/.test(content)).toBe(true);
  expect(/<td\s+data-draft-row/.test(content)).toBe(true);
  // 새 행은 POST로 만들어진다 — 계획만 세우고 보내지 않으면 표에만 잠깐 보였다
  // 사라진다.
  expect(/fetch\(\s*["'`]\/api\/v1\/terms["'`]/.test(content)).toBe(true);
});

// PROTO H: 검색창 자동완성 드롭다운(R136). 이 목록이 조용히 죽는 방식은 두
// 가지이고, 둘 다 "열리는 것까지는 멀쩡해 보인다"라 눈으로 잡히지 않는다.
//
//  (1) 목록의 mousedown 기본 동작을 막지 않으면 포커스가 입력창을 떠나 onBlur가
//      목록을 지우고, click은 사라진 노드에 도착한다 — 눌러도 아무 일이 없다
//      (PROTO E/F와 같은 계열의 R133 회귀).
//  (2) 조합 중(한글 입력) Enter를 걸러내지 않으면 글자를 확정하려는 Enter가
//      후보 선택으로 잡혀 엉뚱한 용어로 이동한다. 영문 입력으로만 확인하면
//      끝까지 보이지 않는다.
const SUGGEST_LIST_MOUSEDOWN = /role="listbox"[\s\S]{0,400}?onMouseDown=\{\s*\(e\)\s*=>\s*e\.preventDefault\(\)\s*\}/;
const COMPOSING_GUARD = /if\s*\(\s*e\.nativeEvent\.isComposing\s*\)\s*return/;

test("PROTO H: 자동완성 목록은 mousedown 기본 동작을 막고, 조합 중 Enter를 걸러낸다 (R136)", () => {
  const content = stripComments(readFileSync(path.join(componentsDir, "search-box.tsx"), "utf8"));

  expect(SUGGEST_LIST_MOUSEDOWN.test(content)).toBe(true);
  expect(COMPOSING_GUARD.test(content)).toBe(true);

  // 드롭다운이 부르는 주소와 실제 라우트 파일은 손으로 맞춰 둔 두 곳이다.
  // 어긋나면 404가 나지만 fetch 실패는 조용히 삼켜지므로(자동완성은 부가
  // 기능이다) 화면에는 "후보가 없음"으로만 보인다.
  const url = content.match(/fetch\(\s*`(\/api\/v1\/[^?`]+)/);
  expect(url).not.toBeNull();
  const routeFile = path.join(appDir, "api", ...url![1]!.split("/").filter(Boolean).slice(1), "route.ts");
  expect(existsSync(routeFile), `${routeFile} 없음`).toBe(true);
});

test("PROTO H 자기검사: 가드가 빠진 형태는 통과하지 않는다", () => {
  expect(SUGGEST_LIST_MOUSEDOWN.test('<ul role="listbox" className="card">')).toBe(false);
  expect(
    SUGGEST_LIST_MOUSEDOWN.test('<ul role="listbox"\n  onMouseDown={(e) => e.preventDefault()}\n>'),
  ).toBe(true);
  expect(COMPOSING_GUARD.test("if (e.key === \"Enter\") select();")).toBe(false);
  expect(COMPOSING_GUARD.test("if (e.nativeEvent.isComposing) return;")).toBe(true);
});
