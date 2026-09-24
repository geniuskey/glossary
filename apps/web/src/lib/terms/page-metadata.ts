import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { displayName } from "@/lib/ui/format";

// 메타데이터와 본문이 같은 요청에서 용어를 두 번 조회하지 않게 한 렌더 안에서 묶는다.
export const loadTermForPage = cache(getTermByIdOrSlug);

// 로그인 전에는 용어 이름을 탭 제목으로 흘리지 않는다 — 본문은 /login으로
// 리다이렉트되더라도 <title>은 먼저 스트리밍될 수 있다.
export async function termPageMetadata(params: Promise<{ slug: string }>, suffix?: string): Promise<Metadata> {
  if (!(await getCurrentUser())) return {};
  const term = await loadTermForPage((await params).slug);
  if (!term) return {};
  const name = displayName(term);
  return { title: suffix ? `${name} ${suffix}` : name };
}
