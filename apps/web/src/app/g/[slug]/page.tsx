import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TermDetailPage } from "@/components/term-detail-page";
import { termPageMetadata } from "@/lib/terms/page-metadata";

export function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return termPageMetadata(params);
}

export default async function GlossaryTermPage(props: Parameters<typeof TermDetailPage>[0]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return TermDetailPage(props);
}
