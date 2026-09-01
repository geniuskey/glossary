import type { terms, termSurfaces } from "@grossary/db";
import type { DuplicateWarning } from "./create";
import type { BusinessCategory, SurfaceKind, SurfaceRow, TermStatus, TermType } from "./query";

// R112: POST /api/v1/terms와 PATCH /api/v1/terms/[idOrSlug]는 둘 다
// createTerm/updateTerm이 돌려주는 `typeof terms.$inferSelect` 원시 행을 그대로
// `Response.json`에 실었다 — createdBy/updatedBy/replacedById(내부 감사
// 컬럼)와 term_surfaces의 normLoose/normSpace(내부 정규화 키)가 그대로
// 새어나간다. query.ts의 TermDetailResponse(R40/R62)가 이미 같은 문제를 GET
// 쪽에서 명시 select + 명시 wire 타입으로 닫은 선례이므로, 쓰기 응답도 같은
// 패턴을 따른다 — 다만 여기 term은 db.transaction()의 .returning()으로 이미
// 전체 컬럼을 받은 뒤라 select를 다시 할 수 없으므로, toTermWire/toSurfaceWire가
// 그 자리에서 필드를 골라낸다.
//
// updatedAt은 TermDetailResponse와 같은 이유로 Date가 아니라 문자열로 나가야
// 한다(Response.json이 직렬화하면 실제 응답은 문자열인데 타입은 Date라고
// 거짓말하게 된다 — R62).
export interface TermWire {
  id: string;
  slug: string;
  termType: TermType;
  nameEn: string | null;
  nameKo: string | null;
  fullNameEn: string | null;
  fullNameKo: string | null;
  domain: string[];
  category: BusinessCategory | null;
  topic: string | null;
  ownerId: string | null;
  status: TermStatus;
  definitionMd: string | null;
  bodyMd: string | null;
  updatedAt: string;
}

export function toTermWire(term: typeof terms.$inferSelect): TermWire {
  return {
    id: term.id,
    slug: term.slug,
    termType: term.termType,
    nameEn: term.nameEn,
    nameKo: term.nameKo,
    fullNameEn: term.fullNameEn,
    fullNameKo: term.fullNameKo,
    domain: term.domain,
    category: term.category,
    topic: term.topic,
    ownerId: term.ownerId,
    status: term.status,
    definitionMd: term.definitionMd,
    bodyMd: term.bodyMd,
    updatedAt: term.updatedAt.toISOString(),
  };
}

export function toSurfaceWire(s: typeof termSurfaces.$inferSelect): SurfaceRow {
  return { id: s.id, text: s.text, lang: s.lang, kind: s.kind as SurfaceKind, caseSensitive: s.caseSensitive };
}

// 경고는 표기 텍스트와 충돌 대상 슬러그만 있으면 화면이 "표기 → 기존 용어로
// 이동" 링크를 그릴 수 있다. normLoose(내부 정규화 키)와 conflictingTermId는
// 클라이언트가 쓰지 않으므로 여기서도 굳이 실어보내지 않는다(R112와 같은 원칙 —
// 내부 표현을 최소한으로 노출한다).
export interface DuplicateWarningWire {
  surfaceText: string;
  conflictingSlug: string;
}

export function toWarningWire(w: DuplicateWarning): DuplicateWarningWire {
  return { surfaceText: w.surfaceText, conflictingSlug: w.conflictingSlug };
}

export interface TermWriteResponse {
  term: TermWire;
  surfaces: SurfaceRow[];
  warnings: DuplicateWarningWire[];
}
