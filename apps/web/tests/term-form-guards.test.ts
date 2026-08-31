import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// R108: term-form.tsx는 "use client" Client Component라 vitest.config.ts에
// jsdom이 없는 이 저장소(R97)에서는 렌더/이벤트 테스트를 할 수 없다. 잠금
// 로직 자체(경고가 딸린 성공 저장 뒤 폼을 잠그고 제출 버튼을 링크로 바꿔
// 중복 생성 재제출을 막는 것)는 컴포넌트 내부 상태·JSX 조건부 렌더링이라
// interpretResponse처럼 순수 함수로 완전히 뽑아낼 수 없다.
//
// screen-guards.test.ts의 PROTO A/B/D와 동일한 전략을 쓴다 — 회귀가 소스
// 문자열 하나로 정확히 나타나는 지점을 골라 파일을 직접 읽어 검사한다.
// "untestable"이라고 넘기지 않고, 실제로 각 가드 문자열을 하나씩 지워서
// 이 테스트들이 깨지는지 먼저 확인했다(perturbation 기록 참고).

const testDir = path.dirname(fileURLToPath(import.meta.url));
const formPath = path.join(testDir, "..", "src", "components", "term-form.tsx");
const source = readFileSync(formPath, "utf8");

// screen-guards.test.ts의 stripComments와 동일한 이유: 이 파일 자신의 주석
// 안에 "router.push" 같은 판별 대상 문자열이 그대로 들어 있어서(설명하려고
// 인용했으므로), 주석을 지우지 않으면 깨끗한 트리에서도 오탐한다.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const code = stripComments(source);

test("vacuity 가드: term-form.tsx 소스를 실제로 읽었다", () => {
  expect(source.length).toBeGreaterThan(1000);
});

// R108 핵심 1: locked는 saving뿐 아니라 savedSlug !== null도 봐야 한다 —
// saving만 보면 저장이 끝나자마자(경고를 읽기도 전에) 다시 제출 가능해진다.
test("locked 계산에 savedSlug 조건이 포함된다 (R108)", () => {
  expect(/const\s+locked\s*=\s*saving\s*\|\|\s*renamingSlug\s*\|\|\s*savedSlug\s*!==\s*null/.test(code)).toBe(true);
});

// R108 핵심 2: onSubmit 맨 앞에서 locked 가드로 조기 반환해야 한다. 버튼이
// 이미 disabled/Link로 바뀌었더라도 Enter 키 등으로 submit 이벤트가 다시
// 뜨는 경로를 막는 두 번째 방어선이다.
test("onSubmit이 locked면 즉시 반환한다 (R108)", () => {
  expect(/if\s*\(\s*locked\s*\)\s*return\s*;/.test(code)).toBe(true);
});

// R108 핵심 3: 경고가 있는 성공 응답에서는 router.push로 곧장 넘어가지 않고
// savedSlug/warnings를 state에 채워야 한다 — 계획서 스케치는 여기서 무조건
// router.push해서 경고를 볼 새 없이 화면이 넘어갔다.
test("경고가 있는 성공 응답은 setSavedSlug/setWarnings로 처리되고 그 분기에서 router.push하지 않는다 (R108)", () => {
  const match = code.match(/outcome\.warnings\.length > 0\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}/);
  expect(match, "경고 분기 코드 블록을 찾지 못함").not.toBeNull();
  const [, warningBranch, successBranch] = match!;
  expect(warningBranch).toMatch(/setWarnings\(/);
  expect(warningBranch).toMatch(/setSavedSlug\(/);
  expect(warningBranch).not.toMatch(/router\.push/);
  // 경고가 없는 쪽(else)은 여전히 곧장 상세 화면으로 넘어가야 한다 —
  // 이 분기까지 잠기면 정상 흐름(경고 없는 저장)이 고장난다.
  expect(successBranch).toMatch(/router\.push/);
});

// R108 핵심 4: savedSlug가 채워지면 제출 버튼이 <Link>로 바뀌어야 한다 —
// disabled 처리만으로는 폼 필드는 잠기지만 버튼 자체가 여전히 제출 가능한
// <button type="submit">으로 남아있을 수 있다(별도 방어선).
test("savedSlug가 있으면 제출 버튼 대신 Link가 렌더된다 (R108)", () => {
  const buttonArea = code.slice(code.indexOf("{savedSlug ? ("));
  expect(buttonArea.indexOf("{savedSlug ? (")).toBe(0);
  const linkIdx = buttonArea.indexOf("<Link");
  const submitBtnIdx = buttonArea.indexOf('type="submit"');
  expect(linkIdx).toBeGreaterThan(-1);
  expect(submitBtnIdx).toBeGreaterThan(-1);
  expect(linkIdx).toBeLessThan(submitBtnIdx); // Link가 먼저(참 분기), submit 버튼은 else 분기
});

test("대표 표기와 추가 표기는 같은 이름 영역에서 관리 정보·본문보다 먼저 보인다", () => {
  const primaryNameIdx = code.indexOf('name="nameEn"');
  const surfacesIdx = code.indexOf(">추가 표기 <");
  const managementIdx = code.indexOf('title="관리 정보"');
  const bodyIdx = code.indexOf('label="용어 본문"');

  expect(primaryNameIdx).toBeGreaterThan(-1);
  expect(surfacesIdx).toBeGreaterThan(primaryNameIdx);
  expect(managementIdx).toBeGreaterThan(surfacesIdx);
  expect(bodyIdx).toBeGreaterThan(managementIdx);
});

test("수정 중인 폼은 저장하지 않은 변경사항의 이탈을 경고한다", () => {
  expect(code).toContain('window.addEventListener("beforeunload", warnBeforeUnload)');
  expect(code).toContain('document.addEventListener("click", warnBeforeLinkNavigation, true)');
  expect(code).toContain("저장하지 않은 변경사항이 있습니다");
});

test("용어 종류는 하나의 세그먼트 컨트롤 안에서 선택 상태를 강조한다", () => {
  expect(code).toContain('rounded-xl bg-panel-2 p-1');
  expect(code).toContain('peer-checked:bg-panel');
  expect(code).toContain('peer-checked:shadow-sm');
});

test("편집 폼은 slug를 별도 버튼으로 변경하고 새 편집 URL로 이동한다", () => {
  expect(code).toContain('name="slug"');
  expect(code).toContain('"URL 변경"');
  expect(code).toContain('body: JSON.stringify({ slug: slugDraft, expectedRevision: initial?.expectedRevision })');
  expect(code).toContain('router.replace(`/edit/${encodeURIComponent(nextSlug)}`)');
  expect(code).toContain('disabled={locked || dirty || !slugChanged || Boolean(slugDraftIssue)}');
});

// 자기검사: 위 정규식들이 "아무 소스에도 항상 참"인 식으로 무너지지
// 않았는지 - 관련 없는 임의 소스에서는 false여야 한다.
test("자기검사: 위 판별식들은 무관한 소스에서 false다", () => {
  const irrelevant = "const x = 1; function foo() { return 2; }";
  expect(/const\s+locked\s*=\s*saving\s*\|\|\s*renamingSlug\s*\|\|\s*savedSlug\s*!==\s*null/.test(irrelevant)).toBe(false);
  expect(/if\s*\(\s*locked\s*\)\s*return\s*;/.test(irrelevant)).toBe(false);
});
