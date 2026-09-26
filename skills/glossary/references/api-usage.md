# Glossary API 사용

모든 경로의 기준은 `$GLOSSARY_URL/api/v1`이다. 예: `https://glossary.example.com/api/v1`. `localhost:3000`은 로컬 실행 예시일 뿐이므로 실제 대상 서버를 확인한다. 서버의 `GET /api/v1/openapi`로 배포된 API 형식을 확인한다.

## 인증과 호출

- 에이전트/스크립트: `Authorization: Bearer $GLOSSARY_API_KEY`(`glk_<prefix>_<secret>`). 조회에는 `read`, 생성·수정에는 `write`, 문서 검증(`/validate`)에는 `validate` scope가 필요하다. scope는 서로 포함하지 않으므로 조회와 수정을 함께 하려면 `read`와 `write`가 모두 있어야 한다.
- 브라우저 UI: 로그인 세션 쿠키를 사용한다. 세션 호출에 임의의 `Authorization` 헤더를 붙이면 API 키 인증 경로로 처리된다.
- JSON 요청: `Content-Type: application/json`. URL 경로의 slug와 검색어는 URL 인코딩한다. 토큰은 환경의 비밀 저장소나 이미 제공된 연결에서 읽고 요청 예시·응답 보고·로그에 실값을 남기지 않는다.
- API 키로 할 수 없는 일: 용어 삭제와 위키 공개·보관(관리자 세션), 관계 제안·승인·거절(로그인 사용자 세션, 역할 무관), AI 제안 저장(로그인 사용자 세션). 이 경우 변경안만 만들어 사용자에게 넘긴다.

예시의 HTTP 본문은 서버 주소와 토큰을 바꿔 전송한다. 성공 응답도 상태 코드와 본문을 모두 확인한다.

## 용어를 찾아 수정하기

1. 표기 후보 검색: `GET /terms?q=AE` 또는 여러 표기를 한 번에 `POST /terms/lookup` 본문 `{"texts":["AE","Auto Exposure"]}`. 목록은 페이지가 있으므로 `total`과 `page`를 확인한다.
2. 후보 상세: `GET /terms/{idOrSlug}`. 상세 응답은 `{ term }` 하나이고 그 안에 `surfaces`, `homonyms`가 있다. 최신 리비전 번호는 `GET /terms/{idOrSlug}/revisions`의 첫 `revisionNumber`에서 얻는다. 상세의 `updatedAt`을 리비전 번호로 사용하지 않는다. 여러 용어를 다룰 때는 `GET /terms/catalog` 한 번으로 전체 용어·표기·`revision`을 받는 편이 호출이 적다(`If-None-Match`로 변경 여부 확인).
3. 일부 필드만 수정할 때:

   ```http
   PATCH /api/v1/terms/auto-exposure
   Authorization: Bearer <write-token>
   Content-Type: application/json

   {"definitionMd":"장면 밝기에 맞춰 노출을 자동으로 조절하는 기능.","expectedRevision":6}
   ```

   `surfaces`를 생략하면 기존 명시 표기가 유지된다. 보내면 전체 명시 표기를 교체한다. 응답의 `{term,surfaces,warnings}`를 확인하고 다시 조회한다.

4. 새 개념은 기존 표기·도메인·동음이의어를 확인한 후 `POST /terms`로 만든다:

   ```http
   POST /api/v1/terms
   Authorization: Bearer <write-token>
   Content-Type: application/json

   {"nameEn":"Auto Exposure","nameKo":"자동 노출","domain":["ISP"],"definitionMd":"장면 밝기에 맞춰 노출을 자동으로 조절하는 기능.","surfaces":[{"text":"AE","lang":"en","kind":"abbreviation"}]}
   ```

   표기 충돌은 성공 응답의 `warnings`로 올 수 있다. 요청한 `status` 대신 서버가 계산한 실제 `term.status`를 확인한다.

5. 대량 작업은 `POST /terms/batch`에 `{"dryRun":true,"items":[...]}`를 보내 행별 결과를 검토한다. 반영은 `dryRun:false`, 고유한 `Idempotency-Key` 헤더, 각 수정 행의 `expectedRevision`을 넣는다. 일부 행만 성공할 수 있으므로 `results`를 모두 검사한다.

## 위키를 찾아 작성하기

1. `GET /wiki?q=출시`로 후보를 찾고 `GET /wiki/{slug}`로 본문·상태·연결 용어를 읽는다. 목록은 기본적으로 archived를 제외한다.
2. 새 초안:

   ```http
   POST /api/v1/wiki
   Authorization: Bearer <write-token>
   Content-Type: application/json

   {"title":"출시 기준 플레이북","summary":"베타 출시 전 검토 절차","sourceUrl":"https://example.com/source","termSlugs":["release-gate"],"status":"draft","content":"## 검토 절차\n\n근거가 확인된 절차를 적는다."}
   ```

   `termSlugs`는 실제 용어 slug여야 한다. 출처가 없다면 `sourceUrl`을 임의로 만들지 말고 생략한다.

3. 기존 문서는 PATCH 직전에 다시 읽는다. 예: `PATCH /wiki/{slug}` 본문 `{"summary":"갱신된 요약","content":"..."}`. 공개 문서는 API 키로 상태를 유지한 채 수정할 수 없고, `"status":"draft"`를 함께 보내면 공개가 중단되어 공식 검색에서 제외된다. 사용자 동의 없이 그렇게 하지 않는다. 위키 PATCH는 `expectedRevision`을 받지 않으므로 초안 시점의 `revision`과 다시 읽은 `revision`을 비교하고, 달라졌으면 차이를 반영한 뒤 저장한다.
4. `POST /rag/wiki/search`는 공개 문서만 검색한다. 저장 응답의 `indexed:false`는 색인 대기 상태다.

## 오류 대응

오류는 `{ "error": { "code": "...", "message": "...", "details": { ... } } }` 형식이다. `401 unauthorized`는 인증, `403 forbidden`은 scope/역할, `400 validation_failed`는 요청 필드, `404`는 대상, `409 revision_conflict`는 동시 수정을 확인한다. 충돌 시 최신 리비전과 내용을 다시 읽어 변경안을 재검토한다. 같은 요청을 무조건 재시도하지 않는다. `502/503` RAG 오류는 저장 실패와 구분한다. 필드 단위 규약은 서버의 `GET /openapi`를 본다.
