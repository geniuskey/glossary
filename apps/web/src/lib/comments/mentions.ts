// 댓글 본문의 멘션 표기를 다루는 순수 함수. 서버(저장 시 검증)와 클라이언트(입력창,
// 렌더)가 같은 모듈을 쓴다 — 두 곳에서 정규식을 따로 쓰면 저장된 멘션이 화면에서
// 평문으로 보이는 식으로 에러 없이 조용히 갈라진다.
//
// 저장 형식은 `@[표시 이름](user:<uuid>)`다. 이름만 저장하면 동명이인과 개명에
// 깨지고, id만 저장하면 API로 본문을 읽는 도구가 누구인지 알 수 없다.

export interface MentionUser {
  id: string;
  name: string;
}

export type CommentSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; userId: string; name: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// 이름 안의 `]`와 줄바꿈은 encode 단계에서 지우므로 여기서는 받지 않는다.
const TOKEN_RE = new RegExp(`@\\[([^\\]\\n]{1,100})\\]\\(user:(${UUID})\\)`, "gi");

function tokenName(name: string): string {
  return name.replace(/[\]\n\r]/g, "").trim().slice(0, 100) || "사용자";
}

export function mentionToken(user: MentionUser): string {
  return `@[${tokenName(user.name)}](user:${user.id.toLowerCase()})`;
}

export function parseCommentBody(body: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN_RE)) {
    const start = match.index!;
    if (start > last) segments.push({ kind: "text", text: body.slice(last, start) });
    segments.push({ kind: "mention", name: match[1]!, userId: match[2]!.toLowerCase() });
    last = start + match[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return segments;
}

/** 본문에 멘션된 사용자 id. 순서를 유지하고 중복은 뺀다. */
export function mentionedUserIds(body: string): string[] {
  const ids = parseCommentBody(body).flatMap((s) => (s.kind === "mention" ? [s.userId] : []));
  return [...new Set(ids)];
}

/**
 * 입력창에는 `@홍길동`만 보이고, 고른 사용자는 따로 기억해 둔다. 보낼 때 그 표기를
 * 토큰으로 바꾼다. 사용자가 `@홍길동`을 지우거나 고쳐 쓰면 그 멘션은 평문으로 남는다 —
 * 지운 줄 알았던 사람에게 멘션이 가는 쪽이 더 나쁘다.
 *
 * 긴 이름부터 바꾼다. "김민"과 "김민수"를 둘 다 고르면 짧은 쪽이 "@김민수"의 앞부분을
 * 먼저 먹어 "@[김민](…)수"가 된다.
 */
export function encodeMentions(text: string, mentions: readonly MentionUser[]): string {
  const unique = [...new Map(mentions.map((m) => [m.id, m])).values()]
    .sort((a, b) => b.name.length - a.name.length);
  if (unique.length === 0) return text;
  const byLabel = new Map<string, MentionUser>();
  for (const user of unique) if (!byLabel.has(user.name)) byLabel.set(user.name, user);
  const pattern = new RegExp(
    `@(${[...byLabel.keys()].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  // 이미 토큰인 부분(`@[이름](user:…)`)은 건드리지 않는다.
  return parseCommentBody(text)
    .map((segment) => (segment.kind === "mention"
      ? mentionToken({ id: segment.userId, name: segment.name })
      : segment.text.replace(pattern, (_, name: string) => mentionToken(byLabel.get(name)!))))
    .join("");
}

/** 저장된 본문을 입력창 표기(`@이름`)와 고른 사용자 목록으로 되돌린다(댓글 수정용). */
export function decodeMentions(body: string): { text: string; mentions: MentionUser[] } {
  const mentions = new Map<string, MentionUser>();
  const text = parseCommentBody(body)
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      mentions.set(segment.userId, { id: segment.userId, name: segment.name });
      return `@${segment.name}`;
    })
    .join("");
  return { text, mentions: [...mentions.values()] };
}

/**
 * 커서 바로 앞이 `@검색어` 중이면 그 검색어와 `@`의 위치를 돌려준다. `@`는 줄 처음이나
 * 공백 뒤에서만 인정한다 — 이메일 주소(`kim@example.com`)를 칠 때마다 사용자 목록이
 * 뜨면 안 된다.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2]!.length - 1, query: match[2]! };
}

/** 고른 사용자를 커서 위치의 `@검색어` 자리에 넣는다. */
export function insertMention(text: string, caret: number, user: MentionUser): { text: string; caret: number } | null {
  const active = activeMentionQuery(text, caret);
  if (!active) return null;
  const label = `@${tokenName(user.name)} `;
  const next = text.slice(0, active.start) + label + text.slice(caret).replace(/^ /, "");
  return { text: next, caret: active.start + label.length };
}

export function filterMentionUsers<T extends MentionUser & { email?: string }>(users: readonly T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? users.filter((u) => u.name.toLowerCase().includes(q) || (u.email?.toLowerCase().includes(q) ?? false))
    : [...users];
  // 이름이 검색어로 시작하는 사람을 위로 올린다. "김"을 치고 "박김수"가 맨 위에 오면 어색하다.
  matches.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)));
  return matches.slice(0, limit);
}
