import { isUuid } from "@/lib/api-error";
import { TERM_SLUG_MAX } from "./limits";

export const RESERVED_SLUGS = new Set(["lookup", "new", "suggest"]);

export function slugify(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function slugValidationMessage(slug: string): string | null {
  if (!slug) return "URL 주소로 사용할 글자나 숫자를 입력해 주세요.";
  if (slug.length > TERM_SLUG_MAX) return `URL 주소는 ${TERM_SLUG_MAX}자 이하여야 합니다.`;
  if (RESERVED_SLUGS.has(slug)) return `“${slug}”은 시스템에서 사용하는 주소라 선택할 수 없습니다.`;
  if (isUuid(slug)) return "UUID 형식의 주소는 용어 ID와 구분할 수 없어 선택할 수 없습니다.";
  return null;
}
