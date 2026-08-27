#!/usr/bin/env bash
#
# 백업 복구. **이 스크립트는 데이터를 파괴할 수 있다.**
#
# R126: 스케치는 dump를 한 번도 검사하지 않고 `DROP DATABASE`부터 했다.
# dump가 잘렸거나 손상됐거나 다른 버전이면 그 사실을 **DB를 이미 지운 뒤에**
# 알게 되고, 되돌릴 방법이 없다. 게다가 app 컨테이너가 연결을 붙들고 있으면
# DROP은 "database is being accessed by other users"로 실패한다 —
# 성공해도 위험하고 실패해도 혼란스러운 절차였다.
#
# 여기서는 순서를 뒤집는다:
#   1) dump를 먼저 검증한다 (pg_restore --list)
#   2) 현재 DB의 안전 덤프를 뜬다 — 유일한 되돌리기 수단이다
#   3) 사람에게 명시적으로 확인받는다 (set -euo pipefail로는 실수를 못 막는다)
#   4) app 컨테이너를 멈춘 뒤 교체하고, 끝나면 다시 띄운다
#
# 그리고 **리허설 경로**(--rehearse)를 제공한다. 별도 DB(grossary_rehearsal)로
# 복구해 검증만 하고 운영 DB는 건드리지 않는다. docs/operations.md의
# "복구 절차는 실제로 한 번 실행해서 확인한 뒤 운영에 들어간다"는 지침은
# **이 경로를 가리킨다** — 그 지침을 운영 DB에 그대로 적용하면 안 된다.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

usage() {
  cat >&2 <<USAGE
사용법:
  scripts/restore.sh --rehearse <dump파일>   # 안전: 별도 DB로 복구해 검증만 한다
  scripts/restore.sh --force   <dump파일>   # 위험: 운영 DB를 이 dump로 교체한다

--force는 확인 문구를 직접 타이핑해야 진행된다.
USAGE
  exit 2
}

MODE=""
DUMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rehearse) MODE="rehearse"; shift ;;
    --force)    MODE="force";    shift ;;
    -*)         usage ;;
    *)          DUMP="$1";       shift ;;
  esac
done
[ -n "$MODE" ] && [ -n "$DUMP" ] || usage
[ -f "$DUMP" ] || { echo "dump 파일이 없다: $DUMP" >&2; exit 1; }

container_tmp="/tmp/restore-$(date +%s).dump"
# app을 멈춘 뒤 pg_restore가 실패하면 set -e가 여기서 스크립트를 끝낸다. 그대로
# 두면 DB는 반쯤 복구된 채 서비스가 죽어 있다. 멈춘 사실을 기록해뒀다가 정상
# 종료가 아니면 다시 띄운다 — 사람이 손으로 복구할 때 최소한 화면은 살아 있다.
app_stopped=0
done_ok=0
cleanup() {
  compose exec -T postgres rm -f "$container_tmp" >/dev/null 2>&1 || true
  if [ "$app_stopped" = "1" ] && [ "$done_ok" = "0" ]; then
    echo "복구가 정상 종료되지 않았다. app 컨테이너를 다시 띄운다." >&2
    compose start app || true
  fi
}
trap cleanup EXIT

echo "[1/4] dump를 컨테이너로 복사하고 검증한다"
compose cp "$DUMP" "postgres:${container_tmp}"
if ! compose exec -T postgres pg_restore --list "$container_tmp" >/dev/null; then
  echo "중단: dump를 pg_restore가 읽지 못한다. 아무것도 건드리지 않았다." >&2
  exit 1
fi
echo "      검증 통과."

if [ "$MODE" = "rehearse" ]; then
  target="grossary_rehearsal"
  echo "[2/4] 리허설 DB(${target})를 새로 만든다 — 운영 DB는 건드리지 않는다"
  compose exec -T postgres psql -U grossary -d postgres \
    -c "DROP DATABASE IF EXISTS ${target};" -c "CREATE DATABASE ${target};"
  echo "[3/4] 리허설 DB로 복구"
  compose exec -T postgres pg_restore -U grossary -d "$target" --no-owner "$container_tmp"
  echo "[4/4] 복구 결과 확인"
  compose exec -T postgres psql -U grossary -d "$target" -At \
    -c "select 'terms=' || count(*) from terms;" \
    -c "select 'term_surfaces=' || count(*) from term_surfaces;" \
    -c "select 'term_revisions=' || count(*) from term_revisions;"
  echo "리허설 완료. 위 건수가 예상과 맞으면 이 백업은 복구 가능하다."
  echo "리허설 DB를 지우려면:"
  echo "  docker compose -f ${COMPOSE_FILE} exec -T postgres psql -U grossary -d postgres -c 'DROP DATABASE ${target};'"
  exit 0
fi

# ---- 여기서부터 파괴적 ----
echo
echo "!! 운영 DB(grossary)를 ${DUMP} 내용으로 교체한다. 현재 데이터는 사라진다."
echo "!! 진행하려면 정확히 다음을 입력해라: replace grossary"
printf '> '
read -r confirm
[ "$confirm" = "replace grossary" ] || { echo "중단했다. 아무것도 건드리지 않았다."; exit 1; }

mkdir -p "$BACKUP_DIR"
safety="${BACKUP_DIR}/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
echo "[2/4] 되돌리기용 안전 덤프: ${safety}"
safety_tmp="/tmp/pre-restore-$(date +%s).dump"
compose exec -T postgres sh -c "pg_dump -U grossary -Fc grossary > '${safety_tmp}'"
compose exec -T postgres pg_restore --list "$safety_tmp" >/dev/null
compose cp "postgres:${safety_tmp}" "$safety"
compose exec -T postgres rm -f "$safety_tmp" >/dev/null 2>&1 || true
echo "      안전 덤프 확보. 복구가 잘못되면 이 파일로 되돌린다."

echo "[3/4] app 컨테이너를 멈춘다 (연결이 남아 있으면 DROP DATABASE가 실패한다)"
compose stop app
app_stopped=1

echo "[4/4] DB 교체"
compose exec -T postgres psql -U grossary -d postgres \
  -c "DROP DATABASE IF EXISTS grossary;" -c "CREATE DATABASE grossary;"
compose exec -T postgres pg_restore -U grossary -d grossary --no-owner "$container_tmp"

echo "app 컨테이너를 다시 띄운다"
done_ok=1
compose start app

echo "완료. 되돌리려면: scripts/restore.sh --force '${safety}'"
