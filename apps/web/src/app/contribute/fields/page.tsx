import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { listBusinessCategories } from "@/lib/terms/categories";
import { listClassificationReviewCandidates, type ClassificationReviewKind } from "@/lib/terms/classification-review";
import { listDomains } from "@/lib/terms/domains";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDefinitionReviewCandidates } from "@/lib/ai/definition-review";
import { HelpTip } from "@/components/help-tip";
import { ClassificationReviewPanel } from "../classification-review-panel";
import { DefinitionReviewPanel } from "../definition-review-panel";

export const metadata: Metadata = {
  title: "필드 보완",
  description: "한줄 정의·도메인·업무 분류가 비어 있는 용어를 집중해서 보완합니다.",
};

type FieldKey = "definition" | "domain" | "category";

const FIELD_ITEMS: ReadonlyArray<{
  key: FieldKey;
  label: string;
  summary: string;
  help: string;
  href: string;
}> = [
  {
    key: "definition",
    label: "한줄 정의",
    summary: "용어를 한 문장으로 정의",
    help: "본문 근거와 AI 제안을 비교해 한줄 정의를 다듬고 승인합니다.",
    href: "/contribute/fields?field=definition",
  },
  {
    key: "domain",
    label: "도메인",
    summary: "제품·기술·사업 영역 분류",
    help: "도메인이 비어 있는 용어만 표시합니다. 참고 내용을 보고 도메인을 선택해 저장하면 다음 용어로 넘어갑니다.",
    href: "/contribute/fields?field=domain",
  },
  {
    key: "category",
    label: "업무 분류",
    summary: "용어가 쓰이는 업무 분야 분류",
    help: "업무 분류가 비어 있는 용어만 표시합니다. 현재 도메인과 참고 내용을 보고 업무 분류를 선택해 저장합니다.",
    href: "/contribute/fields?field=category",
  },
];

function scalar(params: Record<string, string | string[] | undefined>, key: string): string {
  return typeof params[key] === "string" ? params[key] : "";
}

function parseField(value: string): FieldKey | undefined {
  return value === "definition" || value === "domain" || value === "category" ? value : undefined;
}

export default async function FieldCompletionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const field = parseField(scalar(params, "field"));
  const query = scalar(params, "q").slice(0, 200);
  const classificationKind: ClassificationReviewKind | undefined = field === "domain" ? "domain" : field === "category" ? "category" : undefined;
  const selectedField = field ? FIELD_ITEMS.find((item) => item.key === field) : undefined;
  const [storedAi, definitionCandidates, classificationCandidates, categories, domains] = await Promise.all([
    loadAiConfig(),
    field === "definition" ? listDefinitionReviewCandidates() : Promise.resolve([]),
    classificationKind ? listClassificationReviewCandidates(classificationKind, 200, query) : Promise.resolve([]),
    classificationKind ? listBusinessCategories() : Promise.resolve([]),
    classificationKind ? listDomains() : Promise.resolve([]),
  ]);
  const ai = publicAiConfig(storedAi);
  const aiAvailable = Boolean(ai.enabled && ai.secretsReadable);

  return (
    <AppShell user={user} title="필드 보완" current="field-completion" roomy>
      <nav aria-label="필드 보완 작업" className="mb-6 flex min-w-0 overflow-x-auto overflow-y-hidden border-b border-line">
        <Link href="/contribute/fields" aria-current={!field ? "page" : undefined} className={tabClass(!field)}>
          개요
        </Link>
        {FIELD_ITEMS.map((item) => (
          <Link key={item.key} href={item.href} aria-current={field === item.key ? "page" : undefined} className={tabClass(field === item.key)}>
            {item.label}
          </Link>
        ))}
      </nav>

      {field && selectedField ? (
        <section aria-labelledby="field-work-heading">
          <div className="mb-4 flex items-center gap-2">
            <h2 id="field-work-heading" className="text-lg font-semibold text-ink">{selectedField.label} 보완</h2>
            <HelpTip text={selectedField.help} />
          </div>

          {field === "definition" ? (
            <DefinitionReviewPanel initialCandidates={definitionCandidates} aiAvailable={aiAvailable} />
          ) : (
            <ClassificationReviewPanel
              key={`${field}:${query}`}
              kind={classificationKind!}
              initialCandidates={classificationCandidates}
              query={query}
              aiAvailable={aiAvailable}
              domainOptions={domains.map((domain) => ({ value: domain.label, label: domain.label }))}
              categoryOptions={categories.map((category) => ({ value: category.key, label: category.labelKo, secondaryLabel: category.labelEn }))}
              basePath="/contribute/fields"
            />
          )}
        </section>
      ) : (
        <FieldOverview />
      )}
    </AppShell>
  );
}

function tabClass(active: boolean): string {
  return `relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${active ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink"}`;
}

function FieldOverview() {
  return (
    <section aria-labelledby="field-overview-title">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 id="field-overview-title" className="text-2xl font-semibold tracking-tight text-ink text-balance">필드 보완</h1>
            <HelpTip text="비어 있는 한줄 정의·도메인·업무 분류를 골라 보완합니다. 세부 기준과 AI 추천은 각 작업 화면의 ?에서 확인합니다." />
          </div>
          <p className="mt-2 text-sm text-ink-2">필요한 필드만 골라 보완합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/contribute" className="btn-quiet btn-sm">함께 정리</Link>
          <Link href="/contribute?tab=queue" className="btn-quiet btn-sm">AI 작업</Link>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        {FIELD_ITEMS.map((item, index) => (
          <article key={item.key} className="card flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <p className="shrink-0 text-xs font-semibold tracking-[0.14em] text-brand">0{index + 1}</p>
                <h3 className="truncate text-base font-semibold text-ink">{item.label}</h3>
              </div>
              <p className="mt-1 pl-7 text-xs text-ink-2">{item.summary}</p>
            </div>
            <Link href={item.href} className="btn-quiet btn-sm shrink-0">열기 <span aria-hidden>→</span></Link>
          </article>
        ))}
      </div>
    </section>
  );
}
