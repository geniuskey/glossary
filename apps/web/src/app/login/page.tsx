import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth/setup";
import { LoginForm } from "./login-form";

// needsSetup(DB 조회)이 빌드 시 프리렌더로 실행되지 않도록 런타임 렌더로 고정한다.
export const dynamic = "force-dynamic";

// 아직 관리자 계정이 없으면 로그인 대신 최초 설정 화면으로 보낸다.
// 어느 경로로 들어와도(/, /login, /terms→/login) 결국 /setup으로 모인다.
export default async function LoginPage() {
  if (await needsSetup()) redirect("/setup");
  return <LoginForm />;
}
