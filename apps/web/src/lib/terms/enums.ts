// R114: 이 파일은 Client Component(term-form.tsx)에서 import된다. @grossary/db를
// 거기서 직접 import하면 drizzle-orm과 postgres.js가 클라이언트 번들에 딸려온다
// (서버 전용 패키지가 브라우저로 새는 것 — 빌드는 되지만 번들 크기와 잠재적
// 비밀 노출 양쪽으로 나쁘다). 그래서 DB pgEnum과 별개로 리터럴 배열을 여기 둔다.
//
// 드리프트 방지: 이 배열들이 실제 DB enum(packages/db/src/schema/terms.ts)과
// 어긋나면 폼이 존재하지 않는 값을 보내 400을 받거나, 실제로 존재하는 값을
// 선택지에서 빠뜨린다. tests/terms-enums.test.ts가 termTypeEnum.enumValues 등과
// 이 배열들의 정확한 일치를 구조 테스트로 고정한다.
export const TERM_TYPES = ["term", "abbreviation", "project", "product_id", "code", "unit"] as const;

export const TERM_STATUSES = ["draft", "active", "deprecated", "forbidden"] as const;

// canonical은 표준 이름 필드(nameEn/nameKo)에서만 파생되는 kind다 — 사용자가
// "명시 표기"로 직접 고를 수 있는 kind 목록에는 의도적으로 포함하지 않는다
// (deriveSurfaces가 이미 다루므로, 폼에서 canonical을 고르게 두면 파생 표기와
// 명시 표기가 같은 정규화 키에서 충돌해 R45의 checkSurfaceConflicts가 400을
// 던진다).
export const EXPLICIT_SURFACE_KINDS = ["abbreviation", "full_name", "alias", "discouraged", "forbidden"] as const;

export const SURFACE_LANGS = ["en", "ko", "neutral"] as const;

export type TermTypeLiteral = (typeof TERM_TYPES)[number];
export type TermStatusLiteral = (typeof TERM_STATUSES)[number];
export type ExplicitSurfaceKindLiteral = (typeof EXPLICIT_SURFACE_KINDS)[number];
// DB의 surface_kind 전체. canonical은 사용자가 고르지 못할 뿐, 조회 결과에는
// 그대로 나온다(표준명으로 검색이 맞으면 kind가 canonical이다) — 그래서 읽는
// 쪽 타입에는 필요하다. 위 배열이 terms-enums.test.ts로 DB enum에 묶여 있으므로
// 이 합집합도 함께 묶인다.
export type SurfaceKindLiteral = "canonical" | ExplicitSurfaceKindLiteral;
export type SurfaceLangLiteral = (typeof SURFACE_LANGS)[number];

export const TERM_TYPE_LABEL: Record<TermTypeLiteral, string> = {
  term: "일반 용어",
  abbreviation: "약어",
  project: "프로젝트명",
  product_id: "제품 ID",
  code: "코드",
  unit: "단위",
};

export const TERM_STATUS_LABEL: Record<TermStatusLiteral, string> = {
  draft: "초안",
  active: "공개 · 사용",
  deprecated: "폐기됨",
  forbidden: "금지어",
};

export const TERM_STATUS_HINT: Record<TermStatusLiteral, string> = {
  draft: "함께 작성 중인 상태입니다. 시트와 공동 정리함에는 보이지만 기본 검색과 AI 조회에서는 제외됩니다.",
  active: "팀원이 검색하고 문서나 AI 조회에서 바로 사용할 수 있습니다.",
  deprecated: "이전에는 썼지만 이제 사용하지 않는 용어입니다.",
  forbidden: "문서에서 사용하면 안 되는 표현입니다.",
};

export const SURFACE_KIND_LABEL: Record<ExplicitSurfaceKindLiteral, string> = {
  abbreviation: "약어",
  full_name: "풀네임",
  alias: "별칭",
  discouraged: "비권장",
  forbidden: "금지",
};
