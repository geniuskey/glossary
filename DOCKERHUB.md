# Glossary on Docker Hub

> **Release — `0.3.1`**
>
> Use the matching `0.3.1`, `0.3.1-migrator`, and `0.3.1-worker` tags, and keep a tested
> database backup before upgrading.
>
> **릴리스 — `0.3.1`**
>
> 앱은 `0.3.1`, 마이그레이터는 `0.3.1-migrator`, RAG 워커는 `0.3.1-worker`로
> 고정하고 업그레이드 전 백업을 보관하세요.

## Short description

**English**

> Self-hosted collaborative glossary for organization-specific terminology, optimized for Korean and English.

**한국어**

> 특정 조직의 용어와 약어를 함께 정리하는 한국어·영어 중심의 셀프호스팅 용어집입니다.

## Overview

Glossary is a self-hosted collaborative glossary for a specific team, product group, or organizational unit. It brings abbreviations, canonical names, aliases, definitions, and domain knowledge into one searchable source of truth.

Glossary는 전사 공통 플랫폼보다 **특정 조직·팀·제품군이 실제로 사용하는 언어**를 정리하는 데 초점을 둡니다. 누군가 약어만 초안으로 남겨도 다른 구성원이 풀네임·정의·분야를 보태고, 작성 내용을 바탕으로 `보완 필요` / `기준 충족` 상태를 자동 판정합니다. 이 상태는 공개 권한이나 공식 승인을 뜻하지 않으며, 보완이 필요한 용어도 검색·API·챗봇에서 사용될 수 있습니다.

### Language scope / 언어 지원 범위

The current release is designed for Korean companies that use Korean as their primary language and English for technical terminology. The interface is Korean, and glossary entries support Korean and English names side by side.

현재 버전은 **한국어를 모국어로 사용하면서 기술 용어는 영어와 함께 쓰는 한국 기업 환경**에 최적화되어 있습니다. 완전한 다국어 UI나 임의 언어 선택 기능은 제공하지 않습니다.

A future release may allow another native language to be selected alongside English if there is real demand. This is a possible extension, not a currently supported feature.

향후 요청이 충분하다면 `선택한 모국어 + 영어` 구조로 확장할 수 있지만, 현재 지원 기능으로 약속하지는 않습니다.

## Highlights

- Organization-specific glossary rather than a global public dictionary
- Korean and English names, abbreviations, aliases, and domain tags
- Collaborative completion with automatically calculated content-quality status; no per-term private/public approval workflow
- Spreadsheet-style editing and Excel import for all alternate notation kinds, with dry-run validation
- Column-selectable read-only sheet URLs and iframe code for Confluence
- Search across canonical names and alternate surfaces
- Markdown editing, attached images, Mermaid diagrams, math rendering, revision history, and revert support
- Admin panel for OIDC/OAuth 2.0 SSO, users, AI providers, and home-page messaging; API keys are managed under user settings
- Glossary-grounded Gemini or OpenAI-compatible chat with passage citations, domain-scoped retrieval, and reviewable term creation/editing proposals
- Paste CSV, TSV, Markdown tables, lists, or JSON into chat to review up to 25 term proposals before creating entries
- Collaborative contribution workspace with a table-based completion queue, durable AI review queue, duplicate merging, and one-line definition review
- Domain colors, term owners, classifications, and an interactive relationship graph with proposed/approved semantic relations
- OpenAPI 3.1 API and batch terminology lookup for internal tools
- Self-hosted Docker Compose deployment with PostgreSQL 16, `pg_trgm`, and `pgvector`
- Admin-configurable Embedding API and optional Reranker API, with a durable glossary RAG index

The `read`-scope lookup API accepts 1–500 notation strings (1–500 characters each).
Clients can fetch an ETag-versioned lexicon snapshot from `/lexicon`, validate a document with
`/validate` or `/validate/batch` using the `validate` API-key scope, and review unregistered
term candidates through `/candidates`. The `/check` page provides the same workflow in the UI;
candidates can be promoted into the glossary or dismissed.

`draft` means “needs completion,” not private data. “Meets criteria” is a content check,
not an approval or guarantee of correctness.

## Images and tags

The web application, migrator, and durable RAG worker are published separately in the same repository:

| Tag | Purpose |
|---|---|
| `0.3.1` | Version-pinned web application (recommended) |
| `0.3.1-migrator` | Matching database migrations (recommended) |
| `0.3.1-worker` | Matching durable RAG and cleanup worker (recommended) |
| `latest` | Most recently published web application |
| `latest-migrator` | Migrations matching `latest` |
| `latest-worker` | Worker matching `latest` |

For production, pin all three images to the same version instead of using `latest`.

사내 서버에서 명시적으로 받으려면 세 태그를 함께 pull합니다.

```bash
docker pull euiyun/glossary:0.3.1
docker pull euiyun/glossary:0.3.1-migrator
docker pull euiyun/glossary:0.3.1-worker
```

## Quick start with Docker Compose

Requires Docker Engine with the Compose plugin. The published `0.3.1` images are
`linux/amd64`; native ARM64 support is not advertised for this tag. Node.js and pnpm
are not needed on the host. Commands below use Bash (Git Bash or WSL on Windows).

Download the pull-based Compose file and its environment template:

```bash
mkdir glossary && cd glossary
curl -LO https://raw.githubusercontent.com/geniuskey/glossary/v0.3.1/docker-compose.hub.yml
curl -L https://raw.githubusercontent.com/geniuskey/glossary/v0.3.1/.env.dockerhub.example -o .env
```

Edit `.env` before starting: use the `0.3.1` / `0.3.1-migrator` / `0.3.1-worker` set, replace
`POSTGRES_PASSWORD` with a long URL-safe value, and replace `GLOSSARY_ENCRYPTION_KEY`
with a separate fixed random secret of at least 32 characters if using AI or RAG.
The examples download templates from `v0.3.1` so they match the documented release.
For example, generate a password with `openssl rand -hex 32` and an encryption key with
`openssl rand -base64 48`, then copy the respective outputs into `.env`.

환경 파일의 예시 비밀번호·암호화 키를 그대로 사용하지 마세요. 암호화 키는 DB 백업에
포함되지 않으며, 분실하거나 변경하면 저장된 AI API 키와 custom header를 읽을 수 없습니다.

Then pull and start the stack:

```bash
# Private repositories only: docker login

docker compose --env-file .env -f docker-compose.hub.yml pull
docker compose --env-file .env -f docker-compose.hub.yml up -d
```

Open `http://localhost:3000` on the Docker host. The supplied Compose file binds the app to
loopback only; use a TLS reverse proxy for remote access. With default password login, the first
visitor is redirected to `/setup` to create the initial administrator account. Complete this
immediately after deployment.

`database-init` prepares `pg_trgm` and `vector`; `migrator` must finish successfully before `app` starts.
One-time services exiting with code 0 is expected.

데이터는 `glossary_hub_pgdata` Docker 볼륨에 보존됩니다. 새 버전으로 올릴 때는 세 이미지 태그를 같은 버전으로 바꾼 뒤 `pull`과 `up -d`를 다시 실행합니다.

```bash
docker compose --env-file .env -f docker-compose.hub.yml pull
docker compose --env-file .env -f docker-compose.hub.yml up -d
docker compose --env-file .env -f docker-compose.hub.yml ps
```

## Configuration

| Variable | Description |
|---|---|
| `GLOSSARY_IMAGE` | Web image, for example `euiyun/glossary:0.3.1` |
| `GLOSSARY_MIGRATOR_IMAGE` | Matching migration image, for example `euiyun/glossary:0.3.1-migrator` |
| `GLOSSARY_WORKER_IMAGE` | Matching durable RAG and cleanup worker, for example `euiyun/glossary:0.3.1-worker` |
| `GLOSSARY_PORT` | Host port; defaults to `3000` |
| `POSTGRES_PASSWORD` | Internal PostgreSQL password; use URL-safe characters |
| `GLOSSARY_ENCRYPTION_KEY` | Fixed secret of at least 32 characters for AI/RAG API keys and custom headers; back up separately |
| `GLOSSARY_ALLOWED_ORIGINS` | Comma-separated public HTTPS origins allowed to make browser state-changing requests |
| `GLOSSARY_BASE_URL` | Optional public base URL used for direct OIDC/OAuth2 redirect URIs; defaults to the first allowed origin |
| `GLOSSARY_AI_ALLOWED_PRIVATE_HOSTS` | Optional comma-separated private-network AI/RAG hosts; link-local addresses remain blocked |
| `GLOSSARY_CONFLUENCE_MEETINGS_URL` | Optional Confluence meeting hub linked from the meeting knowledge inbox |
| `GLOSSARY_TRUST_PROXY_HEADERS` | Trust `X-Forwarded-*` only when a TLS proxy always overwrites those headers |
| `GLOSSARY_AI_RUN_RETENTION_DAYS` | AI execution metadata retention in days; defaults to `180` |
| `GLOSSARY_AUDIT_RETENTION_DAYS` | Audit log retention in days; defaults to `365` |
| `GLOSSARY_ATTACHMENT_RETENTION_DAYS` | Unreferenced attachment retention in days; defaults to `30` |
| `GLOSSARY_RAG_WORKER_BATCH` | Maximum RAG queue items processed per batch; defaults to `8` |
| `GLOSSARY_RAG_WORKER_IDLE_MS` | Worker polling delay while idle; defaults to `2000` ms |
| `GLOSSARY_RAG_WORKER_BUSY_MS` | Worker delay after processing a batch; defaults to `100` ms |
| `INITIAL_ADMIN_EMAIL` | Initial administrator email for SSO bootstrap; required for a fresh proxy-only setup |
| `SSO_LOGIN_URL` | Proxy login entry override; defaults to `/oauth2/start?rd=%2F` |
| `GLOSSARY_EMBED_ANCESTORS` | Optional comma-separated Confluence origins allowed to frame `/embed` |
| `OAUTH2_PROXY_ENABLED` | Allows the UI to select oauth2-proxy when a trusted proxy safely overwrites authentication headers; default `false` |
| `PASSWORD_LOGIN_ENABLED` | Initial password-login policy before the first admin save; later managed under **Admin → Login · SSO** |
| `OAUTH2_PROXY_PREFERRED_USERNAME_HEADER` | Display-name header; defaults to `X-Forwarded-Preferred-Username` |
| `OAUTH2_PROXY_EMAIL_HEADER` | Email and default subject header; defaults to `X-Forwarded-Email` |
| `OAUTH2_PROXY_GROUPS_HEADER` | Comma-separated groups; the first is displayed as the organization |
| `OAUTH2_SUBJECT_FIELD` | Optional direct-OAuth2 subject override; set `email` when proxy and OAuth2 code flows coexist |

Workspace-specific wording can be configured after login from the administrator panel, allowing each installation to state which organization and specialty the glossary serves.
The active login mode (`disabled`, OIDC, OAuth 2.0, or oauth2-proxy) is selected under **Admin → Login · SSO** (`관리자 패널 → 로그인 · SSO`).
For proxy-only bootstrap and trusted-header configuration, follow the [SSO guide](https://geniuskey.github.io/glossary/guide/sso).

## AI and sharing

Configure Gemini or an OpenAI-compatible endpoint under **Admin → AI connection** after setting
the encryption key. `Connected` means a generation request succeeded with the selected model.
Questions and relevant glossary content, including entries that need completion, may be sent
to that provider. AI is optional; glossary editing and lookup do not require it.

Confluence embeds require both `GLOSSARY_EMBED_ANCESTORS` and a Glossary login session.
Use matching site boundaries where possible, such as `glossary.example.com` and
`confluence.example.com`. A shared sheet displays at most 200 entries and is read-only.

## Backup and restore

### 처음 하는 백업 (Beginner guide)

Docker Hub 방식으로 설치한 뒤 처음 백업하는 경우, 서버의 터미널에서 `.env`와
`docker-compose.hub.yml`이 있는 설치 디렉터리로 이동해 아래 순서대로 실행합니다.
Windows에서는 Docker Desktop과 Git Bash 또는 WSL을 사용하세요.

1. 스택 상태를 확인합니다.

   ```bash
   docker compose --env-file .env -f docker-compose.hub.yml ps
   ```

   `postgres`와 `app`이 실행 중이면 됩니다. `database-init`과 `migrator`의
   `Exited (0)`은 일회성 작업이 성공했다는 뜻입니다. 앱이 실행 중이 아니면 먼저
   `docker compose --env-file .env -f docker-compose.hub.yml up -d`를 실행합니다.

2. 백업 스크립트를 준비하고 실행합니다. 저장소를 이미 내려받았다면 `curl` 줄은
   건너뛰어도 됩니다.

   ```bash
   mkdir -p scripts backups
   curl -L https://raw.githubusercontent.com/geniuskey/glossary/v0.3.1/scripts/backup.sh -o scripts/backup.sh
   COMPOSE_FILE=docker-compose.hub.yml BACKUP_DIR=./backups bash scripts/backup.sh
   ```

3. 출력에 `완료:`가 표시됐는지 확인합니다. 예를 들어 다음 파일이 만들어집니다.

   ```text
   backups/glossary-20260917-030000.dump
   ```

   스크립트가 백업 파일을 자동 검증하므로, 오류가 나거나 `완료:`가 표시되지 않은
   파일은 사용하지 마세요.

4. `.dump` 파일과 함께 `.env`, `docker-compose.hub.yml`, 그리고 특히
   `.env`의 `GLOSSARY_ENCRYPTION_KEY`를 서버와 다른 안전한 장소에 보관합니다.
   `.dump`에는 용어와 첨부 이미지는 포함되지만 암호화 키는 포함되지 않습니다.
   비밀번호와 키가 들어 있는 파일을 공개 저장소나 공개 파일 공유에 올리지 마세요.

For restoration, keep the dump, Compose/environment configuration, and the encryption key.
The dump includes attachment images but does not include the environment's encryption key.
Prepare the restore script from the installation directory in Bash:

```bash
mkdir -p scripts
curl -L https://raw.githubusercontent.com/geniuskey/glossary/v0.3.1/scripts/restore.sh -o scripts/restore.sh
export COMPOSE_FILE=docker-compose.hub.yml
# Replace the filename with the backup produced above.
bash scripts/restore.sh --rehearse ./backups/glossary-YYYYMMDD-HHMMSS.dump
```

The rehearsal recreates `glossary_rehearsal` and leaves the application's `glossary` database
unchanged. Actual replacement uses `--force` and requires typing `replace glossary`.
Read the [operations guide](https://geniuskey.github.io/glossary/operations) before restoring.
Upgrades run database migrations; changing only the image tag back is not a database rollback.

## Operational notes

- Put a TLS reverse proxy in front of Glossary before using it beyond a protected internal network.
- The supplied Compose file exposes plain HTTP on `127.0.0.1` only. For TLS termination, overwrite `X-Forwarded-Proto` with the actual external protocol; HTTPS requests get `Secure` session cookies automatically. Keep direct access to the app port restricted when using trusted proxy headers.
- Back up with `pg_dump` or the supplied backup script and rehearse restoration before production use.
- Keep the application, migrator, and worker tags on exactly the same version.
- The `/setup` endpoint is open only while there are no users; the first person to complete it becomes the administrator.

For startup problems, inspect:

```bash
docker compose --env-file .env -f docker-compose.hub.yml ps -a
docker compose --env-file .env -f docker-compose.hub.yml logs --tail=100 database-init migrator app
curl -fsS http://localhost:3000/api/v1/health
```

Use the configured port for the health check. Share sanitized logs through the
[support channels](https://geniuskey.github.io/glossary/support).

Project documentation: [https://geniuskey.github.io/glossary/](https://geniuskey.github.io/glossary/)

Source: [https://github.com/geniuskey/glossary](https://github.com/geniuskey/glossary)

Docker Hub: [https://hub.docker.com/r/euiyun/glossary](https://hub.docker.com/r/euiyun/glossary)

License: [Apache-2.0](https://github.com/geniuskey/glossary/blob/main/LICENSE)

Created and maintained by [Euiyun Kim (Edwin)](https://euiyun.com).
