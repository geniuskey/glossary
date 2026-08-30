import { NextResponse } from "next/server";
import { embedFrameAncestors } from "@/lib/embed/frame-ancestors";

/** Docker Hub 이미지에서도 런타임 환경변수로 Confluence 출처를 바꿀 수 있게 한다. */
export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", `frame-ancestors ${embedFrameAncestors()}`);
  return response;
}

export const config = { matcher: "/embed/:path*" };
