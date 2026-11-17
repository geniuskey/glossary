"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/ui/format";
import { EditorIcon, type EditorIconName } from "./markdown-editor-icons";

export interface EditorMenuItem {
  action: string;
  label: string;
  icon?: EditorIconName;
  hint?: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  /** 메뉴 안에서 결과 모양을 미리 보여 줄 때(제목 크기 등) 라벨에 붙이는 클래스 */
  labelClassName?: string;
}

export interface EditorMenuSection {
  title?: string;
  items: readonly EditorMenuItem[];
}

interface EditorMenuProps {
  label: string;
  title?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  sections: readonly EditorMenuSection[];
  onSelect: (action: string) => void;
  disabled?: boolean;
  /** 항목 중 하나만 고르는 메뉴(블록 종류)는 menuitemradio로 알린다. */
  radio?: boolean;
  align?: "start" | "end";
  pressed?: boolean;
}

const MENU_GAP = 6;

/**
 * 편집기 셸은 resize-y 때문에 overflow가 visible일 수 없다(CSS resize는 overflow가
 * visible이면 동작하지 않는다). 그래서 셸 안에 absolute로 띄운 메뉴는 짧은 편집기에서
 * 아래가 잘렸다. 메뉴는 body로 portal해서 fixed 좌표로 띄운다.
 */
export function EditorMenu({ label, title, trigger, triggerClassName, sections, onSelect, disabled = false, radio = false, align = "start", pressed }: EditorMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusFirstRef = useRef<"first" | "last" | "checked">("first");
  // 스크롤할 때마다 position이 바뀌므로, 처음 자리를 잡았을 때 한 번만 포커스를 옮긴다.
  const positioned = position !== null;

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = menu.offsetWidth;
      const menuHeight = menu.scrollHeight;
      const below = window.innerHeight - rect.bottom - MENU_GAP - 8;
      const above = rect.top - MENU_GAP - 8;
      const flip = menuHeight > below && above > below;
      const maxHeight = Math.max(160, flip ? above : below);
      const top = flip ? Math.max(8, rect.top - MENU_GAP - Math.min(menuHeight, maxHeight)) : rect.bottom + MENU_GAP;
      const preferred = align === "end" ? rect.right - menuWidth : rect.left;
      const left = Math.min(Math.max(8, preferred), window.innerWidth - menuWidth - 8);
      setPosition({ top, left, maxHeight });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open || !position) return;
    const items = menuItems();
    const target = focusFirstRef.current === "last"
      ? items.at(-1)
      : focusFirstRef.current === "checked"
        ? items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0]
        : items[0];
    target?.focus({ preventScroll: true });
  }, [open, positioned]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [open]);

  function menuItems() {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function openWith(focus: "first" | "last" | "checked") {
    focusFirstRef.current = focus;
    setPosition(null);
    setOpen(true);
  }

  function choose(item: EditorMenuItem) {
    if (item.disabled) return;
    close(false);
    onSelect(item.action);
  }

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className="markdown-editor-menu fixed z-[120] min-w-[13rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-line bg-panel p-1.5 text-ink shadow-pop animate-fade-up"
      style={position ? { top: position.top, left: position.left, maxHeight: position.maxHeight } : { top: -9999, left: -9999 }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          close(true);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = menuItems();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      {sections.map((section, sectionIndex) => (
        <div key={section.title ?? sectionIndex} role="group" aria-label={section.title} className={cx(sectionIndex > 0 && "mt-1 border-t border-line pt-1")}>
          {section.title && <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-ink-3" aria-hidden="true">{section.title}</div>}
          {section.items.map((item) => (
            <button
              key={item.action}
              type="button"
              role={radio ? "menuitemradio" : "menuitem"}
              aria-checked={radio ? Boolean(item.checked) : undefined}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              onClick={() => choose(item)}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none transition-colors",
                "hover:bg-panel-2 focus-visible:bg-panel-2 focus:bg-panel-2",
                item.checked && "text-brand",
                item.disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
              )}
            >
              {item.icon && (
                <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-panel-2", item.checked ? "text-brand" : "text-ink-2")}>
                  <EditorIcon name={item.icon} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={cx("block truncate", item.labelClassName)}>{item.label}</span>
                {item.hint && <span className="block truncate text-[11px] text-ink-3">{item.hint}</span>}
              </span>
              {item.shortcut && <kbd className="shrink-0 font-sans text-[11px] tabular-nums text-ink-3">{item.shortcut}</kbd>}
              {radio && <span className={cx("shrink-0 text-brand", !item.checked && "invisible")}><EditorIcon name="check" size={14} /></span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-pressed={pressed}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? close(false) : openWith(radio ? "checked" : "first"))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openWith(event.key === "ArrowUp" ? "last" : radio ? "checked" : "first");
        }}
        className={cx(triggerClassName, open && "!bg-panel-2 !text-ink")}
      >
        {trigger}
      </button>
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </>
  );
}
