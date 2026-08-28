import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth/setup";
import { SetupForm } from "./setup-form";

// needsSetup(DB 조회)이 빌드 시 프리렌더로 실행되지 않도록 런타임 렌더로 고정한다.
export const dynamic = "force-dynamic";

// 인증 게이트(getCurrentUser/redirect("/login")) 대상이 아니다 — 아직 계정이
// 없을 때만 열리는 최초 설정 화면이다. 설정이 끝났으면 로그인으로 보낸다.
// (tests/screen-guards.test.ts의 PROTO_B_ALLOWLIST에 등록되어 있다.)
export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return <SetupForm />;
}
