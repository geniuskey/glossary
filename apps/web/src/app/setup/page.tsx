import { redirect } from "next/navigation";
import { BrandMark } from "@/components/app-shell";
import { InfoFooter } from "@/components/info-links";
import { needsSetup } from "@/lib/auth/setup";
import { SetupForm } from "./setup-form";
import { initialAdminEmail, ssoLoginUrl } from "@/lib/auth/policy";
import { loadSsoConfig, resolveLoginSsoMode, resolvePasswordLoginEnabled } from "@/lib/auth/sso/config";

// needsSetup(DB 조회)이 빌드 시 프리렌더로 실행되지 않도록 런타임 렌더로 고정한다.
export const dynamic = "force-dynamic";

// 인증 게이트(getCurrentUser/redirect("/login")) 대상이 아니다 — 아직 계정이
// 없을 때만 열리는 최초 설정 화면이다. 설정이 끝났으면 로그인으로 보낸다.
// (tests/screen-guards.test.ts의 PROTO_B_ALLOWLIST에 등록되어 있다.)
export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  const ssoConfig = await loadSsoConfig();
  if (!resolvePasswordLoginEnabled(ssoConfig)) {
    const ssoHref = ssoLoginUrl(resolveLoginSsoMode(ssoConfig, true));
    if (initialAdminEmail() && ssoHref) redirect(ssoHref);
    redirect("/login?config=sso-required");
  }

  // 로그인 화면과 같은 틀(브랜드 → 카드)을 쓰되, 한 번만 하는 일이라는 안내를
  // 카드 안에 둔다 — 처음 온 사람은 여기가 가입 화면인지 설정 화면인지 모른다.
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-14">
      <div className="w-full max-w-sm animate-fade-up">
        <header className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={38} />
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Glossary</h1>
          <p className="mt-2 text-sm text-ink-2">개념 하나에 표기 여럿, 함께 관리하는 사전</p>
        </header>

        <div className="card p-6 shadow-pop">
          <span className="chip chip-on">최초 설정</span>
          <h2 className="mt-3 text-[15px] font-semibold tracking-tight text-ink">첫 관리자 계정 만들기</h2>
          <p className="mt-1 text-xs text-ink-3">이 계정으로 용어집을 관리하게 됩니다.</p>

          <p className="note mt-4 border-line bg-panel-2 text-[13px] leading-relaxed text-ink-2">
            계정이 하나도 없을 때만 열리는 화면입니다. 계정을 만들고 나면 다음부터는 로그인 화면이 열립니다.
          </p>

          <SetupForm />
        </div>
        <InfoFooter className="mt-6" />
      </div>
    </main>
  );
}
