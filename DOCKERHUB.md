# Grossary on Docker Hub

> **Development preview — `0.1.0`**
>
> Grossary is under active development. Use this release for evaluation and internal pilots,
> pin both container tags to `0.1.0`, and keep tested database backups before upgrading.
>
> **개발 미리보기 — `0.1.0`**
>
> 현재 활발히 개발 중인 초기 버전입니다. 기능 검토와 사내 파일럿 용도로 사용하고,
> 앱과 마이그레이터 이미지를 모두 `0.1.0`으로 고정한 뒤 업그레이드 전 백업을 보관하세요.

## Short description

**English**

> Self-hosted collaborative glossary for organization-specific terminology, optimized for Korean and English.

**한국어**

> 특정 조직의 용어와 약어를 함께 정리하는 한국어·영어 중심의 셀프호스팅 용어집입니다.

## Overview

Grossary is a self-hosted collaborative glossary for a specific team, product group, or organizational unit. It brings abbreviations, canonical names, aliases, definitions, and domain knowledge into one searchable source of truth.

Grossary는 전사 공통 플랫폼보다 **특정 조직·팀·제품군이 실제로 사용하는 언어**를 정리하는 데 초점을 둡니다. 누군가 약어만 초안으로 남겨도 다른 구성원이 풀네임·정의·분야를 보태고, 검토가 끝난 용어만 검색과 API에 공개할 수 있습니다.

### Language scope / 언어 지원 범위

The current release is designed for Korean companies that use Korean as their primary language and English for technical terminology. The interface is Korean, and glossary entries support Korean and English names side by side.

현재 버전은 **한국어를 모국어로 사용하면서 기술 용어는 영어와 함께 쓰는 한국 기업 환경**에 최적화되어 있습니다. 완전한 다국어 UI나 임의 언어 선택 기능은 제공하지 않습니다.

A future release may allow another native language to be selected alongside English if there is real demand. This is a possible extension, not a currently supported feature.

향후 요청이 충분하다면 `선택한 모국어 + 영어` 구조로 확장할 수 있지만, 현재 지원 기능으로 약속하지는 않습니다.

## Highlights

- Organization-specific glossary rather than a global public dictionary
- Korean and English names, abbreviations, aliases, and domain tags
- Collaborative draft completion and explicit publish status
- Spreadsheet-style editing and Excel import with dry-run validation
- Search across canonical names and alternate surfaces
- Revision history and revert support
- Admin panel for users, SSO, API keys, and home-page messaging
- OpenAPI 3.1 API and batch terminology lookup for internal tools
- Self-hosted Docker Compose deployment with PostgreSQL 16

## Images and tags

Grossary publishes two tags from the same Docker Hub repository:

| Tag | Purpose |
|---|---|
| `0.1.0` | Version-pinned web application (recommended) |
| `0.1.0-migrator` | Matching database migrations (recommended) |
| `latest` | Most recently published web application |
| `latest-migrator` | Migrations matching `latest` |

For production, pin both images to the same version instead of using `latest`.

사내 서버에서 명시적으로 받으려면 두 태그를 함께 pull합니다.

```bash
docker pull euiyun/grossary:0.1.0
docker pull euiyun/grossary:0.1.0-migrator
```

## Quick start with Docker Compose

Download the pull-based Compose file and its environment template:

```bash
mkdir grossary && cd grossary
curl -LO https://raw.githubusercontent.com/geniuskey/grossary/main/docker-compose.hub.yml
curl -L https://raw.githubusercontent.com/geniuskey/grossary/main/.env.dockerhub.example -o .env
```

The environment template pins both images to the `0.1.0` development release. Set a long, URL-safe database password, then pull and start the stack:

```bash
# 비공개 저장소라면 먼저 실행합니다.
docker login

docker compose --env-file .env -f docker-compose.hub.yml pull
docker compose --env-file .env -f docker-compose.hub.yml up -d
```

Open `http://localhost:3000`. The first visitor is redirected to `/setup` to create the initial administrator account. Complete this immediately after deployment.

데이터는 `grossary_hub_pgdata` Docker 볼륨에 보존됩니다. 새 버전으로 올릴 때는 두 이미지 태그를 같은 버전으로 바꾼 뒤 `pull`과 `up -d`를 다시 실행합니다.

```bash
docker compose --env-file .env -f docker-compose.hub.yml pull
docker compose --env-file .env -f docker-compose.hub.yml up -d
docker compose --env-file .env -f docker-compose.hub.yml ps
```

## Configuration

| Variable | Description |
|---|---|
| `GROSSARY_IMAGE` | Web image, for example `euiyun/grossary:0.1.0` |
| `GROSSARY_MIGRATOR_IMAGE` | Matching migration image, for example `euiyun/grossary:0.1.0-migrator` |
| `GROSSARY_PORT` | Host port; defaults to `3000` |
| `POSTGRES_PASSWORD` | Internal PostgreSQL password; use URL-safe characters |
| `GROSSARY_EMBED_ANCESTORS` | Optional comma-separated Confluence origins allowed to frame `/embed` |

Workspace-specific wording can be configured after login from the administrator panel, allowing each installation to state which organization and specialty the glossary serves.

## Operational notes

- Put a TLS reverse proxy in front of Grossary before using it beyond a protected internal network.
- Back up the PostgreSQL volume regularly and rehearse restoration before production use.
- Keep the application and migrator tags on exactly the same version.
- The `/setup` endpoint is open only while there are no users; the first person to complete it becomes the administrator.

Project documentation: [https://geniuskey.github.io/grossary/](https://geniuskey.github.io/grossary/)

Source: [https://github.com/geniuskey/grossary](https://github.com/geniuskey/grossary)

Docker Hub: [https://hub.docker.com/r/euiyun/grossary](https://hub.docker.com/r/euiyun/grossary)
