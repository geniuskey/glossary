import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth/setup";
import { LoginForm } from "./login-form";

// needsSetup(DB 조회)이 빌드 시 프리렌더로 실행되지 않도록 런타임 렌더로 고정한다.
export const dynamic = "force-dynamic";

// 아직 관리자 계정이 없으면 로그인 대신 최초 설정 화면으로 보낸다.
// 어느 경로로 들어와도(/, /login, /terms→/login) 결국 /setup으로 모인다.
export default async function LoginPage() {
  if (await needsSetup()) redirect("/setup");

  // 카드 바깥(브랜드·설명)은 상호작용이 없어 서버 컴포넌트에 남긴다 — 이 화면의
  // 클라이언트 번들이 입력 처리만 싣도록. app-shell.tsx가 셸을 서버에 두는 것과 같은 이유다.
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-14">
      <div className="w-full max-w-sm animate-fade-up">
        <header className="mb-6 flex flex-col items-center text-center">
          <BrandMark />
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Grossary</h1>
          <p className="mt-2 text-sm text-ink-2">개념 하나에 표기 여럿, 함께 관리하는 사전</p>
        </header>

        <div className="card p-6 shadow-pop">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">로그인</h2>
          <p className="mt-1 text-xs text-ink-3">등록된 계정으로 용어집에 들어갑니다.</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}

/** app-shell.tsx의 마크와 같은 그림(색인 카드 세 장). 셸이 없는 화면이라
 *  export를 새로 뚫는 대신 같은 SVG를 이 파일에 둔다. */
function BrandMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 26 26" aria-hidden className="shrink-0">
      <rect x="3" y="6" width="18" height="15" rx="2.5" className="fill-brand/20" />
      <rect x="4.5" y="3.5" width="18" height="15" rx="2.5" className="fill-panel stroke-brand" strokeWidth="1.5" />
      <path d="M8.5 8.5h10M8.5 11.5h10M8.5 14.5h6" className="stroke-brand" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
