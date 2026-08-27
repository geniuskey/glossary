#!/usr/bin/env bash
#
# 용어집 전체 백업. 첨부 이미지까지 Postgres bytea에 들어 있으므로
# 이 dump 파일 하나가 회사 용어집 전부다.
#
# R127: 스케치는 `docker compose exec -T postgres pg_dump ... > "$OUT"` 한 줄이었다.
# 셸이 `>`로 $OUT을 **먼저 만들고 비운 다음** 명령을 실행하므로, 컨테이너가 안 떠
# 있거나 서비스명이 틀리거나 인증이 실패하면 0바이트 파일이 그대로 남는다.
# pg_dump가 도중에 죽으면 부분 dump가 남는데 이쪽이 더 나쁘다 — 크기가 0이
# 아니라 육안으로 정상처럼 보인다. cron으로 매일 돌면 그럴듯한 이름의 쓰레기가
# 쌓이고 아무도 눈치채지 못한다.
# `set -o pipefail`은 이걸 못 막는다. 리다이렉션은 파이프가 아니다.
#
# 그래서 이 스크립트는:
#   1) 컨테이너 안 임시 파일에 dump를 쓴다 (호스트의 최종 파일을 건드리지 않는다)
#   2) `pg_restore --list`로 실제로 읽히는지 검증한다
#   3) 호스트 임시 파일로 꺼낸 뒤 크기를 확인한다
#   4) 전부 통과했을 때만 최종 이름으로 원자적 rename 한다
# 실패하면 임시 파일을 지우고 0이 아닌 종료 코드로 알린다(cron이 볼 수 있게).

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
# 정상 백업이라면 이보다는 크다. 스키마만 있고 데이터가 통째로 빠진 dump를 잡는다.
MIN_BYTES="${MIN_BYTES:-4096}"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

stamp="$(date +%Y%m%d-%H%M%S)"
final="${BACKUP_DIR}/grossary-${stamp}.dump"
host_tmp="${final}.partial"
container_tmp="/tmp/grossary-${stamp}.dump"

cleanup() {
  rm -f "$host_tmp"
  compose exec -T postgres rm -f "$container_tmp" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"

echo "[1/4] dump 생성 중 (컨테이너 내부: ${container_tmp})"
compose exec -T postgres sh -c "pg_dump -U grossary -Fc grossary > '${container_tmp}'"

echo "[2/4] dump 검증 중 (pg_restore --list)"
if ! compose exec -T postgres pg_restore --list "$container_tmp" >/dev/null; then
  echo "실패: dump를 pg_restore가 읽지 못한다. 백업 파일을 남기지 않는다." >&2
  exit 1
fi

echo "[3/4] 호스트로 복사 중"
compose cp "postgres:${container_tmp}" "$host_tmp"

size="$(wc -c < "$host_tmp" | tr -d ' ')"
if [ "$size" -lt "$MIN_BYTES" ]; then
  echo "실패: dump가 ${size}바이트다 (최소 ${MIN_BYTES}). 백업 파일을 남기지 않는다." >&2
  exit 1
fi

echo "[4/4] 최종 이름으로 이동"
mv "$host_tmp" "$final"

echo "완료: ${final} (${size} bytes)"
echo "복구 리허설: scripts/restore.sh --rehearse '${final}'"
