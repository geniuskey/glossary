import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listCandidates } from "@/lib/validation/candidates";
import { CandidateCheckPanel, type CandidateView } from "@/components/candidate-check-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "문서 점검" };

export default async function CheckPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const raw = await searchParams;
  const rawQ = Array.isArray(raw.q) ? raw.q[0] : raw.q;
  const q = (rawQ ?? "").trim().slice(0, 120);
  const rawPage = Array.isArray(raw.page) ? raw.page[0] : raw.page;
  const parsedPage = Number(rawPage ?? "1");
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const result = await listCandidates({ q: q || undefined, status: "open", page, pageSize: 30 });
  const items: CandidateView[] = result.items.map((candidate) => ({
    id: candidate.id,
    text: candidate.text,
    status: candidate.status,
    occurrenceCount: candidate.occurrenceCount,
    sampleContext: candidate.sampleContext,
    source: candidate.sourcePath,
    firstSeenAt: candidate.firstSeenAt.toISOString(),
    lastSeenAt: candidate.lastSeenAt.toISOString(),
    lexiconVersion: candidate.lexiconVersion,
    promotedTermId: candidate.promotedTermId,
    decisionNote: candidate.decisionNote,
  }));

  return (
    <AppShell user={user} title="문서 점검" current="check" roomy>
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink lg:hidden">문서 점검</h2>
      <CandidateCheckPanel
        initialCandidates={items}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        query={q}
      />
    </AppShell>
  );
}
