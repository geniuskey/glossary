import { isUuid } from "@/lib/api-error";
import { TERM_SLUG_MAX } from "./limits";

export const RESERVED_SLUGS = new Set(["lookup", "new", "paste-check", "suggest", "catalog", "batch"]);

export function slugify(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// 약어는 분야마다 뜻이 겹친다(SLA, POD, PM…). nameEn을 slug로 쓰면 먼저 등록된
// 개념이 `/g/sla`를 선점하고 나머지는 뜻 없는 `sla-2`가 된다. 풀네임은 개념 단위로
// 거의 유일하므로 풀네임을 우선한다. 약어 주소(`/g/sla`)는 표기 조회로 풀린다.
export function slugSeed(names: { fullNameEn?: string | null; nameEn?: string | null; nameKo?: string | null }): string {
  for (const name of [names.fullNameEn, names.nameEn, names.nameKo]) {
    const seed = truncateSlug(slugify(name ?? ""));
    if (seed) return seed;
  }
  return "term";
}

function truncateSlug(slug: string, max = TERM_SLUG_MAX): string {
  return slug.slice(0, max).replace(/-+$/, "");
}

// 풀네임까지 겹치면 Wikipedia의 괄호 한정어처럼 분야를 붙인다(`pod-kubernetes`).
// 번호는 분야가 없거나 분야까지 겹칠 때만 쓴다 — `-2`는 두 개념을 가르는 정보가 없다.
export function pickSlug(seed: string, domains: readonly string[], isTaken: (slug: string) => boolean): string {
  const blocked = (slug: string) => isTaken(slug) || RESERVED_SLUGS.has(slug) || isUuid(slug);
  if (!blocked(seed)) return seed;

  const qualified = [...new Set(domains.map((domain) => slugify(domain)).filter(Boolean))]
    .map((qualifier) => `${truncateSlug(seed, TERM_SLUG_MAX - qualifier.length - 1)}-${qualifier}`);
  const free = qualified.find((candidate) => !blocked(candidate));
  if (free) return free;

  const base = qualified[0] ?? seed;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${truncateSlug(base, TERM_SLUG_MAX - suffix.length)}${suffix}`;
    if (!blocked(candidate)) return candidate;
  }
}

export function slugValidationMessage(slug: string): string | null {
  if (!slug) return "URL 주소로 사용할 글자나 숫자를 입력해 주세요.";
  if (slug.length > TERM_SLUG_MAX) return `URL 주소는 ${TERM_SLUG_MAX}자 이하여야 합니다.`;
  if (RESERVED_SLUGS.has(slug)) return `“${slug}”은 시스템에서 사용하는 주소라 선택할 수 없습니다.`;
  if (isUuid(slug)) return "UUID 형식의 주소는 용어 ID와 구분할 수 없어 선택할 수 없습니다.";
  return null;
}
