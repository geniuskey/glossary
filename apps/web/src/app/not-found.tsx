import Link from "next/link";

// notFound()는 용어 상세/이력/편집 세 화면이 부른다. 이 파일이 없으면 Next의
// 기본 404가 나오는데, 그 화면만 디자인 밖으로 튀어나와 "앱이 깨졌다"처럼
// 보인다. 여기서는 getCurrentUser를 부르지 않는다 — /_not-found는 정적으로
// 렌더되는 경로라 쿠키를 읽으면 빌드 시점에 동적 렌더로 끌려간다.
export const metadata = { title: "찾을 수 없음" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-5xl font-semibold text-ink-3">404</p>
      <h1 className="mt-4 text-lg font-semibold tracking-tight">그 용어를 찾지 못했습니다</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-2">
        주소가 바뀌었거나, 다른 사람이 이미 지운 항목일 수 있습니다.
      </p>
      <Link href="/terms" className="btn-primary mt-5">
        용어집으로
      </Link>
    </main>
  );
}
