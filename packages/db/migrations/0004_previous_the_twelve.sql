-- R131: 로그인 화면 개방 가입. 대소문자만 다른 이메일이 서로 다른 계정이 되면
-- 로그인(lower(email)로 조회)이 어느 계정으로 들어갈지 행 순서에 달린다.
-- 이미 그런 중복이 들어 있는 DB에서는 이 인덱스 생성이 실패한다 — 그게 맞다.
-- 조용히 한쪽을 고르는 것보다 마이그레이션이 멈추고 사람이 정리하는 편이 낫다.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_unique" ON "users" USING btree (lower("email"));