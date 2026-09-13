# 문서 관리 안내

공개 문서는 VitePress로 빌드한다. 사이트 첫 화면은 `index.md`이며 이 파일은 저장소
기여자를 위한 안내로 공개 빌드에서 제외한다.

## 문서 배치

| 위치 | 대상과 내용 |
|---|---|
| `index.md`, `guide/index.md` | 제품 소개와 목적별 진입점 |
| `help.md`, `guide/collaboration.md`, `guide/ai.md`, `guide/data-model.md` | 사용자 작업과 개념 |
| `guide/getting-started.md`, `guide/architecture.md`, `guide/testing.md` | 개발 환경과 구현 구조 |
| `api/` | API 계약과 호출 예시 |
| `operations.md`, `guide/sso.md` | 설치·인증 설정·백업·복구 |
| `guide/roadmap.md` | 구현 상태와 후속 계획 |
| `support.md` | 문의와 오류 신고 |
| `superpowers/`, `reviews/`, `product-review-*.md`, `CODEX_HANDOFF.md` | 당시의 설계·검토·인계 기록. 공개 빌드와 검색에서 제외 |

기록 문서는 작성 당시의 상태를 보존한다. 현재 사용법의 근거로 삼기 전에 코드와
대조하고, 확정된 변경 사항은 해당 공개 가이드에 반영한다. 공개 범위와 메뉴는
`.vitepress/config.mts`에서 관리한다.

## 수정과 검증

1. 사용자 작업은 도움말·가이드, 요청·응답 필드는 API, 배포 절차는 운영 안내에 작성한다.
   같은 설명을 복제하기보다 해당 문서로 연결한다.
2. 구현된 기능과 계획을 명시적으로 구분한다. 설정과 명령은 저장소의 환경 예제,
   Compose 파일, 스크립트, `package.json`과 대조한다.
3. 공개 페이지를 추가하면 메뉴 또는 관련 안내 페이지에 링크를 추가한다.
   내부 링크는 `/guide/ai`처럼 사이트 루트 기준으로 쓰고 `/glossary/`는 붙이지 않는다.
4. `pnpm docs:build`로 빌드와 페이지 링크를 검사한다. 헤딩 앵커는 별도로 확인한다.
5. `pnpm docs:preview`를 실행하고 표시된 주소의 `/glossary/`에서 메뉴·검색·본문을 확인한다.

생성된 `.vitepress/dist/`는 수정하거나 커밋하지 않는다. `main`에 문서 변경이 반영되면
`.github/workflows/docs.yml`이 GitHub Pages 배포를 수행한다.
