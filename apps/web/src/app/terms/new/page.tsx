import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermForm } from "@/components/term-form";
import { getCurrentUser } from "@/lib/auth/current-user";

// R92: "new"는 app/terms/ 밑 정적 세그먼트라 create.ts의 RESERVED_SLUGS에 이미
// 등록돼 있다("new") — 이 화면을 추가한다고 새로 등록할 이름은 없다.
export default async function NewTermPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <h1 className="mb-6 text-xl font-semibold">새 용어</h1>
      <TermForm />
    </AppShell>
  );
}
