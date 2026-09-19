import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TermDetailPage } from "@/components/term-detail-page";

export default async function GlossaryTermPage(props: Parameters<typeof TermDetailPage>[0]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return TermDetailPage(props);
}
