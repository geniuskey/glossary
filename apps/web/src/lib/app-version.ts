import webPackage from "../../package.json";

// NEXT_PUBLIC_* 값은 Next.js가 빌드 시 클라이언트 번들에 고정한다. 릴리스
// 파이프라인은 이미지 태그를 주입할 수 있고, 로컬 개발은 package.json을 쓴다.
const configuredVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();

export const APP_VERSION = configuredVersion || webPackage.version;
export const APP_VERSION_LABEL = APP_VERSION.startsWith("v") ? APP_VERSION : `v${APP_VERSION}`;
