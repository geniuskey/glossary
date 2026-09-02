import Link from "next/link";
import { PROJECT_COPYRIGHT, PROJECT_LINKS } from "@/lib/project-links";

export function InfoFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-ink-3 ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span>{PROJECT_COPYRIGHT}</span>
        <span aria-hidden>·</span>
        <a href={PROJECT_LINKS.creator} target="_blank" rel="noreferrer" className="hover:text-ink">euiyun.com</a>
      </span>
      <nav aria-label="제품 정보" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <Link href="/help" className="hover:text-ink">도움말</Link>
        <Link href="/support" className="hover:text-ink">지원</Link>
        <Link href="/about" className="hover:text-ink">소개</Link>
        <Link href="/legal" className="hover:text-ink">법적 고지</Link>
        <a href={PROJECT_LINKS.repository} target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
      </nav>
    </footer>
  );
}
