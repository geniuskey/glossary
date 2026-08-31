# Grossary

특정 조직·팀·제품군이 실제로 사용하는 용어를 함께 정리하는 **셀프호스팅 용어집 관리
플랫폼**. 엑셀과 컨플루언스에 흩어진 용어를 단일 사전으로 모으고, AI-Lint 같은 도구가
API 한 번으로 문서의 표기를 검증할 수 있게 만든다.

**문서: https://geniuskey.github.io/grossary/**

## 언어 지원 범위

현재 버전은 **한국어를 모국어로 쓰면서 기술 용어는 영어와 함께 사용하는 한국 기업
환경**에 최적화되어 있다. UI는 한국어이고, 용어 데이터는 한국어·영어 이름을 나란히
관리한다. 완전한 다국어 UI나 임의 언어 선택 기능은 현재 범위가 아니다.

추후 실제 요청이 생기면 `선택한 모국어 + 영어` 구조로 확장할 수 있지만, 아직 구현된
기능으로 약속하지 않는다. Docker Hub에 사용할 한·영 제품 설명은
[DOCKERHUB.md](./DOCKERHUB.md)에 정리되어 있다.

## 무엇을 하나

1. **단일 사전** — 모든 용어를 한곳에 모으고 등록 시점에 중복을 잡는다.
   제품별 네임스페이스로 나누지 않고, 동음이의어는 `domain` 태그로 구분한다.
2. **기계 판독 가능** — OpenAPI 3.1 스펙을 서빙하고, `POST /terms/lookup` 한 번으로
   문서에 등장한 표기 전체를 확인한다.
3. **위키 수준의 문서성** — 각 용어를 마크다운과 이미지로 설명한다.
4. **역할 분담과 맥락 탐색** — 용어별 담당자·카테고리를 두고, 도메인/카테고리 관계도와
   Confluence용 읽기 전용 임베드 화면으로 정리 범위를 공유한다.

핵심은 **개념(Term)과 표기(Surface)의 분리**다. 엑셀이 무너진 이유는 한 행이 개념이자
표기였기 때문이다. `Auto Exposure` / `AE` / `자동노출` / `오토익스포저`가 모두 하나의
개념을 가리키므로, 사람들이 표준 표기를 몰라도 검색으로 도달한다.

## 요구사항

- Node.js 22 이상
- pnpm 9.12.0 (`packageManager`로 고정)
- Docker (Postgres 16 + `pg_trgm`)

## 빠른 시작

```bash
corepack enable
pnpm install

cp .env.example .env
docker compose up -d

pnpm --filter @grossary/db db:migrate

pnpm --filter @grossary/web dev   # http://localhost:3000
```

관리자 계정을 미리 만들 필요 없다. **처음 접속하면 관리자 계정을 만드는 화면**으로
안내된다(`/setup`). 첫 관리자를 만들고 나면 그 화면은 닫히고 로그인으로 바뀐다.
스크립트로 만들고 싶으면 `scripts/seed-admin.ts`도 여전히 쓸 수 있다.

개발용 Postgres는 호스트 **5434** 포트에 뜬다. 자세한 절차는
[시작하기](https://geniuskey.github.io/grossary/guide/getting-started)를 본다.

> [!WARNING]
> 개발 머신에서 `docker-compose.prod.yml`로 `up`하지 마라. 두 파일이 같은 볼륨 이름
> (`grossary_pgdata`)을 쓴다.

## Confluence 임베드

Confluence iframe 매크로에는 다음처럼 도메인과 카테고리를 선택한 읽기 전용 주소를 넣는다.

```text
https://glossary.example.com/embed?domain=ISP&category=노출%20제어
```

`GROSSARY_EMBED_ANCESTORS=https://confluence.example.com`을 설정해야 해당 Confluence 출처에서만
iframe이 열린다. 여러 출처는 쉼표로 구분한다. 임베드도 로그인 세션을 요구하므로 두 서비스는
가급적 같은 사이트 범위(예: `glossary.example.com`과 `confluence.example.com`)에서 운영한다.

## 저장소 구조

```
apps/web/          Next.js 16 App Router — UI + API 라우트 + zod 스키마 + OpenAPI 스펙
packages/db/       Drizzle 스키마 + 마이그레이션 + 쿼리
packages/engine/   순수 TS — 표기 정규화 (M2에서 매칭·규칙 엔진 확장)
docs/              VitePress 문서 사이트
scripts/           init-db.sql, backup.sh, restore.sh
```

의존 방향은 `web → db → engine` 한 방향이다. `engine`은 아무것도 의존하지 않는다.

> [!IMPORTANT]
> 표기 정규화 함수는 `engine`이 **유일한 소유자**다. DB에 `norm_loose`를 저장할 때 쓴
> 함수와 문서를 정규화하는 함수가 조금이라도 다르면 매칭이 **에러 없이 조용히** 실패한다.
> `packages/db/tests/normalize-parity.test.ts`가 이 일치를 상시 검증한다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm build` | 전체 빌드 (Turborepo) |
| `pnpm test` | 전체 테스트 |
| `pnpm typecheck` | 전체 타입 검사 |
| `pnpm docs:dev` | 문서 사이트 로컬 실행 |
| `pnpm docs:build` | 문서 정적 빌드 (`docs/.vitepress/dist`) |

`packages/db`와 `apps/web` 테스트는 실제 Postgres에 붙는다. `DATABASE_URL_TEST`가
없으면 시작 자체를 거부한다 — 테스트는 개발 DB에 붙지 않는다.

## API

전부 `/api/v1` 아래에 있고, 스펙은 `GET /api/v1/openapi`가 JSON으로 돌려준다.

```bash
curl -s -H "Authorization: Bearer glk_..." \
  -d '{"texts":["AE","이미지센서","AutoExposure"]}' \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/v1/terms/lookup
```

인증은 두 갈래다 — 사람은 세션 쿠키, 도구는 `Authorization: Bearer glk_<prefix>_<secret>`.
모든 에러는 `{ error: { code, message, details? } }` 봉투를 쓴다. 예외 없음.

자세한 것은 [API 레퍼런스](https://geniuskey.github.io/grossary/api/)를 본다.

## Docker Hub 이미지 배포

Docker Hub에는 웹 앱과 마이그레이터를 같은 저장소의 서로 다른 태그로 올린다.

```bash
IMAGE=euiyun/grossary
VERSION=0.1.0

docker build --target app -t "$IMAGE:$VERSION" -t "$IMAGE:latest" .
docker build --target migrator -t "$IMAGE:$VERSION-migrator" -t "$IMAGE:latest-migrator" .

docker push "$IMAGE:$VERSION"
docker push "$IMAGE:$VERSION-migrator"
docker push "$IMAGE:latest"
docker push "$IMAGE:latest-migrator"
```

사내 서버에서는 소스 빌드 없이 `docker-compose.hub.yml`을 사용한다. 운영에서는
`latest`보다 앱·마이그레이터 양쪽을 같은 버전으로 고정하는 편이 안전하다.

```bash
docker pull euiyun/grossary:0.1.0
docker pull euiyun/grossary:0.1.0-migrator
```

```bash
cp .env.dockerhub.example .env
# 이미지 이름, 동일한 버전 태그, POSTGRES_PASSWORD를 수정한다.
# 비공개 Docker Hub 저장소라면 docker login을 먼저 실행한다.
docker compose --env-file .env -f docker-compose.hub.yml pull
docker compose --env-file .env -f docker-compose.hub.yml up -d
```

## 소스에서 직접 배포

사내망 온프레미스 Docker Compose다. 첨부 이미지까지 Postgres에 들어 있어
**`scripts/backup.sh`가 만드는 dump 파일 하나가 회사 용어집 전부다.**

```bash
cp .env.example .env   # POSTGRES_PASSWORD를 실제 값으로
docker compose -f docker-compose.prod.yml up -d --build
```

기동, 백업, 복구, TLS와 CSRF의 현재 상태는
[운영 안내서](https://geniuskey.github.io/grossary/operations)에 있다.

## 진행 상황

- **M1 사전 코어** — 구현됨. DB 스키마, 정규화, 인증·API Key, 용어 CRUD, 검색,
  중복 경고, 엑셀 임포트(dry-run), 프로덕션 Docker, 백업·복구.
- **M2 검증 엔진** — `packages/engine` 전체, `/validate`, `/lexicon`, 미등록 후보 수집.
- **M3 위키 완성도** — CodeMirror Markdown 편집·GFM 미리보기, 이미지 붙여넣기·WebP 첨부,
  리비전 조회/revert는 구현됨. mermaid, diff 화면, 위키 링크·역참조, 병합 UI는 남음.

[로드맵](https://geniuskey.github.io/grossary/guide/roadmap)에 자세한 범위가 있다.
