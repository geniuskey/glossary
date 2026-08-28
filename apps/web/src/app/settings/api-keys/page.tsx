import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ApiKeysPanel } from "./api-keys-panel";

export const metadata = { title: "API 키" };

// 원래 이 화면은 파일 전체가 "use client"라 서버 전용 getCurrentUser를 부를 수
// 없었고, 그래서 screen-guards.test.ts의 PROTO B 허용목록에 예외로 올라 있었다
// (호출하는 /api/v1/keys*가 requireAuth로 막혀 있어 유출은 아니지만, 로그인
// 없이 열면 셸에 사용자 칩도 로그아웃도 없는 반쪽 화면이 나왔다). 상태를 갖는
// 조각만 api-keys-panel.tsx로 떼어내면 이 파일은 평범한 Server Component가 되어
// 다른 화면과 같은 인증 게이트를 받는다 — 허용목록에서도 뺐다.
export default async function ApiKeysPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user} current="keys">
      <header className="mb-7 border-b border-line pb-5">
        <h1 className="text-xl font-semibold tracking-tight">API 키</h1>
        <p className="mt-1.5 max-w-xl text-sm text-ink-2">
          AI 린트나 외부 도구가 이 사전을 읽어 문서의 표기를 검사할 때 쓰는 키입니다. 용도마다 따로
          발급하고, 더 쓰지 않는 키는 폐기하세요.
        </p>
      </header>

      <ApiKeysPanel />
    </AppShell>
  );
}
