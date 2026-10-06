#!/usr/bin/env bash
# Production release — OPERATIONS §9 step 3 (DB → app), run by the 회장 by hand.
#
#   bash scripts/release-production.sh 0049
#   bash scripts/release-production.sh 0050 0051 0052
#
# The arguments are the migrations you expect the production dry-run to list. If the dry-run
# shows anything else (more, fewer, or nothing), the script stops before writing.
# Whatever happens after the production link, the workdir is re-linked to staging on exit.
set -euo pipefail

PRODUCTION_REF=nndvspgnljivkvihxlzj
STAGING_REF=itpenmxyracfhyormcep
APP_URL="${APP_URL:-https://chairman-os-eosin.vercel.app}"
APP_URL="${APP_URL%/}"
GITHUB_REPO=scottushong/chairman-os

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
REF_FILE="supabase/.temp/project-ref"

die() { echo; echo "중단: $*" >&2; exit 1; }
step() { echo; echo "== $* =="; }
confirm() {
  local prompt="$1" answer=""
  printf '%s ' "$prompt"
  read -r answer || true
  [ "$answer" = "YES" ]
}
supabase_cli() { npx --no-install supabase "$@"; }

# One assignment of KEY in FILE, quotes and CR stripped. A second definition is refused —
# the last line would silently decide the target (same rule as scripts/db-safety.mjs).
env_value() {
  local file="$1" key="$2" lines
  [ -f "$file" ] || die "$file 이 없다."
  lines="$(grep -E "^${key}=" "$file" || true)"
  [ -n "$lines" ] || die "$file 에 $key 가 없다."
  [ "$(printf '%s\n' "$lines" | wc -l)" -eq 1 ] || die "$file 에 $key 가 두 번 이상 있다."
  printf '%s' "${lines#*=}" | tr -d '\r' | sed -E 's/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/'
}
linked_ref() { [ -f "$REF_FILE" ] && tr -d '\r\n ' < "$REF_FILE" || true; }

[ $# -ge 1 ] || die "기대 마이그레이션 번호를 인자로 준다. 예: bash scripts/release-production.sh 0049"
for n in "$@"; do [[ "$n" =~ ^[0-9]{4}$ ]] || die "'$n' — 번호는 네 자리 숫자다."; done
EXPECTED="$(printf '%s\n' "$@" | sort -u)"

# ---------------------------------------------------------------------------------------------
step "1. 브랜치 · 작업 트리"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "master" ] || die "현재 브랜치가 master가 아니다 ($BRANCH)."
[ -z "$(git status --porcelain)" ] || { git status --short; die "작업 트리가 깨끗하지 않다 (위 목록, 추적 안 된 파일 포함)."; }
git fetch --quiet origin master
RELEASE_SHA="$(git rev-parse --short HEAD)"
PREVIOUS_SHA="$(git rev-parse --short origin/master)"
echo "master 깨끗함. 릴리스 SHA $RELEASE_SHA, origin/master(현재 운영 앱) $PREVIOUS_SHA"

PROD_PASSWORD="$(env_value .env.local SUPABASE_DB_PASSWORD)"
STAGING_PASSWORD="$(env_value .env.staging.local SUPABASE_DB_PASSWORD)"
[[ "$(env_value .env.local NEXT_PUBLIC_SUPABASE_URL)" == *"$PRODUCTION_REF"* ]] || die ".env.local URL이 production($PRODUCTION_REF)이 아니다."
[[ "$(cat .env.staging.local)" != *"$PRODUCTION_REF"* ]] || die ".env.staging.local 안에 production ref가 있다."

# ---------------------------------------------------------------------------------------------
LINKED_PRODUCTION=0
relink_staging() {
  [ "$LINKED_PRODUCTION" = 1 ] || return 0
  echo
  echo "== 6. link를 staging($STAGING_REF)으로 되돌림 =="
  if SUPABASE_DB_PASSWORD="$STAGING_PASSWORD" supabase_cli link --project-ref "$STAGING_REF" >/dev/null 2>&1 \
     && [ "$(linked_ref)" = "$STAGING_REF" ]; then
    LINKED_PRODUCTION=0
    echo "staging으로 돌아왔다."
  else
    echo "경고: staging 재link 실패. 지금 link: $(linked_ref). 'npm run db:push:staging' 또는" >&2
    echo "      'npx supabase link --project-ref $STAGING_REF' 로 직접 되돌릴 것." >&2
  fi
}
trap relink_staging EXIT

step "2. 복원 지점 — production link 후 현재 버전 확인"
RESTORE_EPOCH="$(date -u +%s)"
RESTORE_UTC="$(date -u -d "@$RESTORE_EPOCH" '+%Y-%m-%d %H:%M')"
RESTORE_KST="$(date -u -d "@$((RESTORE_EPOCH + 9 * 3600))" '+%H:%M')"
RELEASE_DATE="$(date -u -d "@$RESTORE_EPOCH" '+%Y-%m-%d')"

LINKED_PRODUCTION=1
SUPABASE_DB_PASSWORD="$PROD_PASSWORD" supabase_cli link --project-ref "$PRODUCTION_REF" >/dev/null \
  || die "production link 실패."
[ "$(linked_ref)" = "$PRODUCTION_REF" ] || die "link된 ref가 production이 아니다 ($(linked_ref))."

MIGRATION_LIST="$(SUPABASE_DB_PASSWORD="$PROD_PASSWORD" supabase_cli migration list --linked 2>&1)" \
  || { echo "$MIGRATION_LIST"; die "migration list 실패."; }
# In a terminal the CLI prints a table (`0049` | ` ` | `0049`); outside one it prints
# {"migrations":[{"local","remote","time"}…]}. Both are read; other lines (update notice,
# "Connecting…") are ignored. A version missing on both sides (0004) simply has no row.
# Prints three lines: highest remote version / local-only (pending) / remote-only.
read_migrations() {
  node -e '
    const lines = require("fs").readFileSync(0, "utf8").split(/\r?\n/)
    const json = lines.find((l) => l.trim().startsWith("{\"migrations\""))
    let rows
    if (json) {
      rows = JSON.parse(json).migrations
    } else {
      rows = lines
        .map((l) => l.split("|").map((cell) => cell.replace(/[`\s]/g, "")))
        .filter((cells) => cells.length === 3 && cells.slice(0, 2).every((c) => c === "" || /^\d+$/.test(c)) && (cells[0] || cells[1]))
        .map(([local, remote, time]) => ({ local, remote, time }))
    }
    if (!rows.length) process.exit(1)
    const remote = rows.map((r) => r.remote).filter(Boolean).sort()
    console.log(remote[remote.length - 1] ?? "")
    console.log(rows.filter((r) => r.local && !r.remote).map((r) => r.local).sort().join(" "))
    console.log(rows.filter((r) => r.remote && !r.local).map((r) => r.remote).sort().join(" "))
  '
}
PARSED="$(printf '%s\n' "$MIGRATION_LIST" | read_migrations)" \
  || { echo "$MIGRATION_LIST"; die "migration list 출력을 읽지 못했다."; }
PROD_VERSION="$(sed -n 1p <<< "$PARSED")"
PENDING="$(sed -n 2p <<< "$PARSED")"
REMOTE_ONLY="$(sed -n 3p <<< "$PARSED")"
[ -n "$PROD_VERSION" ] || { echo "$MIGRATION_LIST"; die "production 현재 버전을 읽지 못했다."; }
[ -z "$REMOTE_ONLY" ] || die "production에만 있고 이 checkout에 없는 마이그레이션: $REMOTE_ONLY"

JOINED="$(printf '%s\n' "$EXPECTED" | paste -sd~ - | sed 's/~/ · /g')"
echo "복원 지점   $RESTORE_UTC UTC (= $RESTORE_KST KST)"
echo "production  $PROD_VERSION"
echo "직전 SHA    $PREVIOUS_SHA"
echo
echo "OPERATIONS §9 «되돌리는 길» 기록용:"
echo "$RELEASE_DATE 릴리스($JOINED · \`$RELEASE_SHA\`)의 값은 복원 지점 \`$RESTORE_UTC UTC\`(= \`$RESTORE_KST KST\`, production $PROD_VERSION)와 직전 SHA \`$PREVIOUS_SHA\`였다."

# ---------------------------------------------------------------------------------------------
step "3. dry-run"
DRY_RUN="$(SUPABASE_DB_PASSWORD="$PROD_PASSWORD" supabase_cli db push --linked --dry-run 2>&1)" \
  || { echo "$DRY_RUN"; die "dry-run 실패."; }
echo "$DRY_RUN"

step "4. 대기 목록 대조"
# Pending = local files production has not recorded (migration list). The dry-run text must name
# exactly those versions too — any other local version showing up there also stops the release.
LOCAL_VERSIONS="$(ls supabase/migrations | grep -oE '^[0-9]{4}' | sort -u)"
DRY_NAMED="$(printf '%s\n' "$DRY_RUN" | grep -oE '[0-9]+' | sort -u | grep -Fxf <(printf '%s\n' "$LOCAL_VERSIONS") | grep -Fxvf <(printf '%s\n' $PENDING) || true)"
echo "기대:              $(echo $EXPECTED)"
echo "대기(migration list): ${PENDING:-없음}"
[ "$(printf '%s\n' $PENDING)" = "$EXPECTED" ] || die "대기 목록이 기대와 다르다. 아무것도 쓰지 않았다."
for n in $EXPECTED; do
  grep -qE "(^|[^0-9])$n([^0-9]|\$)" <<< "$DRY_RUN" || die "dry-run 출력에 $n 이 없다. 아무것도 쓰지 않았다."
done
[ -z "$DRY_NAMED" ] || die "dry-run 출력에 다른 번호가 있다: $(echo $DRY_NAMED). 아무것도 쓰지 않았다."
echo "dry-run도 같은 목록이다."

# ---------------------------------------------------------------------------------------------
step "5. production DB push"
confirm "production($PRODUCTION_REF)에 $(echo $EXPECTED) 를 적용한다. 계속하려면 YES 입력:" \
  || die "YES가 아니다. DB는 그대로다."
SUPABASE_DB_PASSWORD="$PROD_PASSWORD" supabase_cli db push --linked --yes || die "db push 실패. OPERATIONS §9 «DB 마이그레이션 실패»를 따른다."
SUPABASE_DB_PASSWORD="$PROD_PASSWORD" supabase_cli migration list --linked || true

relink_staging
[ "$LINKED_PRODUCTION" = 0 ] || die "staging 재link가 안 됐다. 앱 배포 전에 link부터 되돌릴 것."

# ---------------------------------------------------------------------------------------------
step "7. origin 비교 → 앱 배포"
git fetch --quiet origin master
BEHIND="$(git rev-list --count master..origin/master)"
[ "$BEHIND" = 0 ] || { git log --oneline master..origin/master; die "origin에만 있는 커밋이 $BEHIND 개 있다 (위). DB는 이미 적용됐다 — 합친 뒤 git push만 따로 할 것."; }
echo "나갈 커밋:"
git log --oneline origin/master..master
confirm "git push origin master = Vercel Production 배포. 앱 배포하려면 YES 입력:" \
  || die "YES가 아니다. DB는 적용됐고 앱은 그대로다 — 준비되면 'git push origin master'."
git push origin master
PUSHED_SHA="$(git rev-parse HEAD)"

# ---------------------------------------------------------------------------------------------
step "8. health"
echo "Vercel 배포 완료를 기다린다 (최대 10분, $PUSHED_SHA)…"
STATE=""
for _ in $(seq 1 60); do
  DEPLOY_ID="$(curl -fsS "https://api.github.com/repos/$GITHUB_REPO/deployments?sha=$PUSHED_SHA&per_page=1" 2>/dev/null \
    | grep -oE '"id": *[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
  if [ -n "$DEPLOY_ID" ]; then
    STATE="$(curl -fsS "https://api.github.com/repos/$GITHUB_REPO/deployments/$DEPLOY_ID/statuses?per_page=1" 2>/dev/null \
      | grep -oE '"state": *"[a-z_]+"' | head -1 | grep -oE '"[a-z_]+"$' | tr -d '"' || true)"
    case "$STATE" in success|failure|error) break ;; esac
  fi
  sleep 10
done
echo "배포 상태: ${STATE:-알 수 없음}"
[ "$STATE" = "success" ] || echo "경고: 배포 success를 확인하지 못했다. 아래 health는 이전 배포일 수 있다 — Vercel 대시보드에서 Production(Current)을 볼 것." >&2

echo "GET $APP_URL/api/health"
curl -sS "$APP_URL/api/health" || true
echo
echo
echo "anon 쪽이 전부 rows: 0 · rls_closed: true 인지 본다 (OPERATIONS §1 배포 후 확인 1~4)."
echo "위 «기록용» 줄을 OPERATIONS §9 «되돌리는 길»에 붙인다."
