import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermForm, type TermFormInitial } from "@/components/term-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { listAssignableUsers } from "@/lib/terms/owners";
import { pickExplicitSurfaces } from "@/lib/terms/surfaces";
import { listRevisions } from "@/lib/terms/update";
import { displayName } from "@/lib/ui/format";

export default async function EditTermPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const term = await getTermByIdOrSlug(slug);
  if (!term) notFound();

  // R109: 편집 폼은 지금 이 서버 렌더 시점의 리비전 번호를 expectedRevision으로
  // 들고 가야, 그 사이 다른 사람이 먼저 저장했을 때 PATCH가 조용히 덮어쓰지
  // 않고 409로 막을 수 있다. listRevisions는 최신순이므로 [0]이 현재 리비전이다.
  const [revisions, assignees] = await Promise.all([listRevisions(term.id), listAssignableUsers()]);
  const expectedRevision = revisions[0]?.revisionNumber ?? 0;

  // R110: 저장된 표기 중 "표준 이름 필드에서 다시 파생 가능한 것"은 초기값에서
  // 뺀다 — 안 그러면 파생 표기가 명시 표기인 것처럼 폼에 다시 나타나고, 그
  // 상태로 그냥 저장하면 updateTerm이 그걸 storedExplicit으로 취급해 버려
  // (원래는 파생이던 표기가) 영구히 명시 표기로 굳어버린다. update.ts의
  // updateTerm과 정확히 같은 pickExplicitSurfaces를 쓴다.
  const initial: TermFormInitial = {
    slug: term.slug,
    expectedRevision,
    termType: term.termType,
    nameEn: term.nameEn ?? "",
    nameKo: term.nameKo ?? "",
    fullNameEn: term.fullNameEn ?? "",
    fullNameKo: term.fullNameKo ?? "",
    domain: term.domain.join(", "),
    category: term.category ?? "",
    ownerId: term.ownerId ?? "",
    status: term.status,
    definitionMd: term.definitionMd ?? "",
    bodyMd: term.bodyMd ?? "",
    surfaces: pickExplicitSurfaces(term, term.surfaces).map((s) => ({ text: s.text, lang: s.lang, kind: s.kind })),
  };

  return (
    <AppShell user={user} title="용어 편집" current="sheet">
      <nav className="mb-5 text-xs text-ink-3">
        <Link href="/sheet" className="link">
          시트
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/w/${term.slug}`} className="link">
          {displayName(term)}
        </Link>
        <span className="mx-1.5">/</span>
        <span>편집</span>
      </nav>

      <header className="mb-5 flex items-end justify-between border-b border-line pb-4">
        <div>
          <p className="text-xl font-semibold tracking-tight lg:hidden">용어 편집</p>
          {/* 함께 쓰는 사전이라 "지금 몇 번째 판을 고치는 중인지"가 보여야
              409(다른 사람이 먼저 저장함)를 만났을 때 상황이 납득된다. */}
          <p className="mt-0.5 text-xs text-ink-3">리비전 #{expectedRevision} 기준</p>
        </div>
        <div className="flex gap-1.5">
          {/* R135: 시트에서 용어를 누르면 곧장 이 화면으로 온다(보기 화면을
              거치지 않는다) — 읽기만 하려던 사람이 되돌아갈 문이 있어야 한다. */}
          <Link href={`/w/${term.slug}`} className="btn-ghost btn-sm">
            보기
          </Link>
          <Link href={`/history/${term.slug}`} className="btn-ghost btn-sm">
            이력
          </Link>
        </div>
      </header>

      <TermForm initial={initial} assignees={assignees} />
    </AppShell>
  );
}
