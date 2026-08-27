import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { listRevisions } from "@/lib/terms/update";

export default async function TermHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const term = await getTermByIdOrSlug(slug);
  if (!term) notFound();

  const revisions = await listRevisions(term.id);

  return (
    <AppShell user={user}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{term.nameEn ?? term.nameKo} 이력</h1>
        <Link href={`/terms/${term.slug}`} className="text-sm text-slate-600 hover:text-slate-900">
          용어로 돌아가기
        </Link>
      </div>

      <ul className="divide-y divide-slate-200 rounded border border-slate-200">
        {revisions.map((r) => (
          <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              #{r.revisionNumber} {r.message ?? ""}
            </span>
            {/* R115: 원래 계획서 스케치는 authorId(UUID)를 그대로 보여줬다 —
                사람이 "누가 이 리비전을 썼는지" 알아볼 방법이 없었다. users/
                api_keys를 조인해 얻은 이름을 보여준다. 둘 다 null인 경우(작성자
                계정/키가 나중에 삭제됨, ON DELETE SET NULL)는 빈 문자열로
                뭉개지 않고 "알 수 없음"으로 정직하게 표시한다. */}
            <span className="text-slate-500">
              {r.authorName ?? r.authorKeyName ?? "알 수 없음"} · {r.createdAt.toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
