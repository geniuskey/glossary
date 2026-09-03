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
const helpTipPath = path.join(testDir, "..", "src", "components", "help-tip.tsx");
const classificationSelectPath = path.join(testDir, "..", "src", "components", "classification-multi-select.tsx");
const source = readFileSync(formPath, "utf8");
const helpTipSource = readFileSync(helpTipPath, "utf8");
const classificationSelectSource = readFileSync(classificationSelectPath, "utf8");

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
  expect(/const\s+locked\s*=\s*saving\s*\|\|\s*deleting\s*\|\|\s*renamingSlug\s*\|\|\s*savedSlug\s*!==\s*null/.test(code)).toBe(true);
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

test("넓은 편집 화면은 관리 정보를 왼쪽에 두고 공개 상태에 시트와 같은 색상 토큰을 쓴다", () => {
  expect(code).toContain('lg:grid-cols-[18rem_minmax(0,1fr)]');
  expect(code).toContain('className="card lg:order-1 lg:sticky lg:top-16"');
  expect(code).toContain('className="card lg:order-2"');
  expect(code).toContain('STATUS_TONE[form.status]');
});

test("대표 표기 도움말은 대표 영문 용어 필드 라벨 바로 옆에 둔다", () => {
  const nameEnArea = code.slice(code.indexOf('<FormTextField\n                name="nameEn"'), code.indexOf('<FormTextField\n                name="nameKo"'));
  expect(nameEnArea).toContain("hint={labels.primaryHint}");
  expect(code).not.toContain('<div className="flex justify-end sm:col-span-2"><HelpTip text={labels.primaryHint} /></div>');
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

test("추가 표기는 일괄 등록 후 모든 종류 영역이 있는 공통 보드에 배지로 표시한다", () => {
  expect(code).toContain('name="surfaceBatch"');
  expect(code).toContain("parseSurfaceBatch(surfaceBatch)");
  expect(code).toContain("EXPLICIT_SURFACE_KINDS.map((kind) =>");
  expect(code).not.toContain("여기로 드래그");
  expect(code).toContain("formWithPendingSurfaces");
});

test("표기 빠른 추가는 입력·종류·버튼을 한 줄 도구로 표시한다", () => {
  expect(code).toContain('className="flex flex-col gap-2 sm:flex-row sm:items-center"');
  expect(code).toContain('className="field h-8 min-w-0 flex-1 py-0"');
  expect(code).toContain('className="field h-8 py-0 sm:w-32"');
  expect(code).not.toContain('<textarea\n                  id="surface-batch"');
});

test("상시 설명은 물음표 도움말로 대체하고 hover와 keyboard focus에서 표시한다", () => {
  expect(code).toContain('import { HelpTip } from "@/components/help-tip"');
  expect(helpTipSource).toContain("function HelpTip");
  expect(helpTipSource).toContain('aria-label={`도움말: ${text}`}');
  expect(helpTipSource).toContain('role="tooltip"');
  expect(helpTipSource).toContain("group-hover:opacity-100");
  expect(helpTipSource).toContain("group-focus-within:opacity-100");
  expect(code).not.toContain('<p className={compact ? "text-[11px] text-ink-3"');
});

test("6개 표기 영역은 가로 흐름을 유지하다 공간이 부족하면 다음 줄로 넘어간다", () => {
  expect(code).toContain('className="flex flex-wrap items-stretch gap-1.5"');
  expect(code).toContain("w-max min-w-28 max-w-80 flex-none");
  expect(code).not.toContain('className="mt-2 overflow-x-auto rounded-xl');
  expect(code).not.toContain("min-h-24 min-w-0 rounded-lg");
});

test("표기 배지는 언어별 색상을 사용하고 언어 텍스트는 내부에 표시하지 않는다", () => {
  expect(code).toContain("const SURFACE_LANGUAGE_STYLE");
  expect(code).toContain('ko: "border-brand/40 bg-brand-soft text-brand"');
  expect(code).toContain('en: "border-info/40 bg-info-soft text-info"');
  expect(code).toContain('neutral: "border-warn/40 bg-warn-soft text-warn"');
  expect(code).toContain("SURFACE_LANGUAGE_STYLE[language]");
  expect(code).not.toContain('<span className="shrink-0 text-[10px] opacity-70">');
  expect(code).toContain('aria-label="표기 언어 색상"');
});

test("추가 표기 배지 전체를 드래그하고 우클릭 메뉴에서 옵션을 바꿀 수 있다", () => {
  expect(code).toContain("handleSurfaceDragStart");
  expect(code).toContain("handleSurfaceDrop");
  expect(code).toContain("draggable={!locked}");
  expect(code).toContain("handleSurfaceContextMenu");
  expect(code).toContain('role="menu"');
  expect(code).toContain('role="menuitemradio"');
  expect(code).toContain("group-hover:opacity-100");
  expect(code).toContain('aria-live="polite"');
});

test("표기 언어는 직접 선택하지 않고 문자열로 자동 판정한다", () => {
  expect(code).toContain("inferSurfaceLang(text)");
  expect(code).not.toContain("surfaceBatchLang");
  expect(code).not.toContain("추가할 표기의 언어");
  expect(code).not.toContain("SURFACE_LANGS.map((lang)");
});

test("드래그 중 소스를 비활성화하지 않고 동기 ref로 드롭을 허용한다", () => {
  expect(code).toContain("const draggedSurfaceIndexRef = useRef<number | null>(null)");
  expect(code).toContain("draggedSurfaceIndexRef.current = index");
  expect(code).toContain("draggedSurfaceIndexRef.current === null");
  expect(code).not.toContain("inert={draggedSurfaceIndex === index");
});

test("편집 폼은 slug를 별도 버튼으로 변경하고 새 편집 URL로 이동한다", () => {
  expect(code).toContain('name="slug"');
  expect(code).toContain('"URL 변경"');
  expect(code).toContain('body: JSON.stringify({ slug: slugDraft, expectedRevision: initial?.expectedRevision })');
  expect(code).toContain('router.replace(`/edit/${encodeURIComponent(nextSlug)}`)');
  expect(code).toContain('disabled={locked || dirty || !slugChanged || Boolean(slugDraftIssue)}');
});

test("편집 화면은 밀도 높은 레이아웃과 접힌 URL 변경 영역을 사용한다", () => {
  expect(code).toContain("const compact = editSlug !== undefined");
  expect(code).toContain('<details className="rounded-lg border border-line bg-panel-2/35">');
  expect(code).toContain("rows={compact ? 2 : 3}");
  expect(code).toContain("compact={compact}");
});

test("관리자 편집 폼은 확인 후 DELETE 요청을 보내는 삭제 버튼을 제공한다", () => {
  expect(code).toContain("canDelete = false");
  expect(code).toContain("window.confirm");
  expect(code).toContain('method: "DELETE"');
  expect(code).toContain('router.replace("/sheet")');
  expect(code).toContain('className="btn-danger"');
  expect(code).toContain("editSlug !== undefined && canDelete");
});

test("도메인과 업무 분류는 같은 검색형 멀티 셀렉트를 쓰고 미등록 값은 분류 체계로 안내한다", () => {
  expect(code.match(/<ClassificationMultiSelect/g)).toHaveLength(2);
  expect(classificationSelectSource).toContain('role="combobox"');
  expect(classificationSelectSource).toContain('aria-multiselectable="true"');
  expect(classificationSelectSource).toContain("createPortal(");
  expect(classificationSelectSource).toContain("분류 체계에서 추가");
  expect(classificationSelectSource).toContain('target="_blank"');
  expect(classificationSelectSource).toContain('window.addEventListener("focus", onWindowFocus)');
});

// 자기검사: 위 정규식들이 "아무 소스에도 항상 참"인 식으로 무너지지
// 않았는지 - 관련 없는 임의 소스에서는 false여야 한다.
test("자기검사: 위 판별식들은 무관한 소스에서 false다", () => {
  const irrelevant = "const x = 1; function foo() { return 2; }";
  expect(/const\s+locked\s*=\s*saving\s*\|\|\s*deleting\s*\|\|\s*renamingSlug\s*\|\|\s*savedSlug\s*!==\s*null/.test(irrelevant)).toBe(false);
  expect(/if\s*\(\s*locked\s*\)\s*return\s*;/.test(irrelevant)).toBe(false);
});
