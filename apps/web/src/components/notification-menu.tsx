"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationKind, NotificationListResponse, NotificationWire } from "@/lib/notifications/wire";
import { cx, relativeTime } from "@/lib/ui/format";

// 실시간 채널이 없어서 주기적으로 묻는다. 탭이 숨겨져 있을 때는 묻지 않으므로
// 열어 둔 탭이 여러 개여도 부하는 보고 있는 탭 하나만큼이다.
const POLL_MS = 60_000;

// Record<유니온, …>라 알림 종류가 늘면 tsc가 여기서 문구를 요구한다.
// 용어 이름 바로 뒤에 붙는 문구라 조사부터 시작한다("‹용어› 댓글에서…", "‹용어›에서…").
export const NOTIFICATION_PHRASE: Record<NotificationKind, string> = {
  comment_mention: " 댓글에서 회원님을 언급했습니다.",
  comment_reply: "에서 회원님의 댓글에 답글을 달았습니다.",
};

export function unreadBadgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationListResponse>({ items: [], unreadCount: 0 });
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData(await response.json());
      setError("");
    } catch {
      setError("알림을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open, load]);

  function markRead(ids?: string[]) {
    setData((current) => ({
      items: current.items.map((item) => (!ids || ids.includes(item.id) ? { ...item, read: true } : item)),
      unreadCount: ids ? Math.max(0, current.unreadCount - current.items.filter((i) => ids.includes(i.id) && !i.read).length) : 0,
    }));
    // keepalive: 알림을 누르면 바로 다른 화면으로 넘어간다. 그냥 fetch는 페이지가 바뀌며 취소될 수 있다.
    void fetch("/api/v1/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
      keepalive: true,
    }).catch(() => undefined);
  }

  const unread = data.unreadCount;
  return (
    <div ref={rootRef} className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-popover"
        aria-label={unread ? `알림 ${unread}개 안 읽음` : "알림"}
        title="알림"
        className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <BellIcon />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-brand-on">
            {unreadBadgeLabel(unread)}
          </span>
        )}
      </button>

      <div
        id="notification-popover"
        role="dialog"
        aria-label="알림"
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel shadow-xl shadow-ink/10"
      >
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-sm font-semibold text-ink">알림</span>
          {unread > 0 && (
            <button type="button" className="text-xs text-ink-3 hover:text-brand" onClick={() => markRead()}>모두 읽음</button>
          )}
        </div>
        {error && <p role="alert" className="px-3 py-2 text-xs text-danger">{error}</p>}
        {data.items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-3">새 알림이 없습니다.</p>
        ) : (
          <ul className="max-h-[min(28rem,70vh)] divide-y divide-line overflow-y-auto">
            {data.items.map((item) => <NotificationItem key={item.id} item={item} onOpen={() => { if (!item.read) markRead([item.id]); setOpen(false); }} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function NotificationItem({ item, onOpen }: { item: NotificationWire; onOpen: () => void }) {
  return (
    <li>
      {/* 일반 <a>로 이동한다. 같은 용어 화면에 있을 때 클라이언트 전환은 이미 그려 둔
          댓글 목록을 그대로 두므로, 새 댓글이 화면에 없는 채로 끝날 수 있다. */}
      <a
        href={item.href}
        onClick={onOpen}
        className={cx("block px-3 py-2.5 text-sm hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40", !item.read && "bg-brand-soft/30")}
      >
        <span className="flex items-start gap-2">
          {!item.read && <span aria-label="안 읽음" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
          <span className="min-w-0 flex-1">
            <span className="block text-ink">
              <b className="font-semibold">{item.actorName ?? "탈퇴한 사용자"}</b>님이 <b className="font-semibold">{item.term.name}</b>{NOTIFICATION_PHRASE[item.kind]}
            </span>
            {item.excerpt && <span className="mt-0.5 block line-clamp-2 break-words text-xs text-ink-2">{item.excerpt}</span>}
            <time className="mt-0.5 block text-[11px] text-ink-3" dateTime={item.createdAt} title={item.createdAt}>
              {relativeTime(new Date(item.createdAt))}
            </time>
          </span>
        </span>
      </a>
    </li>
  );
}

function BellIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1.25 4.25 1.75 4.75H2.25C2.75 10.75 4 9.5 4 6.5Z" strokeLinejoin="round" />
      <path d="M6.5 13.25a1.6 1.6 0 0 0 3 0" strokeLinecap="round" />
    </svg>
  );
}
