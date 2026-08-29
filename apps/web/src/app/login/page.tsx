import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/app-shell";
import { needsSetup } from "@/lib/auth/setup";
import { loadSsoConfig } from "@/lib/auth/sso/config";
import { ssoErrorMessage } from "@/lib/auth/sso/errors";
import { LoginForm } from "./login-form";

// needsSetup(DB 조회)이 빌드 시 프리렌더로 실행되지 않도록 런타임 렌더로 고정한다.
export const dynamic = "force-dynamic";

// 아직 관리자 계정이 없으면 로그인 대신 최초 설정 화면으로 보낸다.
// 어느 경로로 들어와도(/, /login, /terms→/login) 결국 /setup으로 모인다.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (await needsSetup()) redirect("/setup");

  const raw = await searchParams;
  // R132: SSO 콜백은 실패하면 ?sso=<코드>로 여기 되돌린다(브라우저 이동이라
  // JSON 에러를 보여줄 데가 없다). 모르는 코드는 일반 문구로 뭉갠다.
  const ssoError = ssoErrorMessage(Array.isArray(raw.sso) ? raw.sso[0] : raw.sso);
  const sso = await loadSsoConfig();

  // 카드 바깥(브랜드·설명)은 상호작용이 없어 서버 컴포넌트에 남긴다 — 이 화면의
  // 클라이언트 번들이 입력 처리만 싣도록. app-shell.tsx가 셸을 서버에 두는 것과 같은 이유다.
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-14">
      <div className="w-full max-w-sm animate-fade-up">
        <header className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={38} />
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Grossary</h1>
          <p className="mt-2 text-sm text-ink-2">개념 하나에 표기 여럿, 함께 관리하는 사전</p>
        </header>

        <div className="card p-6 shadow-pop">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">로그인</h2>
          <p className="mt-1 text-xs text-ink-3">등록된 계정으로 용어집에 들어갑니다.</p>

          {ssoError && (
            <p className="note-danger mt-4" role="alert">
              {ssoError}
            </p>
          )}

          {sso.enabled && (
            <div className="mt-4">
              {/* 링크는 /api/가 아니라 /auth/sso/start다 — 브라우저 이동 창구는
                  JSON 에러 봉투를 쓸 수 없어 API 바깥에 둔다(PROTO A도 /api/ href를 금한다). */}
              <a href="/auth/sso/start" className="btn-ghost w-full py-2.5">
                {sso.buttonLabel}
              </a>
              <p className="mt-4 flex items-center gap-3 text-[11px] text-ink-3">
                <span className="h-px flex-1 bg-line" />
                또는 이메일로
                <span className="h-px flex-1 bg-line" />
              </p>
            </div>
          )}

          <LoginForm />

          {/* R131: 개방 편집 위키라 계정 발급을 관리자가 쥐고 있지 않다. 처음 온
              사람이 로그인 화면에서 막히지 않도록 가입 경로를 여기서 연다. */}
          <p className="mt-5 border-t border-line pt-4 text-center text-xs text-ink-3">
            계정이 없으신가요?{" "}
            <Link href="/signup" className="link font-medium">
              계정 만들기
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
