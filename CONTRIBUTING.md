# Grossary에 기여하기

버그 제보, 문서 수정, 기능 제안과 코드 기여를 환영합니다. 변경을 시작하기 전에 이 문서와
[행동 강령](./CODE_OF_CONDUCT.md)을 읽어 주세요.

## 먼저 이슈를 확인하세요

- 작은 오타·명확한 버그 수정은 바로 Pull Request를 열어도 됩니다.
- 새 기능, 데이터 모델·API 변경, 큰 UI 변경은 구현 전에
  [이슈](https://github.com/geniuskey/grossary/issues)를 열어 문제와 사용 흐름을 합의해 주세요.
- 보안 취약점은 공개 이슈가 아니라 [SECURITY.md](./SECURITY.md)의 비공개 채널을 사용합니다.

## 개발 환경

필요한 도구는 Node.js 22 이상, pnpm 9.12.0, Docker입니다.

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d
pnpm --filter @grossary/db db:migrate
pnpm --filter @grossary/web dev
```

개발 DB는 기본적으로 `localhost:5434/grossary`, 테스트 DB는
`localhost:5434/grossary_test`를 사용합니다. 테스트가 개발 데이터를 건드리지 않도록
`DATABASE_URL_TEST`가 없으면 DB 테스트는 시작되지 않습니다.

## 변경 원칙

1. 기존 사용자 변경을 덮어쓰지 말고 관련 범위만 수정합니다.
2. Term과 Surface의 분리, `web → db → engine` 의존 방향을 유지합니다.
3. 표기 정규화는 `packages/engine`을 단일 소유자로 유지합니다.
4. API를 바꾸면 OpenAPI 스펙과 관련 문서를 함께 바꿉니다.
5. DB 스키마 변경은 Drizzle 마이그레이션과 실제 Postgres 테스트를 포함합니다.
6. UI 변경은 키보드, 포커스, 좁은 화면과 한국어·영어 혼용 데이터를 확인합니다.
7. 사용자에게 보이는 설명은 필요한 규칙·경고만 남기고 자명한 문구를 늘리지 않습니다.
8. 사용자와 운영자에게 영향을 주는 변경은 `CHANGELOG.md`의 `Unreleased`에 기록합니다.

## 검사

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm docs:build
```

DB 없이 빠르게 확인하려면 `pnpm --filter @grossary/engine test`를 먼저 실행할 수 있습니다.
DB 테스트 방법은 [테스트 문서](https://geniuskey.github.io/grossary/guide/testing)를 참고하세요.

## Pull Request

- 한 PR에는 하나의 문제를 해결하는 변경만 담습니다.
- 제목은 결과가 드러나는 동사형으로 씁니다.
- 본문에 문제, 해결 방식, 검증 결과와 UI 변경 전후 이미지를 적습니다.
- 호환성 변화, 마이그레이션, 새 환경 변수와 운영 영향은 별도로 표시합니다.
- 자동 생성된 `docs/.vitepress/dist`, `.next`, 비밀 값이 든 `.env`는 커밋하지 않습니다.

기여물을 제출하면 본인이 해당 변경을 제공할 권한이 있으며, 프로젝트의 `LICENSE`와 같은
조건으로 배포될 수 있음에 동의한 것으로 간주합니다.
