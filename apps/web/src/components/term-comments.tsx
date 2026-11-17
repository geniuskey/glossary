"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  activeMentionQuery, decodeMentions, encodeMentions, filterMentionUsers, insertMention, parseCommentBody,
  type MentionUser,
} from "@/lib/comments/mentions";
import { buildCommentTree, COMMENT_BODY_MAX, countVisibleComments, type CommentNode, type TermCommentWire } from "@/lib/comments/tree";
import { relativeTime } from "@/lib/ui/format";

export interface CommentUser extends MentionUser {
  email: string;
  label: string;
}

interface Viewer {
  id: string;
  role: "admin" | "editor" | "viewer";
}

// 답글의 답글이 계속 오른쪽으로 밀리면 좁은 화면에서 본문 폭이 0이 된다. 이 깊이부터는 들여쓰지 않는다.
const MAX_INDENT_DEPTH = 3;

async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "처리하지 못했습니다. 다시 시도해 주세요.");
  return body;
}

function CommentBody({ body, users, viewerId }: { body: string; users: Map<string, CommentUser>; viewerId: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">
      {parseCommentBody(body).map((segment, index) => {
        if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
        // 저장할 때의 이름보다 지금 이름을 보여준다. 탈퇴한 사람이면 저장된 이름으로 남긴다.
        const name = users.get(segment.userId)?.name ?? segment.name;
        const mine = segment.userId === viewerId;
        return (
          <span
            key={index}
            className={`rounded px-1 font-medium ${mine ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand"}`}
            title={users.get(segment.userId)?.label}
          >
            @{name}
          </span>
        );
      })}
    </p>
  );
}

function CommentComposer({
  users, initial = "", submitLabel, placeholder, autoFocus, onSubmit, onCancel,
}: {
  users: CommentUser[];
  initial?: string;
  submitLabel: string;
  placeholder: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const id = useId();
  const decoded = useMemo(() => decodeMentions(initial), [initial]);
  const [text, setText] = useState(decoded.text);
  const [mentions, setMentions] = useState<MentionUser[]>(decoded.mentions);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  const query = activeMentionQuery(text, caret);
  const suggestions = query && !dismissed ? filterMentionUsers(users, query.query) : [];
  const open = suggestions.length > 0;
  const encoded = encodeMentions(text, mentions);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    // 멘션을 넣은 뒤 커서를 이름 바로 뒤로 옮긴다. setState 직후에는 textarea 값이 아직 옛 값이다.
    if (pendingCaret.current === null || !ref.current) return;
    ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text]);
  useEffect(() => setActive(0), [query?.query]);

  function choose(user: CommentUser) {
    const next = insertMention(text, caret, user);
    if (!next) return;
    setText(next.text);
    setCaret(next.caret);
    setMentions((list) => [...list.filter((m) => m.id !== user.id), { id: user.id, name: user.name }]);
    pendingCaret.current = next.caret;
    ref.current?.focus();
  }

  async function submit() {
    if (!text.trim() || busy) return;
    if (encoded.length > COMMENT_BODY_MAX) { setError(`댓글은 ${COMMENT_BODY_MAX}자까지 쓸 수 있습니다.`); return; }
    setBusy(true);
    setError("");
    try {
      await onSubmit(encoded);
      setText("");
      setMentions([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중의 Enter는 글자를 확정하는 키다. 여기서 가로채면 마지막 글자가 사라진다.
    if (event.nativeEvent.isComposing) return;
    if (open) {
      if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => (i + 1) % suggestions.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); choose(suggestions[active]!); return; }
      if (event.key === "Escape") { event.preventDefault(); setDismissed(true); return; }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); return; }
    if (event.key === "Escape" && onCancel) { event.preventDefault(); onCancel(); }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{placeholder}</label>
      <textarea
        ref={ref}
        id={id}
        className="field min-h-20 w-full resize-y"
        value={text}
        placeholder={placeholder}
        disabled={busy}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-mentions`}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-mention-${active}` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setCaret(event.target.selectionStart);
          setDismissed(false);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={`${id}-mentions`}
          role="listbox"
          aria-label="멘션할 사용자"
          className="absolute left-0 z-20 mt-1 max-h-60 w-full max-w-sm overflow-y-auto rounded-lg border border-line bg-panel shadow-lg"
        >
          {suggestions.map((user, index) => (
            <li
              key={user.id}
              id={`${id}-mention-${index}`}
              role="option"
              aria-selected={index === active}
              className={`cursor-pointer px-3 py-2 text-sm ${index === active ? "bg-panel-2" : ""}`}
              // mousedown에서 고른다. click까지 기다리면 textarea의 blur가 먼저 와 커서 위치를 잃는다.
              onMouseDown={(event) => { event.preventDefault(); choose(user); }}
              onMouseEnter={() => setActive(index)}
            >
              <span className="block font-medium text-ink">{user.name}</span>
              <span className="block truncate text-xs text-ink-3">{user.label}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-3">@를 입력해 사람을 언급할 수 있습니다 · ⌘/Ctrl+Enter로 등록</span>
        <span className="ml-auto flex gap-1.5">
          {onCancel && <button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={busy}>취소</button>}
          <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !text.trim()}>
            {busy ? "저장 중…" : submitLabel}
          </button>
        </span>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

function CommentItem({
  node, depth, ctx,
}: {
  node: CommentNode;
  depth: number;
  ctx: {
    viewer: Viewer;
    users: CommentUser[];
    userMap: Map<string, CommentUser>;
    replyTo: string | null;
    editing: string | null;
    setReplyTo: (id: string | null) => void;
    setEditing: (id: string | null) => void;
    reply: (parentId: string, body: string) => Promise<void>;
    edit: (id: string, body: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
  };
}) {
  const mine = node.authorId === ctx.viewer.id;
  const mentionsMe = node.mentionedUserIds.includes(ctx.viewer.id);
  return (
    <li className="min-w-0">
      {/* 알림 링크(#comment-<id>)가 가리키는 자리. 상단 고정 바에 가리지 않게 scroll-mt를 둔다. */}
      <div id={`comment-${node.id}`} className={`scroll-mt-28 rounded-lg px-3 py-2.5 target:ring-2 target:ring-brand/40 ${mentionsMe ? "bg-warn-soft/40" : ""}`}>
        {node.deleted ? (
          <p className="text-sm italic text-ink-3">삭제된 댓글입니다.</p>
        ) : (
          <>
            <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
              <span className="font-semibold text-ink-2">{node.authorName ?? "탈퇴한 사용자"}</span>
              <time dateTime={node.createdAt} title={node.createdAt} suppressHydrationWarning>
                {relativeTime(new Date(node.createdAt))}
              </time>
              {node.edited && <span>(수정됨)</span>}
            </div>
            {ctx.editing === node.id ? (
              <CommentComposer
                users={ctx.users}
                initial={node.body}
                submitLabel="수정"
                placeholder="댓글 수정"
                autoFocus
                onSubmit={async (body) => { await ctx.edit(node.id, body); ctx.setEditing(null); }}
                onCancel={() => ctx.setEditing(null)}
              />
            ) : (
              <>
                <CommentBody body={node.body} users={ctx.userMap} viewerId={ctx.viewer.id} />
                <div className="mt-1 flex gap-3 text-xs">
                  <button type="button" className="text-ink-3 hover:text-brand" onClick={() => ctx.setReplyTo(ctx.replyTo === node.id ? null : node.id)}>
                    답글
                  </button>
                  {mine && (
                    <button type="button" className="text-ink-3 hover:text-brand" onClick={() => ctx.setEditing(node.id)}>수정</button>
                  )}
                  {(mine || ctx.viewer.role === "admin") && (
                    <button
                      type="button"
                      className="text-ink-3 hover:text-danger"
                      onClick={() => { if (window.confirm("이 댓글을 삭제할까요?")) void ctx.remove(node.id); }}
                    >
                      삭제
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
      {ctx.replyTo === node.id && !node.deleted && (
        <div className="ml-3 mt-1 border-l-2 border-line pl-3">
          <CommentComposer
            users={ctx.users}
            // 답글 창을 열면 원 댓글 작성자를 먼저 언급해 둔다. 누구에게 하는 말인지 깊은 트리에서 금방 흐려진다.
            initial={node.authorId && node.authorId !== ctx.viewer.id && node.authorName
              ? `@[${node.authorName}](user:${node.authorId}) `
              : ""}
            submitLabel="답글 등록"
            placeholder={`${node.authorName ?? "댓글"}에 답글`}
            autoFocus
            onSubmit={async (body) => { await ctx.reply(node.id, body); ctx.setReplyTo(null); }}
            onCancel={() => ctx.setReplyTo(null)}
          />
        </div>
      )}
      {node.replies.length > 0 && (
        <ul className={depth < MAX_INDENT_DEPTH ? "ml-3 border-l-2 border-line pl-3" : ""}>
          {node.replies.map((child) => <CommentItem key={child.id} node={child} depth={depth + 1} ctx={ctx} />)}
        </ul>
      )}
    </li>
  );
}

export function TermComments({
  termSlug, viewer, users, initialComments,
}: {
  termSlug: string;
  viewer: Viewer;
  users: CommentUser[];
  initialComments: TermCommentWire[];
}) {
  const [comments, setComments] = useState(initialComments);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const base = `/api/v1/terms/${encodeURIComponent(termSlug)}/comments`;
  const tree = useMemo(() => buildCommentTree(comments), [comments]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  // 자기 자신을 멘션 후보에 두면 실수로 고르기 쉽고 쓸모가 없다.
  const mentionable = useMemo(() => users.filter((u) => u.id !== viewer.id), [users, viewer.id]);

  async function refresh() {
    const body = await jsonRequest(base);
    setComments(body.comments);
  }
  const send = (url: string, method: string, payload?: unknown) => jsonRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  // 각 쓰기 뒤에 전체를 다시 읽는다. 다른 사람이 그 사이 단 답글도 함께 보이고,
  // 응답 하나를 로컬 목록에 끼워 넣는 코드가 서버의 정렬·삭제 규칙과 갈라질 일이 없다.
  const ctx = {
    viewer, users: mentionable, userMap, replyTo, editing, setReplyTo, setEditing,
    reply: async (parentId: string, body: string) => { await send(base, "POST", { body, parentId }); await refresh(); },
    edit: async (id: string, body: string) => { await send(`${base}/${id}`, "PATCH", { body }); await refresh(); },
    remove: async (id: string) => {
      setError("");
      try { await send(`${base}/${id}`, "DELETE"); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "삭제하지 못했습니다."); }
    },
  };
  const count = countVisibleComments(tree);

  useEffect(() => {
    // 같은 용어 화면에서 알림을 누르면 해시만 바뀌고 페이지는 다시 그려지지 않는다.
    // 가리키는 댓글이 지금 목록에 없으면 다시 읽은 뒤 그 자리로 스크롤한다.
    async function reveal() {
      const id = window.location.hash.match(/^#comment-([0-9a-f-]{36})$/i)?.[1];
      if (!id || document.getElementById(`comment-${id}`)) return;
      try {
        await refresh();
        requestAnimationFrame(() => document.getElementById(`comment-${id}`)?.scrollIntoView({ block: "start" }));
      } catch { /* 목록을 다시 읽지 못해도 화면은 그대로 둔다. */ }
    }
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  });

  return (
    <section aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="mb-3 text-base font-semibold text-ink">
        댓글 <span className="text-sm font-normal text-ink-3">{count}</span>
      </h2>
      <CommentComposer
        users={mentionable}
        submitLabel="댓글 등록"
        placeholder="이 용어에 대한 의견이나 질문을 남겨 주세요"
        onSubmit={async (body) => { await send(base, "POST", { body }); await refresh(); }}
      />
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {tree.length > 0 ? (
        <ul className="mt-4 space-y-1">
          {tree.map((node) => <CommentItem key={node.id} node={node} depth={0} ctx={ctx} />)}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-3">아직 댓글이 없습니다.</p>
      )}
    </section>
  );
}
