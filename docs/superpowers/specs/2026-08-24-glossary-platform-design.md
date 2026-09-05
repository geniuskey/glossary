# 센서 개발용 용어집 관리 플랫폼 설계

- 작성일: 2026-08-24
- 상태: 승인됨 (구현 계획 작성 대기)

## 1. 배경과 목표

센서 제품 개발에 쓰이는 용어집을 엑셀과 컨플루언스로 관리해 왔다. 용어가 여러 시트와 페이지에 흩어져 있어 중복 등록을 발견하기 어렵고, 표기가 문서마다 제각각이며, 도구가 읽을 수 있는 형태가 아니다.

이 플랫폼은 세 가지를 해결한다.

1. **단일 사전** — 모든 용어를 한곳에 모으고 등록 시점에 중복을 잡는다.
2. **기계 판독 가능** — AI-Lint 같은 도구가 API 한 번으로 문서 전체를 검증한다.
3. **위키 수준의 문서성** — 각 용어를 마크다운과 이미지로 충분히 설명한다.

성공 기준: 기존 엑셀 용어집을 이관해 실사용이 시작되고, AI-Lint가 CI에서 문서의 비표준 표기·금지어를 자동 검출하며, 문서 검증 과정에서 발견된 미등록 용어가 다시 용어집으로 환류된다.

## 2. 확정된 결정사항

| 항목 | 결정 |
|---|---|
| 배포 | 사내망 온프레미스, Docker Compose |
| 검증 범위 | 비표준 표기 교정, 미등록 전문용어 발견, 금지어·폐기어 검출 |
| 네임스페이스 | 단일 사전 + 동음이의어 허용 (domain 태그로 구분) |
| 거버넌스 | 위키형 자유 편집 + 전체 이력 (승인 워크플로우 없음) |
| 추출 엔진 | 규칙 기반 코어, LLM은 선택적 보조 |
| 인증 | 자체 계정 + SSO 어댑터 자리, 도구는 API Key |
| 아키텍처 | Next.js 모놀리스 + Postgres, 검증 엔진은 독립 TS 패키지 |
| 첨부 저장 | Postgres bytea, content-addressed, WebP 변환, 파일당 2MB 상한 |

### 채택하지 않은 대안

- **제품별 네임스페이스 분리** — 엑셀 시트 분산 문제가 재현될 위험이 커서 기각.
- **Python/FastAPI 검증 서비스 분리** — 사전이 이미 있는 상태의 매칭은 형태소 분석이 거의 불필요하다. 컨테이너와 언어가 둘로 늘어나는 비용 대비 이득이 작아 기각.
- **매칭을 Postgres에 위임** — 검증 로직이 SQL로 흩어지고 문서 내 위치 기반 규칙을 표현할 수 없어 기각. 단 pg_trgm은 UI 검색에 채택.
- **로컬 볼륨 첨부 저장** — DB 백업과 파일 백업의 시점 불일치로 고아 파일이 생기고, Compose 볼륨명이 디렉터리명에서 파생되어 서버 이동 시 데이터 유실 위험이 있어 기각.

## 3. 데이터 모델

핵심은 **개념(Term)과 표기(Surface)의 분리**다. 엑셀이 무너진 이유는 한 행이 개념이자 표기였기 때문이다. 이를 나누면 세 가지 검증이 모두 같은 테이블 조회로 풀린다.

### Term — 하나의 개념

```
id, slug, term_type          -- term | abbreviation | project | product_id | code | unit
name_en, name_ko             -- 표준 표기 (최소 하나 필수)
full_name_en, full_name_ko   -- 약어일 때 풀네임
domain[]                     -- ISP, HW, SW, Optics, PM ... 동음이의어 구분축
status                       -- draft | approved | deprecated | forbidden
definition_md                -- 1~2문장 정의 (API 응답·툴팁용)
body_md                      -- 위키 본문 (마크다운)
replaced_by_id               -- deprecated일 때 대체 용어
created_by, updated_by, created_at, updated_at
```

### TermSurface — 그 개념을 가리키는 모든 실제 표기

```
id, term_id
text                -- "Auto Exposure", "AE", "자동노출", "오토익스포저"
lang                -- en | ko | neutral
kind                -- canonical | abbreviation | full_name | alias
                    -- | discouraged | forbidden
case_sensitive      -- "AE"처럼 대소문자가 의미 있으면 true (짧은 대문자 약어는 기본 true)
norm_loose          -- 정규화 키: 구분자 전부 제거 (autoexposure)
norm_space          -- 정규화 키: 구분자를 단일 공백으로 (auto exposure)
```

정규화 절차: NFKC → 소문자 → CamelCase 분해 → 구분자 처리 두 갈래. `Auto Exposure`, `auto-exposure`, `AutoExposure`가 한 표기로 수렴한다.

### 세 가지 검증이 떨어지는 방식

| 검증 | 판정 조건 |
|---|---|
| 비표준 표기 교정 | surface.kind가 alias/discouraged → 해당 Term의 canonical 제안 |
| 금지어·폐기어 | kind='forbidden' 또는 Term.status가 deprecated/forbidden → replaced_by 제안 |
| 동음이의 경고 | 같은 정규화 키가 서로 다른 Term 2개 이상에 연결 → domain과 함께 제시 |

### 나머지 테이블

- **TermRevision** — 변경마다 Term+Surfaces 전체를 jsonb 스냅샷으로 적재. diff와 롤백은 스냅샷 비교로 계산하며 diff를 따로 저장하지 않는다.
- **TermRelation** — `related | broader | narrower | see_also`. 본문의 `[[링크]]`가 여기에 실체화되어 역참조 목록이 자동 생성된다.
- **User** — id, email, name, password_hash, role(admin|editor), external_id(SSO 자리).
- **ApiKey** — 해시만 저장, prefix로 식별, scope는 read|write|validate.
- **UnregisteredCandidate** — 텍스트, 최초/최근 발견, 등장 횟수, 샘플 문맥, 출처, dismissed 여부. 검증할수록 "자주 쓰이는데 등록 안 된 용어" 목록이 쌓여 용어집이 스스로 자란다.

### Attachment

```
Attachment
  id, sha256 (unique)           -- 내용 주소, 중복 업로드 자동 제거
  data (bytea)                  -- 변환 후 실체
  stored_mime                   -- image/webp | image/svg+xml
  byte_size, width, height
  original_filename             -- 표시용
  original_mime, original_bytes -- 어떤 형식을 얼마에서 줄였는지 기록
  uploaded_by, created_at

AttachmentRef
  attachment_id, term_id        -- 한 이미지를 여러 용어에 붙일 수 있음
```

이미지 처리 정책:

- 업로드 수용은 10MB까지. 긴 변 2560px 리사이즈 → WebP 변환 후 **결과가 2MB 이하**면 통과. 초과 시에만 품질을 단계적으로 낮추고, 끝내 안 되면 거부. 입력 크기로 미리 거부하지 않는다.
- **무손실과 손실(q82) 양쪽으로 인코딩해 작은 쪽을 채택.** 다이어그램·타이밍차트·레지스터 표처럼 글자가 든 이미지는 손실 변환에서 텍스트가 뭉개지므로 일괄 손실은 위험하다. 2MB 상한에서는 양쪽 인코딩 비용이 문제되지 않는다.
- **SVG는 변환하지 않는다.** 벡터를 래스터로 바꿀 이유가 없다. 대신 sanitize 후 저장하고 별도 경로에서 CSP를 걸어 서빙한다.
- EXIF 제거. 원본 파일명은 메타로 보존해 다운로드 시 표시명으로 쓴다.

### 중복 방지

두 단계로 잡는다. 등록 시점에 정규화 키 충돌을 즉시 경고하고(동음이의는 허용하되 사람이 반드시 확인), 별도로 pg_trgm 유사도 기반 "잠재 중복" 리포트를 둔다. 병합은 `merge(source → target)`으로 surface를 이관하고 옛 slug는 리다이렉트로 남긴다.

## 4. 검증 엔진

`packages/engine`은 DB도 HTTP도 모르는 순수 TypeScript 패키지다.

```
validate(lexicon: Lexicon, doc: Document, opts) -> Finding[]
```

`Lexicon`(사전 스냅샷)을 주입받으므로 픽스처만으로 테스트가 돌고, AI-Lint가 HTTP 없이 npm 패키지로 직접 임베드할 수도 있다.

### 파이프라인

**1. 세그먼트 분리** — 노이즈를 좌우하는 지점. 마크다운의 코드블록·인라인 코드·URL·이미지 경로·프론트매터를 먼저 제외하지 않으면 `sensor_gain_reg`, `getExposureTime` 같은 식별자가 전부 미등록 후보로 쏟아진다. 제외 구간은 span만 기억하고 이후 단계에서 건너뛴다.

**2. 사전 매칭** — Aho-Corasick 자동자. 표기가 수만 개여도 문서를 한 번만 훑는다. 최장일치 우선이라 "Auto Exposure"가 있으면 "Exposure"를 따로 잡지 않는다.

**3. 경계 판정** — 한국어는 매칭 뒤에 조사(은/는/이/가/을/를/의/에/에서/으로/로/와/과/도/만/부터/까지 등)가 붙으면 경계로 인정하고, `이미지센서티브`처럼 조사가 아니면 거부한다. 형태소 분석기 없이 이 규칙으로 실용적 정확도가 나온다. 영어는 단어 경계와 CamelCase 분해로 처리한다.

**4. 규칙 적용**

| rule | severity | 동작 |
|---|---|---|
| `forbidden` | error | 금지어. 대체 표현 제시 |
| `deprecated` | error | 폐기어. replaced_by 제시 |
| `non_standard` | warning | alias/discouraged 매칭 → canonical 자동 교정 가능 |
| `ambiguous` | warning | 같은 표기가 여러 Term에 → domain별 후보 나열 |
| `unregistered` | info | 미등록 후보 |

**5. 미등록 후보 추출** — 대문자 2~6자 연속(`AWB`, `MIPI`), 숫자 포함 제품코드형(`IMX999`), Title Case 다단어구, 한글은 문서 내 반복 빈도 임계를 넘는 명사구. **무시 목록**을 함께 둔다. 없으면 몇 주 안에 리포트가 노이즈로 덮여 아무도 안 본다.

### Finding 구조

```
{ rule, severity, span{start,end,line,col}, matchedText,
  termId?, message, suggestions[{text, termId, reason}] }
```

`span`은 원본 좌표를 끝까지 유지한다. 세그먼트 제외로 오프셋이 밀리면 AI-Lint의 인라인 표시와 자동 수정이 어긋난다.

### 결정성과 성능

같은 사전 버전 + 같은 문서면 항상 같은 결과다. 응답에 `lexiconVersion`(스냅샷 해시)을 실어 CI 실패 시 당시 사전을 재현할 수 있게 한다. 사전 스냅샷은 메모리 캐시하고 버전 해시로 무효화한다. 목표는 10만자 문서 100ms 이내.

### LLM

기본 off. `llm: true`일 때만 미등록 후보 상위 N개를 "도메인 전문용어 / 일반어 / 오타"로 3분류한다. 사내망이므로 OpenAI 호환 엔드포인트 URL을 설정으로 받아 로컬 LLM 서버를 붙인다. **CI 경로는 항상 규칙 기반만 타므로 빌드가 LLM 가용성에 묶이지 않는다.**

테스트는 골든 파일 방식. `fixtures/`에 문서와 기대 Finding을 짝지어 회귀를 잡는다.

## 5. API

전부 `/api/v1` 아래. 스키마를 zod로 정의해 **OpenAPI 3.1 문서를 자동 생성**하므로 스펙과 구현이 갈라지지 않고, AI-Lint 쪽에서 타입 있는 클라이언트를 생성할 수 있다.

인증은 두 갈래. 사람은 세션 쿠키, 도구는 `Authorization: Bearer glk_<prefix>_<secret>`. 키는 해시만 저장하고 scope(read/write/validate)로 제한한다.

### 문서 검증

```
POST /api/v1/validate
{ "content": "...", "format": "markdown", "path": "docs/isp_tuning.md",
  "options": { "minSeverity": "warning", "domains": ["ISP"], "llm": false } }

200 {
  "lexiconVersion": "sha256:9f2c...",
  "stats": { "matched": 47, "unregistered": 3, "errors": 1 },
  "findings": [
    { "rule": "non_standard", "severity": "warning",
      "span": { "start": 412, "end": 425, "line": 18, "col": 7 },
      "matchedText": "Auto Exposure", "termId": "t_ae",
      "message": "비표준 표기입니다. 표준 표기는 'AE'입니다.",
      "suggestions": [{ "text": "AE", "termId": "t_ae", "reason": "canonical" }] }
  ]
}
```

`POST /api/v1/validate/batch`는 같은 형태로 문서 배열을 받아 레포 전체를 처리한다.

### 사전 스냅샷 배포

```
GET /api/v1/lexicon        (ETag / If-None-Match)
```

CI가 제대로 돌기 위한 핵심이다. 레포 전체를 매 커밋마다 서버로 올려 검증하는 것은 느리고, 사내 문서 본문이 계속 네트워크를 타는 것도 바람직하지 않다. AI-Lint가 사전 스냅샷만 받아 로컬 캐시하고 `packages/engine`으로 자기 자리에서 검증하면 네트워크 왕복이 커밋당 한 번, 사전이 안 바뀌었으면 304로 끝난다. 서버 `/validate`는 웹 UI의 즉석 검사와 엔진을 임베드할 수 없는 클라이언트용으로 남긴다. 같은 엔진 코드가 양쪽에서 도니 결과는 동일하다.

### 용어 유무 확인 (배치)

```
POST /api/v1/terms/lookup
{ "texts": ["AE", "이미지센서", "AutoExposure", "Foobar"] }

200 { "results": [
  { "text": "AE", "found": true, "matchKind": "abbreviation",
    "terms": [{ "id": "t_ae", "slug": "ae", "nameEn": "AE",
                "fullNameEn": "Auto Exposure", "nameKo": "자동노출",
                "domain": ["ISP"], "status": "approved" }] },
  { "text": "Foobar", "found": false, "similar": [{ "slug": "foobar-mode", "score": 0.72 }] }
] }
```

실제 호출 패턴이 "이 목록이 다 등록돼 있나?"이므로 배치를 기본으로 둔다. 못 찾았을 때 pg_trgm 유사 후보를 함께 주면 오타인지 진짜 미등록인지 즉시 갈린다.

### 나머지 엔드포인트

| 그룹 | 엔드포인트 |
|---|---|
| 조회 | `GET /terms` (q, type, domain, status, 페이징), `GET /terms/{idOrSlug}` |
| 편집 | `POST /terms`, `PATCH /terms/{id}`, `DELETE /terms/{id}`(admin), `POST /terms/{id}/merge` |
| 표기 | `POST /terms/{id}/surfaces`, `DELETE /surfaces/{id}` |
| 이력 | `GET /terms/{id}/revisions`, `GET .../revisions/{n}`, `POST .../revert` |
| 후보 | `GET /candidates`, `POST /candidates/{id}/dismiss`, `POST /candidates/{id}/promote` |
| 품질 | `GET /duplicates` |
| 첨부 | `POST /attachments` (multipart), `GET /attachments/{sha256}` (immutable 캐시) |
| 이관 | `POST /import` (xlsx/csv, dryRun 지원), `GET /export?format=xlsx\|csv\|json` |
| 상태 | `GET /health` |

특기사항:

- `POST /terms`는 정규화 키 충돌 시 **409가 아니라 200에 `warnings`를 실어 반환**한다. 동음이의어를 허용하기로 했으므로 등록을 막으면 안 되지만 "이미 이런 용어가 있다"는 반드시 보여줘야 한다. 강제 진행은 `force: true`.
- `/import`의 `dryRun`은 엑셀 이관에 필수다. 수백 행을 넣기 전에 무엇이 충돌하고 중복인지 리포트를 먼저 받는다.
- 에러는 전 엔드포인트가 `{ error: { code, message, details } }`로 통일하고 `code`는 기계가 분기할 수 있는 안정된 문자열로 둔다.

## 6. 웹 UI

Next.js 16 App Router + TypeScript + Tailwind + shadcn/ui, SSR 모드.

| 경로 | 역할 |
|---|---|
| `/` | 대시보드 — 최근 변경, 미등록 후보 TOP, 잠재 중복, 도메인별 용어 수 |
| `/terms` | 목록 — type/domain/status 필터, 정렬, 페이징 |
| `/terms/[slug]` | 용어 페이지 (위키 본문) |
| `/terms/[slug]/edit` | 편집 |
| `/terms/[slug]/history` | 리비전 목록 + diff + revert |
| `/check` | 문서 붙여넣고 즉석 검증 |
| `/candidates` | 미등록 후보 처리 (등록 / 무시) |
| `/duplicates` | 잠재 중복 병합 |
| `/import` | 엑셀 업로드 → dry-run 리포트 → 반영 |
| `/settings/api-keys`, `/settings/users` | 키 발급·폐기, 사용자 관리 |

### 검색은 Surface를 향한다

Cmd+K 커맨드 팔레트가 기본 진입점이며 **검색 대상은 Term이 아니라 TermSurface다.** "오토익스포저"나 "auto-exposure"로 검색해도 AE 개념 페이지에 도착한다. 사람들은 표준 표기를 모르기 때문에 용어집을 찾는다. 표준 표기로만 검색되면 도구가 무용지물이다. pg_trgm 유사도로 오타도 흡수한다.

### 용어 페이지

헤더에 표준 한글명·영문명, 약어면 풀네임, 도메인 배지, 상태 배지를 한 화면에 올린다. `deprecated`면 대체 용어 배너를, 동음이의어가 있으면 "같은 표기의 다른 용어" 목록을 상단에 띄운다. 이어서 정의, 마크다운 본문, 등록된 표기 전체 목록(kind별 구분), 관련 용어, 첨부 이미지.

### 마크다운

에디터는 CodeMirror 6 + 분할 프리뷰, 렌더는 remark/rehype + GFM + shiki.

- **Mermaid 지원.** 센서 도메인은 블록도와 타이밍 다이어그램이 계속 나오는데 이미지로 붙이면 수정이 안 된다. mermaid 코드블록은 텍스트라 diff에 잡히고 이력 추적이 되며 이미지 업로드 부담도 실질적으로 줄인다.
- **위키 링크 `[[AE]]`** 는 표기 기준으로 해석해 용어 페이지로 연결하고, 대상이 없으면 빨간 링크로 "여기서 새로 만들기"를 유도한다. TermRelation으로 실체화되어 역참조 목록이 자동 생성된다.
- **이미지 붙여넣기** 는 클립보드 paste를 가로채 업로드 → 리사이즈 → WebP 변환 → `![](/api/v1/attachments/{sha256})` 삽입까지 한 번에 처리한다.

### 위키 본문 자체를 검증한다

저장 시 본문에 검증 엔진을 돌려 비표준 표기와 금지어를 인라인 표시한다. 용어집을 관리하는 사람들이 정작 용어집 본문에서 제각각 표기를 쓰는 상황을 막는다. 표준을 강제하는 도구가 자기 자신에게 먼저 그 표준을 적용하는 셈이고, 엔진 회귀도 조기에 드러난다. 저장을 막지는 않고 경고만 띄운다.

### 동시 편집 충돌

편집 시작 시 리비전 번호를 들고 있다가 저장 시점에 서버 리비전과 비교하는 **낙관적 잠금**. 어긋나면 덮어쓰지 않고 상대 변경과의 diff를 보여준 뒤 병합을 유도한다. 비관적 잠금은 "잠가놓고 퇴근한 사람" 문제를 만들어 쓰지 않는다.

UI 언어는 한국어 기본, 용어 데이터는 한/영 병기.

## 7. 저장소 구조와 인프라

### 패키지 (pnpm workspace + Turborepo)

```
apps/web/          Next.js — UI + API 라우트 + zod 스키마 + OpenAPI 생성
packages/engine/   순수 TS — normalize, Aho-Corasick, 경계 판정, 규칙, validate()
packages/db/       Drizzle 스키마 + 마이그레이션 + 쿼리
```

의존 방향은 `web → db → engine`. engine은 아무것도 의존하지 않는다.

**반드시 지켜야 할 제약:** 표기 정규화 함수는 `engine`이 유일한 소유자이고 `db`가 이를 import해서 쓴다. DB에 `norm_loose`를 저장할 때 쓴 함수와 검증 시 문서를 정규화하는 함수가 조금이라도 다르면 **매칭이 조용히 실패한다.** 에러 없이 그냥 용어를 못 찾는다. 구현을 한 곳에 묶고, 정규화 규칙 변경 시 저장된 정규화 컬럼을 재생성하는 마이그레이션을 반드시 함께 넣는다.

### Docker Compose

PostgreSQL 16 + `pg_trgm`, ORM은 Drizzle. 컨테이너는 둘뿐이다.

```yaml
services:
  app:      # Next.js standalone 빌드
  postgres: # 16-alpine, pg_trgm
volumes:
  pgdata:
    name: glossary_pgdata   # 디렉터리명 파생 방지 — 명시 고정
```

볼륨 `name:` 명시는 사고 방지용이다. Compose 볼륨명은 기본적으로 프로젝트 디렉터리명에서 파생되므로, 디렉터리를 옮기거나 이름을 고치면 빈 볼륨이 새로 생성되고 앱은 멀쩡히 뜬 채 데이터만 사라진다.

**백업은 명령 하나다.** 이미지가 DB 안에 있으므로 `pg_dump -Fc` 결과 파일 하나가 전체 백업이고 서버 이동은 `pg_restore` 하나다. 백업 스크립트와 cron 예시를 리포에 포함하고, restore 절차를 실제로 한 번 검증해 문서화한다. 검증하지 않은 백업은 백업이 아니다.

### 테스트

TDD로 진행한다.

- **engine** — 테스트 무게를 여기 싣는다. 단위 테스트 + 골든 픽스처. 순수 함수라 DB 없이 빠르게 돌고 정확도 회귀가 가장 아픈 곳이다.
- **db** — 실제 Postgres 통합 테스트. **정규화 컬럼과 engine 함수의 일치를 검증하는 테스트를 반드시 포함한다.**
- **API** — zod 스키마 기반 계약 테스트, 인증·scope 경계 포함.
- **E2E** — Playwright로 핵심 흐름 넷: 용어 등록 → 별칭으로 검색 → 문서 검증 → 이력 롤백.

## 8. 마일스톤

### M1 — 사전 코어 (엑셀 탈출)

DB 스키마, 정규화, 자체 계정 인증, API Key, 용어 CRUD API, 목록·상세·편집 UI, surface 기반 검색 + trgm, 등록 시 중복 경고, 엑셀 임포트(dry-run).

이 시점에 기존 엑셀·컨플루언스를 옮기고 실사용을 시작할 수 있다. 가장 먼저 놓는 이유가 이것이다. 실제 데이터가 들어와야 이후 기능의 튜닝이 가능하다.

### M2 — 검증 엔진 + 연동 (핵심 차별점)

`packages/engine` 전체, `/validate`, `/validate/batch`, `/lookup`, `/lexicon`, `/check` 화면, 미등록 후보 수집과 `/candidates` 처리 화면.

AI-Lint 연동이 여기서 완성된다.

### M3 — 위키 완성도

마크다운 본문 + CodeMirror + mermaid, 이미지 붙여넣기·WebP 변환·첨부, 리비전 diff/revert UI, 위키 링크와 역참조, 잠재 중복 병합 UI, 대시보드.

M1에도 한두 문장짜리 정의 필드가 있으므로 용어 페이지가 빈 껍데기가 되지는 않는다. 긴 본문과 이미지만 M3로 미룬다.

## 9. 리스크

| 리스크 | 대응 |
|---|---|
| 미등록 후보 노이즈 — 임계값이 낮으면 리포트가 쓰레기로 덮여 아무도 안 본다 | M2에서 실제 사내 문서로 튜닝, 무시 목록 필수 동반 |
| 한국어 경계 오탐 | 골든 픽스처로 회귀 관리 |
| 엑셀 데이터 품질 | dry-run 리포트로 흡수 |
| 정규화 함수 불일치로 인한 조용한 매칭 실패 | engine 단일 소유 + db 통합 테스트로 상시 검증 |

## 10. 보류 항목

- SSO(LDAP/SAML) 연동 — 인증 레이어를 분리해두고 실제 연동은 사내 인프라 정보 확보 후.
- 컨플루언스 직접 임포트 — M1은 엑셀/CSV만. 컨플루언스는 export 후 변환으로 우회.
- docx 등 마크다운 외 포맷 검증 — M2는 markdown/plaintext만.
