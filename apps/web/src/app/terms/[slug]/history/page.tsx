import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { listRevisions } from "@/lib/terms/update";
import { displayName, isoDate, relativeTime } from "@/lib/ui/format";
import { RevertButton } from "./revert-button";

export default async function TermHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const term = await getTermByIdOrSlug(slug);
  if (!term) notFound();

  const revisions = await listRevisions(term.id);
  // listRevisions는 최신순이라 맨 앞이 현재 리비전이다. 되돌리기는 이 번호를
  // expectedRevision으로 보내서, 화면을 열어 둔 사이에 남이 먼저 고쳤으면
  // 409로 멈추게 한다.
  const currentRevision = revisions[0]?.revisionNumber ?? 0;

  return (
    <AppShell user={user} current="terms">
      <nav className="mb-5 text-xs text-ink-3">
        <Link href="/terms" className="link">
          용어집
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/terms/${term.slug}`} className="link">
          {displayName(term)}
        </Link>
        <span className="mx-1.5">/</span>
        <span>이력</span>
      </nav>

      <header className="mb-5 flex items-end justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">수정 이력</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            리비전 {revisions.length}개 · 최신순 · 되돌려도 이력은 지워지지 않고 새 리비전이 쌓인다
          </p>
        </div>
        <Link href={`/terms/${term.slug}/edit`} className="btn-ghost btn-sm">
          편집
        </Link>
      </header>

      {/* 세로선 하나를 깔고 그 위에 점을 찍는 타임라인. 함께 쓰는 사전에서는
          "누가 언제 손댔는가"가 목록의 주인공이라, 리비전 번호보다 사람과
          시각이 먼저 읽히도록 배치한다. */}
      <ol className="relative ml-2 border-l border-line pl-5">
        {revisions.map((r, i) => (
          <li key={r.id} className="relative pb-5 last:pb-0">
            <span
              aria-hidden
              className={`absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-paper ${
                i === 0 ? "bg-brand" : "bg-line-strong"
              }`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-xs text-ink-3">#{r.revisionNumber}</span>
              {/* R115: 원래 계획서 스케치는 authorId(UUID)를 그대로 보여줬다 —
                  사람이 "누가 이 리비전을 썼는지" 알아볼 방법이 없었다. users/
                  api_keys를 조인해 얻은 이름을 보여준다. 둘 다 null인 경우(작성자
                  계정/키가 나중에 삭제됨, ON DELETE SET NULL)는 빈 문자열로
                  뭉개지 않고 "알 수 없음"으로 정직하게 표시한다. */}
              <span className="text-sm font-medium">{r.authorName ?? r.authorKeyName ?? "알 수 없음"}</span>
              <span className="text-xs text-ink-3" title={isoDate(r.createdAt)}>
                {relativeTime(r.createdAt)}
              </span>
              {i === 0 && <span className="chip chip-on">현재</span>}
            </div>
            {r.message && <p className="mt-0.5 text-sm text-ink-2">{r.message}</p>}
            {i > 0 && currentRevision > 0 && (
              <div className="mt-1.5">
                <RevertButton
                  slug={term.slug}
                  revisionNumber={r.revisionNumber}
                  expectedRevision={currentRevision}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
    </AppShell>
  );
}
