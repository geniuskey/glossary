import type { SurfaceKindLiteral, TermStatusLiteral } from "./enums";

/**
 * R136: 검색창의 자동완성 드롭다운(components/search-box.tsx)은 Client
 * Component다. R114와 같은 이유로 이 모듈은 `@grossary/db`를 import하지 않는다
 * — 여기 모아 둔 것은 **서버(홈의 결과 목록)와 클라이언트(드롭다운)가 같은
 * 규칙으로 만들어야 하는 조각들**뿐이다. 규칙이 두 벌이 되면 드롭다운에서
 * 누른 항목과 Enter로 간 결과가 서로 다른 곳으로 가는데, 그건 화면 어디에도
 * 에러로 나타나지 않는다.
 */

/**
 * 드롭다운에 한 번에 띄우는 후보 수. 라우트(응답 개수)와 클라이언트(키보드
 * 이동 범위)가 같은 수를 알아야 한다. 8을 넘기면 목록이 화면 아래로 밀려
 * "몇 자 치고 고르는" 동작이 스크롤 작업이 된다.
 */
export const SUGGEST_LIMIT = 8;

export interface Suggestion {
  id: string;
  slug: string;
  /** 실제로 맞은 표기. 표준명일 수도, 약어·별칭·금지 표기일 수도 있다. */
  matchedText: string;
  matchedKind: SurfaceKindLiteral;
  nameEn: string | null;
  nameKo: string | null;
  status: TermStatusLiteral;
  /** 정규화 키가 정확히 같았는가. */
  exact: boolean;
  /** 입력한 것이 이 표기의 앞부분인가 — 자동완성과 "유사한 표기"를 가른다. */
  prefix: boolean;
}

/**
 * 검색 결과/자동완성에서 그 용어로 갈 때의 주소. 맞은 표기가 표준명과 다를
 * 때만 `?from=`을 붙인다 — 나무위키가 넘어온 표기를 알려주는 것과 같은
 * 장치이고, 이 사전에서는 "내가 친 말이 이 개념의 어떤 표기였는지"가 검색의
 * 답 자체다. 표준명으로 찾아 들어간 경우까지 붙이면 주소만 길어지고 화면에는
 * "System on Chip에서 넘어옴" 같은 동어반복이 뜬다.
 */
export function termHref(hit: {
  slug: string;
  nameEn: string | null;
  nameKo: string | null;
  matchedText: string;
}): string {
  const sameAsName = hit.matchedText === hit.nameEn || hit.matchedText === hit.nameKo;
  return sameAsName ? `/w/${hit.slug}` : `/w/${hit.slug}?from=${encodeURIComponent(hit.matchedText)}`;
}

/**
 * 드롭다운은 두 묶음이다 — 앞부분이 맞은 것(자동완성)과 비슷하기만 한 것
 * (오타 교정). 섞어서 보여주면 "왜 이게 나왔지"라는 목록이 되고, 사용자는
 * 자기가 오타를 냈다는 사실을 끝까지 모른다.
 */
export function groupSuggestions(items: readonly Suggestion[]): {
  completions: Suggestion[];
  similar: Suggestion[];
} {
  return {
    completions: items.filter((s) => s.prefix),
    similar: items.filter((s) => !s.prefix),
  };
}

/**
 * 위/아래 화살표로 옮겨 다니는 자리. -1은 "아무것도 고르지 않음"(= 입력창
 * 자신)이고, 목록 끝에서 한 번 더 내리면 다시 -1로 돌아온다 — 구글 검색창과
 * 같은 동작이다. 끝에서 멈추게 하면 사용자가 직접 친 문자열로 돌아올 방법이
 * 없어서, 후보를 하나 고른 뒤에는 원래 검색어로 제출할 수 없게 된다.
 */
export function moveActive(active: number, delta: number, count: number): number {
  if (count === 0) return -1;
  const slots = count + 1; // 후보 count개 + "고르지 않음" 한 자리
  return ((((active + 1 + delta) % slots) + slots) % slots) - 1;
}

/**
 * 후보 문자열에서 굵게 칠할 앞부분의 길이. 정규화(대소문자·구분자·CamelCase)
 * 때문에 **눈에 보이는 문자열이 입력의 접두사라는 보장이 없다** —
 * "sysonchip"으로 "System on Chip"이 맞을 수 있다. 그런 경우 앞에서부터 세어
 * 칠하면 엉뚱한 글자가 굵어지므로, 대소문자만 무시하고 실제로 접두사일 때만
 * 칠한다(아니면 0).
 */
export function matchedPrefixLength(matchedText: string, typed: string): number {
  const head = typed.trim();
  if (!head) return 0;
  return matchedText.toLowerCase().startsWith(head.toLowerCase()) ? head.length : 0;
}
