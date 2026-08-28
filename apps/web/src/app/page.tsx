import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/auth/setup";

// needsSetup은 요청 시 DB를 읽는다. 빌드 시(도커 이미지 빌드엔 DB가 없다)
// 프리렌더로 실행되지 않도록 런타임 렌더로 고정한다.
export const dynamic = "force-dynamic";

export default async function Home() {
  if (await needsSetup()) redirect("/setup");
  redirect("/terms");
}
