# 데이터 모델

핵심은 **개념(Term)과 표기(Surface)의 분리**다. 엑셀이 무너진 이유는 한 행이 개념이자
표기였기 때문이다. 이를 나누면 세 가지 검증이 모두 같은 테이블 조회로 풀린다.

## terms — 하나의 개념

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid | PK |
| `slug` | text | 유니크. URL 식별자 |
| `quality_profile` | enum | 기존 API·리비전 호환용. 새 판정은 용어의 상태와 내용에서 자동 계산 |
| `name_en`, `name_ko` | text | 목록·제목에 쓸 대표 표기. 최소 하나는 있어야 한다 |
| `full_name_en`, `full_name_ko` | text | 대표 풀네임 또는 확장명 |
| `domain` | text[] | ISP, HW, SW, Optics, PM … 동음이의어 구분축 |
| `category` | text[] | `business_categories.key` 목록. 쓰기 API가 존재 여부를 검증 |
| `topic` | text | 팀별 세부 주제. 자유 입력 단일 값 |
| `owner_id` | uuid | 완성을 책임질 사용자. 삭제되면 null |
| `status` | enum | `draft` \| `active` \| `deprecated` \| `forbidden` |
| `definition_md` | text | 1~2문장 정의 (API 응답·툴팁용) |
| `body_md` | text | 위키 본문 (마크다운) |
| `replaced_by_id` | uuid | `deprecated`일 때 대체 용어 |
| `created_by`, `updated_by` | uuid | 감사 컬럼. API 응답에 싣지 않는다 |
| `created_at`, `updated_at` | timestamptz | |

## business_categories — 관리형 업무 분류

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `key` | text | PK. 용어와 공유 URL이 참조하는 안정적인 값 |
| `label` | text | 화면에 표시하는 국문 이름 |
| `label_en` | text | 영문 이름. 분류를 추가할 때 국문 이름과 함께 필수 |
| `sort_order` | integer | 선택 목록과 필터의 표시 순서 |
| `created_at`, `updated_at` | timestamptz | |

기본 설치에는 제품·고객·프로젝트·공정·설계·평가·장비·조직·시스템·기타가 들어간다.
목록은 사이드바의 **분류 체계**에서 확장한다. 일반 사용자도 추가하고 미사용 분류를
삭제할 수 있지만, 하나 이상의 용어가 쓰는 분류는 관리자만 삭제할 수 있다.

## domains — 관리형 도메인

`key`, 화면 이름 `label`, 고유한 72색 팔레트 키 `color`, `sort_order`를 가진다. 용어의 `domain`은 여러 도메인 key를
담는 배열이다. 업무 분류와 함께 **분류 체계** 화면에서 관리하며, 편집 화면에서 정의되지
않은 값을 입력하면 새 문자열을 암묵적으로 만들지 않고 해당 화면으로 안내한다.

## AI 활용 설정

- **workspace_settings** — `definition_min_chars`, `body_min_chars`로 조직 전체의 최소
  정의·본문 길이를 보관한다. 0은 내용 자체를 생략한다는 뜻이 아니라 존재 여부만 검사한다.
- **ai_config** — 공급자, Base URL, 모델, 사용 여부를 담는 단일 행이다. API Key와
  custom header 값은 애플리케이션이 AES-256-GCM으로 암호화한 문자열만 저장한다.
- **ai_review_suggestions** — 정리 대기 용어의 현재 리비전에 대해 미리 생성한 제안과
  생성기 버전을 저장한다. 용어 리비전 또는 생성기 버전이 달라지면 오래된 캐시로 취급한다.
- **ai_review_queue** — 용어별 최신 AI 검토 요청을 `queued`, `processing`, `ready`,
  `failed` 상태로 관리한다. 자동·수동 요청 여부, 요청자와 처리 시각을 함께 기록한다.

용어의 표기·상태·내용과 전역 최소 길이를 결합해 완성도를 자동 계산한다. 자세한 판정은
[AI 활용과 챗봇](/guide/ai#콘텐츠-완성도-자동-판정)을 참고한다.

## term_surfaces — 그 개념을 가리키는 모든 실제 표기

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid | PK |
| `term_id` | uuid | → `terms.id` (ON DELETE CASCADE) |
| `text` | text | `"Auto Exposure"`, `"AE"`, `"자동노출"`, `"오토익스포저"` |
| `lang` | enum | `en` \| `ko` \| `neutral` |
| `kind` | enum | `canonical` \| `abbreviation` \| `full_name` \| `alias` \| `discouraged` \| `forbidden` |
| `case_sensitive` | boolean | `"AE"`처럼 대소문자가 의미 있으면 true |
| `norm_loose` | text | 정규화 키 — 구분자 전부 제거 (`autoexposure`) |
| `norm_space` | text | 정규화 키 — 구분자를 단일 공백으로 (`auto exposure`) |

인덱스는 넷이다. `norm_loose` / `norm_space` B-tree(정확 매칭),
`norm_loose` GIN + `gin_trgm_ops`(유사 후보), `term_id`.
유니크 제약은 `(term_id, norm_loose, kind)`다 — 같은 용어에 같은 표기를 같은 종류로
두 번 넣지 못한다.

`AE` 표기에는 `kind=abbreviation`을 지정한다.

::: tip 정규화 컬럼은 손으로 채우지 않는다
`norm_loose`/`norm_space`는 `@glossary/db`의 `surfaceKeys()`가 채운다. 그 함수는
`@glossary/engine`의 `normalizeSurface()`를 그대로 호출한다.
[아키텍처 § 정규화 함수의 단일 소유](/guide/architecture#반드시-지켜야-할-제약-정규화-함수의-단일-소유)를 본다.
:::

## 세 가지 검증이 떨어지는 방식

| 검증 | 판정 조건 |
|---|---|
| 비표준 표기 교정 | `surface.kind`가 `alias`/`discouraged` → 해당 Term의 canonical 제안 |
| 금지어·폐기어 | `kind='forbidden'` 또는 `Term.status`가 `deprecated`/`forbidden` → `replaced_by` 제안 |
| 동음이의 경고 | 같은 정규화 키가 서로 다른 Term 2개 이상에 연결 → domain과 함께 제시 |

같은 표기가 여러 kind로 등록돼 있을 때 어느 것을 대표로 삼는지는 코드에 명시 고정되어
있다(`apps/web/src/lib/terms/lookup.ts`의 `MATCH_KIND_PRIORITY`).

```
forbidden > discouraged > canonical > abbreviation > full_name > alias
```

행 순서에 기대면 안 되기 때문이다. 같은 표기가 alias이자 forbidden으로 등록돼 있을 때
alias가 먼저 나오면 린터가 금지 표기를 놓친다.

## term_revisions — 전체 이력

변경마다 Term + Surfaces **전체를 jsonb 스냅샷**으로 적재한다. diff와 롤백은 스냅샷
비교로 계산하며 diff를 따로 저장하지 않는다.

| 컬럼 | 설명 |
|---|---|
| `term_id`, `revision_number` | 유니크. 용어별로 1부터 증가 |
| `snapshot` | jsonb — 그 시점의 Term + Surfaces 전체 |
| `message` | 변경 메모 |
| `author_id` | 세션 사용자. API 키 요청이면 null |
| `author_key_id` | API 키 요청일 때 어느 키였는지 |

`author_key_id`가 따로 있는 이유는 API 키로 만든 리비전의 `author_id`가 항상 null이라
누가 썼는지 구분할 수 없었기 때문이다. 나중에 채울 수 없는 값이라 처음부터 넣었다.

`revision_number`는 **낙관적 잠금의 기준**이기도 하다. 편집 화면이 읽은 번호를
`expectedRevision`으로 되돌려 보내고, 그 사이 남이 고쳤으면 서버가 409
`revision_conflict`를 돌려준다. 자세한 것은 [용어 API](/api/terms#낙관적-잠금)에 있다.

## term_relations — 승인된 용어 관계

AI가 찾은 관계는 바로 검색 그래프에 넣지 않고 `proposed`로 저장해 사람이 검토할 수 있게
한다. RAG의 그래프 확장에는 `approved` 관계만 사용한다.

| 컬럼 | 설명 |
|---|---|
| `source_term_id`, `target_term_id` | 관계의 출발·도착 용어. 같은 용어끼리는 연결할 수 없음 |
| `relation_type` | `related_to`, `is_a`, `part_of`, `used_in`, `prerequisite_of`, `replaces` |
| `status` | `proposed`, `approved`, `rejected` |
| `confidence` | 제안 신뢰도 0~100. 검색 확장 가중치에도 사용 |
| `evidence_md` | 관계를 제안하거나 승인한 근거 |
| `source_revision`, `target_revision` | 어느 용어 리비전을 보고 제안했는지 기록 |
| `created_by`, `reviewed_by` | 제안·검토 사용자 |

같은 `(source, target, type)` 관계는 한 행만 존재하며 상태를 바꿔 다시 검토한다. 용어가
삭제되면 연결도 함께 삭제된다.

## 인증 테이블

- **users** — `email`(유니크), `name`, `password_hash`, `role`(`admin` \| `editor`),
  `external_id`(OIDC/OAuth 사용자 식별자), `sso_groups`.
- **sessions** — `id`(쿠키에 실리는 값), `user_id`, `expires_at`.
- **api_keys** — 해시만 저장한다. `prefix`(유니크)로 식별하고 `scopes`로 제한하며
  `revoked_at`/`expires_at`으로 수명을 관리한다.
- **sso_config** — 활성 `mode`(`disabled` \| `oidc` \| `oauth2` \| `oauth2-proxy`),
  ID/비밀번호 로그인 허용 여부, 직접 연결용 `protocol`, Issuer/JWKS/엔드포인트, 클라이언트
  정보, claim 후보와 접근 그룹을 담는 단일 설정 행. 클라이언트 시크릿은 API 응답에
  내보내지 않는다.

## 중복 방지

두 단계로 잡는다.

1. **등록 시점** — 정규화 키 충돌을 즉시 경고한다. 동음이의어는 허용하되 사람이 반드시
   확인하게 한다. 그래서 `POST /terms`는 409를 던지지 않고 **201 응답에 `warnings`를
   실어 보낸다.** 등록을 막으면 설계 결정과 어긋난다.
2. **별도 리포트** — `pg_trgm` 유사도 기반 "잠재 중복" 목록. 병합은
   `merge(source → target)`으로 surface를 이관하고 옛 slug는 리다이렉트로 남긴다(M3).

## 아직 없는 테이블

설계에는 있지만 M1 범위 밖이라 아직 만들지 않았다.

- **UnregisteredCandidate** — 미등록 후보 누적 (M2).
- **Attachment / AttachmentRef** — WebP로 변환한 content-addressed 첨부 이미지. 현재 본문 참조는 `AttachmentRef`로 동기화되며 이미지 실체는 이력 보존을 위해 자동 삭제하지 않는다.
