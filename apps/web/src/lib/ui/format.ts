// 화면 전반이 함께 쓰는 순수 표시 함수들. 날짜 라이브러리를 새로 들이지 않는다
// (번들 크기가 이 앱의 제약이다) — 필요한 건 상대 시간 하나뿐이라 직접 만든다.

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 로컬 타임존 기준 자정 사이의 "날짜 수" 차이. 시간 차(24h)로 계산하면
 *  23:50 → 00:10이 "어제"가 아니라 "방금"으로 나온다. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY);
}

export function isoDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * "누가 언제 고쳤는지"가 함께 쓰는 사전에서는 가장 자주 읽히는 정보라, 목록의
 * 모든 행에 ISO 날짜를 그대로 박아두면 눈이 그걸 훑지 못한다. 최근 것만 상대
 * 시간으로 보여주고 오래된 것은 날짜로 되돌린다.
 */
export function relativeTime(value: Date, now: Date = new Date()): string {
  const diff = now.getTime() - value.getTime();
  if (diff < 0) return isoDate(value);
  if (diff < MINUTE) return "방금";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < 6 * HOUR) return `${Math.floor(diff / HOUR)}시간 전`;

  const days = calendarDaysBetween(value, now);
  if (days === 0) return `${Math.floor(diff / HOUR)}시간 전`;
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return isoDate(value);
}

/**
 * 용어마다 고정된 "책등 색". 목록에서 같은 용어를 다시 찾을 때 위치가 아니라
 * 색으로 기억하게 하려는 장치다 — slug에서 결정론적으로 나오므로 서버 렌더와
 * 클라이언트 렌더가 항상 같은 값을 낸다(저장할 컬럼이 필요 없다).
 */
export function spineHue(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/** 이름이 없는 용어(둘 다 비어 있는 상태)도 목록에서 빈칸으로 사라지면 안 된다. */
export function displayName(term: { nameEn?: string | null; nameKo?: string | null; slug: string }): string {
  return term.nameEn ?? term.nameKo ?? term.slug;
}
