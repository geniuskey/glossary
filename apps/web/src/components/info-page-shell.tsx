import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/app-shell";
import { InfoFooter } from "@/components/info-links";
import { PROJECT_LINKS } from "@/lib/project-links";
import { cx } from "@/lib/ui/format";

const INFO_NAV = [
  { href: "/help", label: "도움말" },
  { href: "/support", label: "지원" },
  { href: "/about", label: "소개" },
  { href: "/legal", label: "법적 고지" },
] as const;

export function InfoPageShell({
  current,
  eyebrow,
  title,
  description,
  children,
}: {
  current: (typeof INFO_NAV)[number]["href"];
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper">
      <a href="#main-content" className="sr-only fixed left-3 top-3 z-50 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-on focus:not-sr-only">본문으로 건너뛰기</a>
      <header className="sticky top-0 z-30 border-b border-line bg-panel/90 backdrop-blur">
        <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
          <Link href="/" className="mr-auto flex shrink-0 items-center gap-2.5" aria-label="Grossary 홈">
            <BrandMark />
            <span className="text-[15px] font-semibold tracking-tight text-ink">Grossary</span>
          </Link>
          <nav aria-label="정보 메뉴" className="flex items-center gap-1 overflow-x-auto">
            {INFO_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.href === current ? "page" : undefined}
                className={cx("btn-quiet btn-sm whitespace-nowrap", item.href === current && "bg-brand-soft text-brand")}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <a href={PROJECT_LINKS.documentation} target="_blank" rel="noreferrer" className="btn-ghost btn-sm hidden sm:inline-flex">문서</a>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{title}</h1>
          <p className="mt-4 text-sm leading-7 text-ink-2 sm:text-base">{description}</p>
        </header>
        <div className="mt-10">{children}</div>
      </main>

      <InfoFooter className="mx-auto max-w-5xl border-t border-line px-5 py-6 sm:px-8" />
    </div>
  );
}

export function InfoCard({ title, children, href, external = false }: { title: string; children: ReactNode; href?: string; external?: boolean }) {
  const body = (
    <div className="card h-full p-5 transition hover:border-line-strong hover:shadow-sm">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-2 text-sm leading-6 text-ink-2">{children}</div>
      {href && <span className="mt-4 inline-flex text-xs font-medium text-brand">바로가기 →</span>}
    </div>
  );
  if (!href) return body;
  return external
    ? <a href={href} target="_blank" rel="noreferrer" className="block h-full">{body}</a>
    : <Link href={href} className="block h-full">{body}</Link>;
}
