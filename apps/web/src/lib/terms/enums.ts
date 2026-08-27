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

export const TERM_STATUSES = ["draft", "approved", "deprecated", "forbidden"] as const;

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
  approved: "승인됨",
  deprecated: "폐기됨",
  forbidden: "금지어",
};

export const SURFACE_KIND_LABEL: Record<ExplicitSurfaceKindLiteral, string> = {
  abbreviation: "약어",
  full_name: "풀네임",
  alias: "별칭",
  discouraged: "비권장",
  forbidden: "금지",
};
