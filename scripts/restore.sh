#!/usr/bin/env bash
#
# 백업 복구. **이 스크립트는 데이터를 파괴할 수 있다.**
#
# R126: 스케치는 dump를 한 번도 검사하지 않고 `DROP DATABASE`부터 했다.
# dump가 잘렸거나 손상됐거나 다른 버전이면 그 사실을 **DB를 이미 지운 뒤에**
# 알게 되고, 되돌릴 방법이 없다. 게다가 app·rag-worker 컨테이너가 연결을 붙들고
# 있으면 DROP은 "database is being accessed by other users"로 실패한다 —
# 성공해도 위험하고 실패해도 혼란스러운 절차였다.
#
# 여기서는 순서를 뒤집는다:
#   1) dump를 먼저 검증한다 (pg_restore --list)
#   2) 현재 DB의 안전 덤프를 뜬다 — 유일한 되돌리기 수단이다
#   3) 사람에게 명시적으로 확인받는다 (set -euo pipefail로는 실수를 못 막는다)
#   4) app·rag-worker 컨테이너를 멈춘 뒤 교체한다. 교체가 실패하면 안전을 위해 멈춘 채 둔다
#
# 그리고 **리허설 경로**(--rehearse)를 제공한다. 별도 DB(glossary_rehearsal)로
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

기본 대상은 docker-compose.prod.yml(소스 빌드 배포)이다.
Docker Hub 배포는 반드시 Compose 파일을 지정한다:
  COMPOSE_FILE=docker-compose.hub.yml scripts/restore.sh --rehearse <dump파일>
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
# app을 멈춘 뒤 pg_restore가 실패하면 set -e가 여기서 스크립트를 끝낸다.
# DB가 반쯤 복구됐을 수 있으므로, 교체가 시작된 뒤에는 app을 자동으로 다시 띄우지
# 않는다. DB를 건드리기 전에 실패한 경우에만 복구 전 실행 상태로 되돌린다.
services_stopped=0
# 실제로 떠 있던 서비스만 다시 띄운다 — 사람이 일부러 내려 둔 서비스를 복구가 살리면 안 된다.
was_running=""
db_replace_started=0
done_ok=0
cleanup() {
  compose exec -T postgres rm -f "$container_tmp" >/dev/null 2>&1 || true
  if [ "$services_stopped" = "1" ] && [ "$done_ok" = "0" ]; then
    if [ "$db_replace_started" = "0" ]; then
      if [ -n "$was_running" ]; then
        echo "DB 교체 전에 복구가 중단됐다. 원래 실행 중이던 서비스를 다시 띄운다:${was_running}" >&2
        # shellcheck disable=SC2086
        compose start $was_running || true
      fi
    else
      echo "복구가 정상 종료되지 않았다. DB 상태 확인 전까지 app·rag-worker를 중지한 채 둔다." >&2
      if [ -n "${safety:-}" ]; then
        echo "안전 덤프: ${safety}" >&2
      fi
    fi
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
  target="glossary_rehearsal"
  echo "[2/4] 리허설 DB(${target})를 새로 만든다 — 운영 DB는 건드리지 않는다"
  compose exec -T postgres psql -U glossary -d postgres \
    -c "DROP DATABASE IF EXISTS ${target};" -c "CREATE DATABASE ${target};"
  echo "[3/4] 리허설 DB로 복구"
  compose exec -T postgres pg_restore -U glossary -d "$target" --no-owner "$container_tmp"
  echo "[4/4] 복구 결과 확인"
  compose exec -T postgres psql -U glossary -d "$target" -At \
    -c "select 'terms=' || count(*) from terms;" \
    -c "select 'term_surfaces=' || count(*) from term_surfaces;" \
    -c "select 'term_revisions=' || count(*) from term_revisions;"
  echo "리허설 완료. 위 건수가 예상과 맞으면 이 백업은 복구 가능하다."
  echo "리허설 DB를 지우려면:"
  echo "  docker compose -f ${COMPOSE_FILE} exec -T postgres psql -U glossary -d postgres -c 'DROP DATABASE ${target};'"
  exit 0
fi

# ---- 여기서부터 파괴적 ----
echo
echo "!! 운영 DB(glossary)를 ${DUMP} 내용으로 교체한다. 현재 데이터는 사라진다."
echo "!! 진행하려면 정확히 다음을 입력해라: replace glossary"
printf '> '
read -r confirm
[ "$confirm" = "replace glossary" ] || { echo "중단했다. 아무것도 건드리지 않았다."; exit 1; }

mkdir -p "$BACKUP_DIR"
safety="${BACKUP_DIR}/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
echo "[2/4] 되돌리기용 안전 덤프: ${safety}"
safety_tmp="/tmp/pre-restore-$(date +%s).dump"
compose exec -T postgres sh -c "pg_dump -U glossary -Fc glossary > '${safety_tmp}'"
compose exec -T postgres pg_restore --list "$safety_tmp" >/dev/null
compose cp "postgres:${safety_tmp}" "$safety"
compose exec -T postgres rm -f "$safety_tmp" >/dev/null 2>&1 || true
echo "      안전 덤프 확보. 복구가 잘못되면 이 파일로 되돌린다."

echo "[3/4] DB 클라이언트 컨테이너를 멈춘다 (연결이 남아 있으면 DROP DATABASE가 실패한다)"
# rag-worker도 2초마다 폴링하며 idle 연결을 붙들고 있다. app만 멈추면 DROP이
# "being accessed by other users"로 실패하는데, 그 시점은 db_replace_started=1 이후라
# app이 내려간 채 남는다. Compose 파일마다 서비스 구성이 다를 수 있어 실제로 정의된
# 것만 멈춘다 — 없는 서비스 이름을 stop에 넘기면 compose가 실패한다.
defined_services="$(compose config --services)"
stop_targets=""
for svc in app rag-worker; do
  if printf '%s\n' "$defined_services" | grep -qx "$svc"; then
    stop_targets="${stop_targets} ${svc}"
    if [ -n "$(compose ps --status running -q "$svc" 2>/dev/null || true)" ]; then
      was_running="${was_running} ${svc}"
    fi
  fi
done
if [ -n "$stop_targets" ]; then
  # shellcheck disable=SC2086
  compose stop $stop_targets
fi
services_stopped=1

echo "[4/4] DB 교체"
db_replace_started=1
# WITH (FORCE)는 Compose 밖의 클라이언트(수동 psql 세션 등)가 남긴 연결까지 끊는다.
# 서비스를 멈추는 것만으로는 그런 연결을 막을 수 없다.
compose exec -T postgres psql -U glossary -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS glossary WITH (FORCE);" -c "CREATE DATABASE glossary;"
compose exec -T postgres pg_restore -U glossary -d glossary --no-owner "$container_tmp"

if [ -n "$was_running" ]; then
  echo "복구 전 실행 중이던 서비스를 다시 띄운다:${was_running}"
  # shellcheck disable=SC2086
  compose start $was_running
else
  echo "복구 전 app·rag-worker가 중지돼 있어 그대로 둔다"
fi
done_ok=1

echo "완료. 되돌리려면: COMPOSE_FILE=${COMPOSE_FILE} scripts/restore.sh --force '${safety}'"
