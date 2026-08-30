# 데이터 모델

핵심은 **개념(Term)과 표기(Surface)의 분리**다. 엑셀이 무너진 이유는 한 행이 개념이자
표기였기 때문이다. 이를 나누면 세 가지 검증이 모두 같은 테이블 조회로 풀린다.

## terms — 하나의 개념

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid | PK |
| `slug` | text | 유니크. URL 식별자 |
| `term_type` | enum | `term` \| `abbreviation` \| `project` \| `product_id` \| `code` \| `unit` |
| `name_en`, `name_ko` | text | 표준 표기. 최소 하나는 있어야 한다 |
| `full_name_en`, `full_name_ko` | text | 약어일 때 풀네임 |
| `domain` | text[] | ISP, HW, SW, Optics, PM … 동음이의어 구분축 |
| `category` | text | 도메인 아래에서 화면·기능·공정 등으로 묶는 단일 분류 |
| `owner_id` | uuid | 완성을 책임질 사용자. 삭제되면 null |
| `status` | enum | `draft` \| `active` \| `deprecated` \| `forbidden` |
| `definition_md` | text | 1~2문장 정의 (API 응답·툴팁용) |
| `body_md` | text | 위키 본문 (마크다운) |
| `replaced_by_id` | uuid | `deprecated`일 때 대체 용어 |
| `created_by`, `updated_by` | uuid | 감사 컬럼. API 응답에 싣지 않는다 |
| `created_at`, `updated_at` | timestamptz | |

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

::: tip 정규화 컬럼은 손으로 채우지 않는다
`norm_loose`/`norm_space`는 `@grossary/db`의 `surfaceKeys()`가 채운다. 그 함수는
`@grossary/engine`의 `normalizeSurface()`를 그대로 호출한다.
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

## 인증 테이블

- **users** — `email`(유니크), `name`, `password_hash`, `role`(`admin` \| `editor`),
  `external_id`(SSO 자리).
- **sessions** — `id`(쿠키에 실리는 값), `user_id`, `expires_at`.
- **api_keys** — 해시만 저장한다. `prefix`(유니크)로 식별하고 `scopes`로 제한하며
  `revoked_at`/`expires_at`으로 수명을 관리한다.

## 중복 방지

두 단계로 잡는다.

1. **등록 시점** — 정규화 키 충돌을 즉시 경고한다. 동음이의어는 허용하되 사람이 반드시
   확인하게 한다. 그래서 `POST /terms`는 409를 던지지 않고 **201 응답에 `warnings`를
   실어 보낸다.** 등록을 막으면 설계 결정과 어긋난다.
2. **별도 리포트** — `pg_trgm` 유사도 기반 "잠재 중복" 목록. 병합은
   `merge(source → target)`으로 surface를 이관하고 옛 slug는 리다이렉트로 남긴다(M3).

## 아직 없는 테이블

설계에는 있지만 M1 범위 밖이라 아직 만들지 않았다.

- **TermRelation** — `related` \| `broader` \| `narrower` \| `see_also`. 본문의 위키 링크가
  여기 실체화되어 역참조 목록이 자동 생성된다 (M3).
- **UnregisteredCandidate** — 미등록 후보 누적 (M2).
- **Attachment / AttachmentRef** — content-addressed 첨부 이미지 (M3).
