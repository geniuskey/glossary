import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/app-shell";
import { InfoFooter } from "@/components/info-links";
import { needsSetup } from "@/lib/auth/setup";
import { SignupForm } from "./signup-form";
import { loadPasswordLoginEnabled } from "@/lib/auth/sso/config";

// needsSetup(DB 조회)이 빌드 시 프리렌더로 실행되지 않도록 런타임 렌더로 고정한다.
export const dynamic = "force-dynamic";

// R131: 인증 게이트(getCurrentUser/redirect("/login")) 대상이 아니다 — 로그인하지
// 않은 사람을 위한 화면이다(tests/screen-guards.test.ts의 PROTO_B_ALLOWLIST).
// 계정이 하나도 없으면 여기가 아니라 최초 설정으로 보낸다: 첫 계정은 관리자여야
// 하는데 이 화면은 editor만 만든다.
export default async function SignupPage() {
  if (!(await loadPasswordLoginEnabled())) redirect("/login");
  if (await needsSetup()) redirect("/setup");

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-14">
      <div className="w-full max-w-sm animate-fade-up">
        <header className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={38} />
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Glossary</h1>
          <p className="mt-2 text-sm text-ink-2">개념 하나에 표기 여럿, 함께 관리하는 사전</p>
        </header>

        <div className="card p-6 shadow-pop">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">계정 만들기</h2>
          <p className="mt-1 text-xs text-ink-3">계정이 있으면 누구나 용어를 고칠 수 있습니다.</p>

          {/* 승인 워크플로우가 없는 대신 이력과 되돌리기가 안전판이라는 것을 여기서
              미리 말한다 — 가입하는 사람이 "내가 고쳐도 되나"를 묻지 않게. */}
          <p className="note mt-4 border-line bg-panel-2 text-[13px] leading-relaxed text-ink-2">
            모든 수정은 이름과 함께 이력에 남고, 언제든 되돌릴 수 있습니다.
          </p>

          <SignupForm />

          <p className="mt-5 border-t border-line pt-4 text-center text-xs text-ink-3">
            이미 계정이 있으신가요?{" "}
            <Link href="/login" className="link font-medium">
              로그인
            </Link>
          </p>
        </div>
        <InfoFooter className="mt-6" />
      </div>
    </main>
  );
}
