# 운영 안내서

사내망 온프레미스 Docker 배포 기준이다. 첨부 이미지까지 Postgres에 들어 있으므로
**`scripts/backup.sh`가 만드는 dump 파일 하나가 회사 용어집 전부다.**

## Docker Hub 이미지로 기동

Docker Hub 배포는 웹 앱과 마이그레이터 두 태그를 같은 버전으로 맞춘다. 서버에는
소스 코드가 필요 없고 `docker-compose.hub.yml`과 환경 파일만 있으면 된다.

```bash
curl -LO https://raw.githubusercontent.com/geniuskey/grossary/main/docker-compose.hub.yml
curl -L https://raw.githubusercontent.com/geniuskey/grossary/main/.env.dockerhub.example -o .env

# .env에서 Docker Hub 이미지 두 개와 비밀번호를 수정한다.
docker compose --env-file .env -f docker-compose.hub.yml pull
docker compose --env-file .env -f docker-compose.hub.yml up -d
```

운영에서는 `latest` 대신 아래처럼 앱과 마이그레이터를 같은 버전으로 고정한다.

```dotenv
GROSSARY_IMAGE=euiyun/grossary:0.1.0
GROSSARY_MIGRATOR_IMAGE=euiyun/grossary:0.1.0-migrator
```

`database-init`이 `pg_trgm` 확장을 준비하고, `migrator`가 성공한 뒤에만 `app`이
시작된다. 데이터는 `grossary_hub_pgdata` 볼륨에 보존된다.

## 소스에서 직접 빌드해 기동

```bash
cp .env.example .env
# .env의 POSTGRES_PASSWORD를 실제 값으로 바꾼다.
# 값이 비어 있으면 스택이 기동에 실패한다(의도된 것이다 — R128).

docker compose -f docker-compose.prod.yml up -d --build
```

`migrator` 컨테이너가 먼저 완료된 뒤에 `app`이 뜬다. 마이그레이션이 실패하면
`app`은 아예 시작하지 않는다.

> **개발 머신에서 이 파일로 `up`하지 마라.** `docker-compose.prod.yml`은 개발용
> `docker-compose.yml`과 같은 볼륨 이름(`grossary_pgdata`)을 쓴다. 전역 제약이
> 볼륨 이름을 디렉터리명에서 파생하지 말고 고정하라고 정했기 때문이고,
> 프로덕션은 자기 호스트에서 도는 것을 전제한다.

### 최초 관리자 계정 만들기

스택을 띄운 뒤 **브라우저로 처음 접속하면** 관리자 만들기 화면(`/setup`)이 뜬다.
이메일·이름·비밀번호(8자 이상)를 넣으면 첫 관리자가 만들어지고 바로 로그인된다.
계정을 미리 시딩할 필요가 없다 — 이미지를 받아 `up`하면 그대로 동작한다.

> **`/setup`은 사용자 테이블이 비어 있을 때만 열린다.** 첫 관리자가 생기면 그 뒤로는
> `/setup`이 로그인으로 리다이렉트되고 `POST /api/v1/setup`은 403이다. 동시 요청도
> advisory lock으로 직렬화되어 관리자는 한 번만 만들어진다.
>
> **다만 설정을 끝내기 전 창구는 열려 있다 — "먼저 도달한 사람이 관리자"다.** 스택을
> 올린 직후 곧바로 접속해 첫 관리자를 만들어라. 그때까지는 사내망 접근 통제에
> 의존한다(레이트 리밋·감사 로그 없음 — 아래 참조).

스크립트로(자동화·헤드리스) 만들고 싶으면 아래처럼 시딩할 수도 있다. `tsx`는
devDependency라 운영 이미지(`runner`)에 없어 `migrator` 스테이지 이미지에서 돌린다.

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
docker compose -f docker-compose.prod.yml run --rm \
  -e ADMIN_PASSWORD \
  migrator pnpm --filter @grossary/web exec tsx scripts/seed-admin.ts admin@example.com
unset ADMIN_PASSWORD
```

**비밀번호를 명령행 인자로 넘기지 마라.** 프로세스 목록과 셸 히스토리에 평문으로
남는다. 위의 `read -rs` + 환경변수 형태를 유지해라.

## 네트워크와 인증 — 알고 넘어가야 할 것

`app`은 3000 포트를 모든 인터페이스에 바인드하고 **평문 HTTP로 서비스한다.**
사내망이어도 **로그인 비밀번호와 세션 쿠키가 그대로 흐른다.** 온프레미스 결정의
귀결이지 버그는 아니지만, 모르고 넘어가면 안 된다.

- **리버스 프록시(nginx 등)로 TLS를 씌우는 것을 권장한다.**
- 세션 쿠키는 현재 `HttpOnly; SameSite=Lax; Path=/`로 설정되고
  **`Secure` 속성은 붙지 않는다**(`apps/web/src/app/api/v1/auth/login/route.ts`).
  평문 HTTP에서 `Secure`를 붙이면 브라우저가 쿠키를 버리므로 지금은 맞는 선택이다.
  TLS를 씌운다면 그 파일에서 `Secure`를 추가해라 — 자동으로 붙지 않는다.
- **CSRF 방어는 `SameSite=Lax` 쿠키 하나뿐이다(R24).** 알려진 미결이고 M2 대상이다.
  그래서 상태를 바꾸는 GET 핸들러를 만들지 않는 규칙이 코드 전체에 걸려 있고,
  `apps/web/tests/screen-guards.test.ts`가 이를 강제한다.
- **레이트 리밋, 계정 잠금, 감사 로그가 없다(R23/F4).** M2 대상이다. 로그인은
  계정 존재 여부가 응답 시간으로 새지 않도록 처리돼 있지만, 무제한 시도를 막지는
  않는다. 그때까지는 사내망 접근 통제에 의존한다.
- DB 포트는 호스트로 내보내지 않는다. 직접 붙어야 하면
  `docker compose -f docker-compose.prod.yml exec postgres psql -U grossary`.

## 백업

```bash
BACKUP_DIR=/srv/grossary-backups ./scripts/backup.sh
```

cron 예시 (매일 새벽 3시):

```
0 3 * * * cd /srv/grossary && BACKUP_DIR=/srv/grossary-backups ./scripts/backup.sh >> /var/log/grossary-backup.log 2>&1
```

이 스크립트는 dump를 **검증한 뒤에만** 최종 파일 이름으로 옮긴다. 실패하면 파일을
남기지 않고 0이 아닌 종료 코드로 끝난다 — cron이 실패를 볼 수 있다. 백업 디렉터리에
파일이 있으면 그건 `pg_restore --list`가 읽어낸 파일이다.

> 스케치의 `pg_dump ... > "$OUT"` 한 줄은 이 성질이 없었다. 셸이 `$OUT`을 먼저
> 만들고 비우므로, 명령이 실패하면 0바이트 파일이 그대로 남는다. `set -o pipefail`은
> 리다이렉션에 적용되지 않아 이걸 막지 못한다(R127).

## 복구

**복구 절차는 운영에 들어가기 전에 반드시 한 번 실행해서 확인해라. 검증하지 않은
백업은 백업이 아니다.** 단, 그 연습은 **리허설 경로로** 해라 — 운영 DB에 직접
하는 것이 아니다.

```bash
# 안전: 별도 DB(grossary_rehearsal)로 복구해 건수만 확인한다. 운영 DB는 그대로다.
./scripts/restore.sh --rehearse /srv/grossary-backups/grossary-20260828-030000.dump
```

실제 복구는 다음과 같고, 진행 전에 `replace grossary`를 직접 타이핑해야 한다:

```bash
./scripts/restore.sh --force /srv/grossary-backups/grossary-20260828-030000.dump
```

`--force`는 순서가 이렇게 되어 있다:

1. dump를 먼저 검증한다 (`pg_restore --list`)
2. **현재 DB의 안전 덤프를 뜬다** — 복구가 잘못됐을 때 유일한 되돌리기 수단이다
3. 사람에게 확인 문구를 받는다
4. `app` 컨테이너를 멈추고 DB를 교체한 뒤 다시 띄운다

> 스케치는 dump를 한 번도 보지 않고 `DROP DATABASE`부터 했다. dump가 손상됐다는
> 사실을 DB를 이미 지운 뒤에 알게 되는 순서였다. 게다가 `app`이 연결을 붙들고
> 있으면 `DROP DATABASE`가 실패한다 — 성공해도 위험하고 실패해도 혼란스러웠다(R126).

## OpenAPI 스펙

`GET /api/v1/openapi`가 스펙을 JSON으로 돌려준다. 인증이 필요 없다.

```bash
curl -s http://localhost:3000/api/v1/openapi > openapi.json
```

스펙은 `apps/web/src/lib/openapi.ts`에 손으로 유지되고,
`apps/web/tests/openapi.test.ts`가 **`app/api/v1/` 밑의 모든 라우트가 스펙에 있고
메서드까지 일치하는지** 검사한다. 라우트를 추가하고 스펙을 안 고치면 테스트가 깨진다.

AI-Lint가 쓰는 지점은 `POST /api/v1/terms/lookup`이다 — 문서에 등장한 표기들을
한 번의 호출로 확인한다.

## 로그

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

## Confluence 임베드 허용

`/embed`는 기본적으로 다른 사이트의 iframe 안에서 열리지 않는다. Confluence origin을
환경변수에 넣은 뒤 앱 컨테이너를 다시 시작한다.

```dotenv
GROSSARY_EMBED_ANCESTORS=https://confluence.example.com
```

여러 출처는 쉼표로 구분한다. 경로가 아니라 `https://호스트[:포트]` 형태의 origin만
인정한다. 이 값은 Proxy가 요청마다 런타임에 읽으므로 Docker Hub의 같은 이미지를 환경별로
다르게 설정할 수 있다.

애플리케이션 예외는 `{ error: { code: "internal_error", ... } }`로만 응답하고
스택은 응답에 노출하지 않는다. 스택은 컨테이너 로그에만 남는다.
