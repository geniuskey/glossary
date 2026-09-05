# Codex 작업 인계

마지막 갱신: 2026-09-05 (Asia/Seoul)

## 다음 Codex 스레드가 먼저 할 일

1. 이 문서를 끝까지 읽는다.
2. 현재 작업 폴더가 실제 저장소인지 `git rev-parse --show-toplevel`로 확인한다.
3. `CLAUDE.md`와 `apps/web/AGENTS.md`를 읽는다.
4. `git status --short`로 기존 미커밋 변경을 확인한다.
5. 기존 변경을 절대 `git reset --hard`, `git checkout --` 등으로 되돌리지 않는다.

## 저장소 이름 변경 상태

- 프로젝트 이름을 `grossary`에서 `glossary`로 변경했다.
- 현재 로컬 저장소 경로: `D:\git\geniuskey\glossary`
- GitHub 저장소: `https://github.com/geniuskey/glossary`
- Git 원격 `origin`: `https://github.com/geniuskey/glossary.git`
- GitHub Pages 홈페이지 설정: `https://geniuskey.github.io/glossary/`
- 현재 브랜치: `main`
- 인계 작성 시점 HEAD: `1566ce4`
- Git 과거 이력은 재작성하지 않았다.
- 활성 추적 파일, 미추적 파일 및 루트 `.env`에서 `grossary` 잔여 참조가 0개임을 확인했다. `.git` 과거 이력과 생성 캐시는 검사 대상에서 제외했다.
- 패키지 이름은 `@glossary/web`, `@glossary/db`, `@glossary/engine`이다.
- 환경 변수 접두사는 `GLOSSARY_*`이다.

현재 `D:\git\geniuskey\grossary`는 내용이 0개인 빈 폴더다. 이전 Codex 프로세스가 Windows 디렉터리 핸들을 잡고 있어 삭제하지 못했다. Codex를 완전히 종료한 뒤 아직 남아 있으면 빈 폴더인지 다시 확인하고 삭제한다. 실제 `.git`과 프로젝트 파일은 모두 새 경로에 있다.

## Docker와 데이터베이스

- Compose 프로젝트: `glossary`
- 실행 중인 DB 컨테이너: `glossary-postgres-1`
- 네트워크: `glossary_default`
- 데이터 볼륨: `glossary_pgdata`
- PostgreSQL 역할: `glossary`
- DB: `glossary`, `glossary_test`
- 포트: 호스트 `5434` → 컨테이너 `5432`
- 인계 작성 시점 컨테이너 상태는 `healthy`였다.
- 데이터 복제 후 `terms` 95건과 적용 마이그레이션 23건을 확인했다.
- 기존 `grossary_pgdata`와 복제용 임시 볼륨은 새 볼륨 검증 후 제거했다. 데이터는 `glossary_pgdata`에 있다.
- 역할 이름 변경으로 무효화된 DB 비밀번호는 루트 `.env`의 새 연결 문자열에 맞춰 재설정했다. 비밀값을 로그나 문서에 출력하지 않는다.

폴더를 `glossary`가 아닌 다른 이름으로 다시 바꿨다면, Docker를 먼저 내리고 이동 후 새 경로에서 다시 올려 bind mount와 Compose 작업 경로를 갱신한다.

```powershell
docker compose down
# 폴더 이동
docker compose up -d --wait --wait-timeout 60
```

## 검증 결과

이름 변경 및 DB 이동 후 다음을 확인했다.

- `pnpm typecheck`: 통과
- `pnpm test`: 전체 통과
  - 웹 테스트 파일 92개
  - 웹 테스트 793개
  - DB 테스트 2개
  - 엔진 테스트 9개
- `pnpm build`: Next.js 프로덕션 빌드와 정적 페이지 48개 생성 성공
- `git diff --check`: 통과

DB 테스트를 직접 실행할 때는 루트 `.env`의 `DATABASE_URL_TEST`를 프로세스 환경에 안전하게 주입해야 한다. 값을 화면에 출력하지 않는다.

## 중요한 미커밋 상태

인계 작성 시점 `git status --short` 항목은 268개다. 이름 변경 전부터 사용자가 작업하던 대량의 수정과 이번 전역 이름 변경이 섞여 있다. 아직 커밋하거나 푸시하지 않았다.

특히 로컬 저장소 이동 중 Windows 파일 처리 문제로 `packages/db`와 `packages/engine` 내용이 잠시 비었다. 다음 방식으로 복구했다.

- HEAD 기준 추적 파일을 복원했다.
- 패키지 이름을 `@glossary/*`로 변경했다.
- 이동 전 미커밋 상태였던 SSO 스키마 변경을 실행 중인 DB 스키마와 앱 테스트를 근거로 재구성했다.
- 원래 미추적 파일명이던 `0021_cooing_killer_shrike.sql`, `0022_handy_fixer.sql`과 대응 snapshot을 다시 만들었다.
- 타입 검사와 전체 테스트로 기능 상태를 검증했다.

후속 검토에서 `0021_cooing_killer_shrike.sql`은 마지막 LF 한 바이트만 빠진 상태였음을 확인해 복원했다. `0021`과 `0022` 모두 SHA-256이 DB 마이그레이션 기록과 일치하며, 현재 DB 스키마도 `packages/db/src/schema/auth.ts`의 `ssoModeEnum`, `ssoConfig.mode`, `ssoConfig.passwordLoginEnabled`와 일치한다.

## 직전 기능 작업

시트 페이지의 고정 50행 페이징을 선택형으로 변경했다.

- 선택 옵션: 50, 100, 250, 500, 1000행
- 기본값: 50행
- URL 파라미터: `pageSize`
- 필터, 정렬, 페이지 이동 시 선택값 유지
- 행 수 변경 시 1페이지로 이동
- 직접 입력된 URL 값은 1~1000으로 제한

주요 파일:

- `apps/web/src/app/sheet/page.tsx`
- `apps/web/src/components/terms-grid.tsx`
- `apps/web/src/lib/terms/list-params.ts`
- `apps/web/tests/list-params.test.ts`
- `apps/web/tests/sheet-page-size-guards.test.ts`

## 새 스레드에 권장하는 첫 요청

다음처럼 시작하면 된다.

> `docs/CODEX_HANDOFF.md`를 읽고 현재 저장소 경로, Git 상태, Docker 상태를 확인한 다음 이어서 작업해 줘. 기존 미커밋 변경은 보존해.

Codex 사용자 데이터가 있는 `C:\Users\geniu\.codex`는 저장소 폴더가 아니므로 이름 변경 과정에서 이동하거나 삭제하지 않는다.
