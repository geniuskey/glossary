import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

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

  redirect("/settings#api-keys");
}
