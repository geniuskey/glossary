import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CategoriesPanel } from "@/components/categories-panel";
import { DomainsPanel } from "@/components/domains-panel";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listManagedBusinessCategories } from "@/lib/terms/categories";
import { listManagedDomains } from "@/lib/terms/domains";
import { cx } from "@/lib/ui/format";

export const metadata = { title: "분류 체계" };

const VIEWS = [
  { key: "domains", label: "도메인" },
  { key: "categories", label: "업무 분류" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function ClassificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const resolvedParams = await searchParams;
  const rawView = resolvedParams.view;
  const rawNew = resolvedParams.new;
  const initialNewValue = (Array.isArray(rawNew) ? rawNew[0] : rawNew)?.slice(0, 100) ?? "";
  const requestedView = Array.isArray(rawView) ? rawView[0] : rawView;
  const view: View = requestedView === "categories" ? "categories" : "domains";
  const [domains, categories] = await Promise.all([listManagedDomains(), listManagedBusinessCategories()]);

  return (
    <AppShell user={user} title="분류 체계" current="classifications" roomy>
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight lg:hidden">분류 체계</h1>
        <nav className="mt-3 flex border-b border-line" aria-label="분류 체계 메뉴">
          {VIEWS.map((item) => (
            <Link
              key={item.key}
              href={item.key === "domains" ? "/classifications" : "/classifications?view=categories"}
              aria-current={view === item.key ? "page" : undefined}
              className={cx(
                "relative -mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition",
                view === item.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {view === "domains" && <DomainsPanel initialDomains={domains} initialNewLabel={initialNewValue} isAdmin={user.role === "admin"} />}
      {view === "categories" && <CategoriesPanel initialCategories={categories} initialNewLabel={initialNewValue} isAdmin={user.role === "admin"} />}
    </AppShell>
  );
}
