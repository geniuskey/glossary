/**
 * 임포트 파일의 형식 계약 — 어떤 열 이름을 인정하고, 각 열이 무엇을 받는지.
 *
 * 파서(parse-xlsx.ts), 샘플 파일(template.ts), 화면 설명(import-guide.tsx)이
 * 전부 이 한 곳을 읽는다. 세 곳에 따로 적으면 "문서에는 있는데 파서는 모르는
 * 열"이 반드시 생긴다 — 그 순간 설명은 도움이 아니라 함정이 된다.
 *
 * R114와 같은 이유로 @glossary/db도 exceljs도 import하지 않는다. 이 모듈은
 * 서버 파서와 화면 컴포넌트 양쪽에서 읽히므로 어느 쪽 무거운 의존도 끌고
 * 들어오면 안 된다.
 */

export type ImportField =
  | "nameEn"
  | "nameKo"
  | "fullNameEn"
  | "fullNameKo"
  | "domain"
  | "category"
  | "topic"
  | "status"
  | "definitionMd"
  | "canonicalNames"
  | "abbreviations"
  | "aliases"
  | "discouragedNames"
  | "forbiddenNames";

/**
 * 헤더 비교 전 정규화. 대소문자와 공백만 흡수한다 — "Name EN", "name en",
 * "NAME_EN"이 같은 열이 되게 하되 그 이상은 추측하지 않는다.
 */
export function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "_");
}

/**
 * 표준 표기(nameEn/nameKo)는 "둘 중 하나"가 필수다 — 개별 열로 보면 둘 다
 * 선택이라 required: boolean으로는 이 규칙을 표현할 수 없다.
 */
export type ImportRequirement = "either-name" | "optional";

export const REQUIREMENT_LABEL: Record<ImportRequirement, string> = {
  "either-name": "둘 중 하나 필수",
  optional: "선택",
};

export interface ImportColumn {
  field: ImportField;
  /** 샘플 파일이 쓰는 대표 헤더(사람이 읽는 형태 — 공백을 그대로 둔다). */
  header: string;
  /** 대표 헤더 말고도 같은 열로 인정하는 헤더. 전부 정규화된 형태로 적는다. */
  otherHeaders: readonly string[];
  requirement: ImportRequirement;
  /** 이 열이 무엇을 받는지 한 줄 설명. 화면 설명표에 그대로 나간다. */
  hint: string;
  /** 샘플 파일의 열 너비(엑셀 문자 폭). */
  width: number;
}

/**
 * 배열 순서가 곧 샘플 파일의 열 순서다. 파서는 순서를 보지 않으므로(헤더
 * 이름으로만 찾는다) 여기 순서는 "사람이 채우기 좋은 순서"로만 정한다.
 *
 * otherHeaders의 영문 키(name_en 등)와 기존 한글 별칭은 이미 배포된 파일들이
 * 쓰고 있을 수 있어 하나도 빼지 않는다 — tests/import-format.test.ts가 옛
 * 헤더 목록을 그대로 고정한다.
 */
export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  {
    field: "nameEn",
    header: "영문",
    otherHeaders: ["name_en", "영문명", "english"],
    requirement: "either-name",
    hint: "목록과 제목에 쓸 대표 영문 표기. 한글과 둘 중 하나는 반드시 있어야 합니다.",
    width: 16,
  },
  {
    field: "nameKo",
    header: "한글",
    otherHeaders: ["name_ko", "한글명", "korean"],
    requirement: "either-name",
    hint: "목록과 제목에 쓸 대표 한글 표기. 영문과 둘 중 하나는 반드시 있어야 합니다.",
    width: 16,
  },
  {
    field: "fullNameEn",
    header: "영문 풀네임",
    otherHeaders: ["full_name_en", "풀네임", "전체명"],
    requirement: "optional",
    hint: "약어의 영문 원말. 예: AE → Auto Exposure",
    width: 22,
  },
  {
    field: "fullNameKo",
    header: "한글 풀네임",
    otherHeaders: ["full_name_ko"],
    requirement: "optional",
    hint: "약어의 한글 원말.",
    width: 22,
  },
  {
    field: "domain",
    header: "도메인",
    otherHeaders: ["domain"],
    requirement: "optional",
    hint: "쉼표로 여러 개. 예: ISP, HW",
    width: 16,
  },
  {
    field: "category",
    header: "업무 분류",
    otherHeaders: ["category", "분류"],
    requirement: "optional",
    hint: "제품·프로젝트·설계처럼 정해진 업무 분류 값 하나.",
    width: 18,
  },
  {
    field: "topic",
    header: "주제",
    otherHeaders: ["topic", "세부_주제"],
    requirement: "optional",
    hint: "자유 입력 세부 주제. 예: 노출 제어",
    width: 18,
  },
  {
    field: "status",
    header: "상태",
    otherHeaders: ["status"],
    requirement: "optional",
    hint: "정해진 값만 인정합니다. 비어 있거나 모르는 값이면 '초안'이 됩니다.",
    width: 12,
  },
  {
    field: "definitionMd",
    header: "한줄 정의",
    otherHeaders: ["definition", "정의", "설명"],
    requirement: "optional",
    hint: "설명 본문. 마크다운을 그대로 씁니다.",
    width: 40,
  },
  {
    field: "canonicalNames",
    header: "추가 표준 표기",
    otherHeaders: ["canonical_names", "추가_표준명"],
    requirement: "optional",
    hint: "대표 영문·한글 외에도 함께 쓰는 표준 표기. 쉼표나 줄바꿈으로 여러 개.",
    width: 22,
  },
  {
    field: "abbreviations",
    header: "약어",
    otherHeaders: ["abbreviations", "약어_표기"],
    requirement: "optional",
    hint: "같은 개념의 약어 표기. 쉼표나 줄바꿈으로 여러 개.",
    width: 18,
  },
  {
    field: "aliases",
    header: "별칭",
    otherHeaders: ["aliases", "약칭"],
    requirement: "optional",
    hint: "같은 개념을 가리키는 다른 표기. 쉼표나 줄바꿈으로 여러 개.",
    width: 24,
  },
  {
    field: "discouragedNames",
    header: "비권장 표기",
    otherHeaders: ["discouraged", "비권장"],
    requirement: "optional",
    hint: "가능하면 쓰지 않도록 안내할 표기. 쉼표나 줄바꿈으로 여러 개.",
    width: 22,
  },
  {
    field: "forbiddenNames",
    header: "금지 표기",
    otherHeaders: ["forbidden", "금지"],
    requirement: "optional",
    hint: "문서에서 사용하면 안 되는 표기. 쉼표나 줄바꿈으로 여러 개.",
    width: 22,
  },
];

/** 용어 편집 화면의 “추가 표기”와 직접 대응하는 가져오기 열. */
export const ADDITIONAL_SURFACE_FIELDS: readonly ImportField[] = [
  "canonicalNames",
  "fullNameEn",
  "fullNameKo",
  "abbreviations",
  "aliases",
  "discouragedNames",
  "forbiddenNames",
];

/** 정규화된 헤더 → 필드. 파서가 실제로 찾아보는 표다. */
export const HEADER_TO_FIELD: Record<string, ImportField> = Object.fromEntries(
  IMPORT_COLUMNS.flatMap((c) => [normalizeHeader(c.header), ...c.otherHeaders].map((h) => [h, c.field])),
);

/**
 * 샘플 파일에 들어가는 내용이자 화면 미리보기에 그려지는 내용. 한 곳에서
 * 읽어야 "내려받은 파일과 화면 설명이 다른" 일이 없다.
 *
 * 값을 고를 때 지킨 것: 행끼리 표기가 겹치지 않게 했다 — 겹치면 이 파일을
 * 그대로 검사만 돌려도 "파일 내 중복" 경고가 떠서, 처음 써 보는 사람이
 * 자기가 뭘 잘못했나 헤매게 된다.
 */
export const SAMPLE_ROWS: readonly Record<ImportField, string>[] = [
  {
    nameEn: "Auto Exposure",
    nameKo: "자동노출",
    fullNameEn: "",
    fullNameKo: "자동 노출 조절",
    domain: "ISP, HW",
    category: "design",
    topic: "노출 제어",
    status: "active",
    definitionMd: "장면 밝기에 맞춰 노출을 자동으로 맞추는 기능.",
    canonicalNames: "Automatic Exposure",
    abbreviations: "AE",
    aliases: "오토익스포저, 자동노출제어",
    discouragedNames: "오토 노출",
    forbiddenNames: "",
  },
  {
    nameEn: "Gain",
    nameKo: "게인",
    fullNameEn: "",
    fullNameKo: "",
    domain: "ISP",
    category: "design",
    topic: "신호 처리",
    status: "active",
    definitionMd: "센서가 받은 신호를 증폭하는 배율.",
    canonicalNames: "",
    abbreviations: "",
    aliases: "이득",
    discouragedNames: "",
    forbiddenNames: "",
  },
  {
    nameEn: "Nova",
    nameKo: "노바",
    fullNameEn: "Project Nova",
    fullNameKo: "노바 프로젝트",
    domain: "PM",
    category: "project",
    topic: "",
    status: "active",
    definitionMd: "차기 카메라 모듈 과제.",
    canonicalNames: "",
    abbreviations: "",
    aliases: "",
    discouragedNames: "",
    forbiddenNames: "",
  },
  {
    nameEn: "blocklist",
    nameKo: "차단 목록",
    fullNameEn: "",
    fullNameKo: "",
    domain: "",
    category: "other",
    topic: "포용적 표현",
    status: "active",
    definitionMd: "접근을 차단할 대상을 모은 목록.",
    canonicalNames: "",
    abbreviations: "",
    aliases: "",
    discouragedNames: "",
    forbiddenNames: "blacklist",
  },
];

/** 목록형 셀은 쉼표와 줄바꿈을 모두 받는다. 폼의 추가 표기 일괄 입력과 같다. */
export const LIST_SEPARATOR = ",";

/** R119: 한 번의 임포트 요청이 처리할 수 있는 최대 행 수. */
export const MAX_IMPORT_ROWS = 5000;

/** R119: 업로드 파일 크기 상한. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * 열 이름표로는 드러나지 않는 규칙들. 화면과 샘플 파일의 안내 시트가 같은
 * 문장을 쓰도록 여기 둔다 — 파일은 화면을 떠나 돌아다니므로 양쪽에 다 있어야
 * 하고, 따로 적으면 한쪽만 고쳐진다.
 */
export const IMPORT_RULES: readonly string[] = [
  "첫 번째 시트의 1행만 열 이름으로 읽습니다. 두 번째 시트부터는 보지 않습니다.",
  "열 순서는 상관없습니다. 이름이 맞는 열만 가져오고, 모르는 열은 무시한 뒤 검사 결과에 그대로 보여 줍니다.",
  "영문·한글 중 최소 하나는 있어야 합니다. 둘 다 비어 있으면 그 행은 건너뜁니다.",
  `도메인과 추가 표기는 쉼표(${LIST_SEPARATOR}) 또는 줄바꿈으로 여러 개를 적습니다.`,
  `한 번에 ${MAX_IMPORT_ROWS.toLocaleString("ko-KR")}행 · ${MAX_IMPORT_BYTES / 1024 / 1024}MB까지 올릴 수 있습니다.`,
  "이미 등록된 용어와 겹치거나 파일 안에서 중복인 행은 기본적으로 건너뜁니다 — 검사 결과에서 직접 골라야 등록됩니다.",
];

export const TEMPLATE_FILENAME = "glossary-import-sample.xlsx";

/** 샘플 파일을 내려받는 경로(app/import/template/route.ts). */
export const TEMPLATE_HREF = "/import/template";
