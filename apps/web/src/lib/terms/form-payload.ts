import type { BusinessCategoryLiteral, TermStatusLiteral } from "./enums";
import { inferSurfaceLang } from "./surface-language";
import type { TermQualityProfile } from "@/lib/workspace/term-quality-values";

// R116: term-form.tsx는 Client Component라 vitest.config.ts에 jsdom 환경이 없는
// 이 저장소(R97)에서는 렌더 테스트를 할 수 없다. logout.ts/list-params.ts와
// 같은 패턴으로, "무엇을 보낼지" 계산하는 부분을 순수 함수로 뽑아서 폼 상태
// 객체를 직접 넣고 결과를 단언하는 방식으로 테스트한다.

export interface SurfaceDraft {
  text: string;
  lang: string;
  kind: string;
}

export interface TermFormState {
  qualityProfile: TermQualityProfile;
  nameEn: string;
  nameKo: string;
  fullNameEn: string;
  fullNameKo: string;
  domain: string;
  category: string;
  topic: string;
  ownerId: string;
  status: TermStatusLiteral;
  definitionMd: string;
  bodyMd: string;
  surfaces: SurfaceDraft[];
}

export interface TermWritePayload {
  qualityProfile: TermQualityProfile;
  nameEn?: string;
  nameKo?: string;
  fullNameEn?: string;
  fullNameKo?: string;
  domain: string[];
  category: BusinessCategoryLiteral[];
  topic: string | null;
  ownerId: string | null;
  definitionMd?: string;
  bodyMd?: string;
  surfaces: SurfaceDraft[];
  expectedRevision?: number;
}

/** 새 용어 폼의 기본값. 검색어가 있으면 기존 표기 언어 규칙에 따라 대표 이름에 넣는다. */
export function newTermFormState(searchQuery = ""): TermFormState {
  const name = searchQuery.trim();
  const nameKo = inferSurfaceLang(name) === "ko" ? name : "";
  return {
    qualityProfile: "auto",
    nameEn: nameKo ? "" : name,
    nameKo,
    fullNameEn: "",
    fullNameKo: "",
    domain: "",
    category: "",
    topic: "",
    ownerId: "",
    status: "draft",
    definitionMd: "",
    bodyMd: "",
    surfaces: [],
  };
}

/** 쉼표나 줄바꿈으로 빠르게 입력한 추가 표기를 빈 값·중복 없이 정리한다. */
export function parseSurfaceBatch(input: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const raw of input.split(/[,\n]+/)) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }

  return values;
}

/**
 * 폼 상태를 API 요청 바디로 변환한다.
 * - 빈 문자열(공백만 포함해도) 필드는 undefined로 보낸다 — 서버 스키마가
 *   `.optional()`이지 빈 문자열을 허용하는 게 아니라서, 빈 문자열을 그대로
 *   보내면 zod min(1)에 걸려 400이 난다(schema.ts의 nameEn/nameKo 등).
 * - domain은 쉼표로 구분된 자유 텍스트 입력을 배열로 쪼갠다. 빈 조각은 버린다.
 * - 공백뿐인 표기(text)는 제거한다 — 서버가 어차피 거부하므로(R46) 클라이언트가
 *   먼저 걸러 헛된 왕복을 줄인다.
 * - R109: expectedRevision은 편집 모드에서만 호출자가 넘긴다(undefined면 아예
 *   페이로드에 키 자체가 없다 — 생성 요청에는 이 필드가 존재해서도 안 된다).
 */
export function buildTermPayload(form: TermFormState, expectedRevision?: number): TermWritePayload {
  const payload: TermWritePayload = {
    qualityProfile: form.qualityProfile,
    nameEn: form.nameEn.trim() || undefined,
    nameKo: form.nameKo.trim() || undefined,
    fullNameEn: form.fullNameEn.trim() || undefined,
    fullNameKo: form.fullNameKo.trim() || undefined,
    domain: form.domain
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    category: form.category
      .split(",")
      .map((category) => category.trim())
      .filter(Boolean) as BusinessCategoryLiteral[],
    topic: form.topic.trim() || null,
    ownerId: form.ownerId || null,
    definitionMd: form.definitionMd.trim() || undefined,
    bodyMd: form.bodyMd.trim() || undefined,
    surfaces: form.surfaces
      .filter((s) => s.text.trim().length > 0)
      .map((s) => {
        const text = s.text.trim();
        return { text, lang: inferSurfaceLang(text), kind: s.kind };
      }),
  };

  if (expectedRevision !== undefined) {
    payload.expectedRevision = expectedRevision;
  }

  return payload;
}
