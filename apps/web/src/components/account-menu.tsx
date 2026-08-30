"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { cx } from "@/lib/ui/format";
import { LogoutButton } from "./logout-button";
import { ThemeToggle } from "./theme-toggle";

const ROLE_LABEL: Record<CurrentUser["role"], string> = { admin: "관리자", editor: "편집자" };

export function AccountMenu({
  user,
  current,
  placement = "sidebar",
}: {
  user: CurrentUser;
  current?: string;
  placement?: "sidebar" | "topbar";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = user.name || user.email;

  useEffect(() => {
    if (!open) return;

    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-controls="account-submenu"
        aria-expanded={open}
        aria-label={`${label} 계정 메뉴`}
        title={`${label} · ${ROLE_LABEL[user.role]}`}
        className={cx(
          "flex items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-panel-2",
          placement === "sidebar" ? "sidebar-account-trigger w-full lg:bg-panel-2 lg:px-2 lg:py-2" : "shrink-0 sm:px-2",
          current === "settings" || current === "admin" ? "text-brand" : "text-ink",
        )}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-semibold text-brand-on" aria-hidden>
          {label.slice(0, 1).toUpperCase()}
        </span>
        <span className={cx(
          "hidden min-w-0 flex-1 flex-col leading-tight lg:flex",
          placement === "sidebar" && "sidebar-expanded-only",
        )}>
          <span className="truncate text-xs font-medium">{label}</span>
          <span className="text-[10px] text-ink-3">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronIcon open={open} placement={placement} />
      </button>

      <div
        id="account-submenu"
        role="menu"
        hidden={!open}
        className={cx(
          "account-popover absolute z-50 w-56 rounded-xl border border-line bg-panel p-1.5 shadow-xl shadow-ink/10",
          placement === "sidebar"
            ? "right-0 top-full mt-2 lg:bottom-full lg:left-0 lg:right-auto lg:top-auto lg:mb-2 lg:mt-0 lg:w-full lg:min-w-52"
            : "right-0 top-full mt-2",
        )}
      >
        <AccountLink href="/settings" label="설정" hint="계정 · API" active={current === "settings"} onSelect={() => setOpen(false)}>
          <SettingsIcon />
        </AccountLink>
        {user.role === "admin" && (
          <AccountLink href="/admin" label="관리자" hint="사용자 관리" active={current === "admin"} onSelect={() => setOpen(false)}>
            <AdminIcon />
          </AccountLink>
        )}
        <div className="my-1 border-t border-line" />
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="text-xs text-ink-3">화면 테마</span>
          <ThemeToggle alwaysShowLabel menuItem />
        </div>
        <LogoutButton alwaysShowLabel menuItem />
      </div>
    </div>
  );
}

function AccountLink({
  href,
  label,
  hint,
  active,
  onSelect,
  children,
}: {
  href: string;
  label: string;
  hint: string;
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className={cx(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
        active ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
      )}
    >
      <span className="shrink-0 text-ink-3">{children}</span>
      <span>{label}</span>
      <span className="ml-auto text-[10px] text-ink-3">{hint}</span>
    </Link>
  );
}

function ChevronIcon({ open, placement }: { open: boolean; placement: "sidebar" | "topbar" }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className={cx("hidden shrink-0 text-ink-3 lg:block", placement === "sidebar" && "sidebar-expanded-only")}>
      <path d={open ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M6.9 1.8h2.2l.45 1.55c.4.16.78.38 1.12.65l1.57-.4 1.1 1.9-1.12 1.17c.03.22.05.44.05.66s-.02.44-.05.66l1.12 1.17-1.1 1.9-1.57-.4c-.34.27-.72.49-1.12.65L9.1 12.85H6.9l-.45-1.54a5 5 0 0 1-1.12-.65l-1.57.4-1.1-1.9 1.12-1.17a4.7 4.7 0 0 1 0-1.32L2.66 5.5l1.1-1.9 1.57.4c.34-.27.72-.49 1.12-.65z" strokeLinejoin="round" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3.5 13.5c.25-3 1.75-4.5 4.5-4.5s4.25 1.5 4.5 4.5" strokeLinecap="round" />
    </svg>
  );
}
