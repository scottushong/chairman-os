#!/usr/bin/env bash
# Checks scripts/release-production.sh without touching production or staging: npm run check:release
#
# Each case builds a throwaway git repo in a temp dir (with a local bare "origin"), copies the
# release script and supabase-guarded.mjs into it, and puts a FAKE Supabase CLI at
# node_modules/supabase/dist/supabase.js — the path supabase-guarded.mjs starts. The fake only
# reads/writes files inside the temp repo; nothing goes over the network. The release script is
# not changed for this — it simply runs in a repo whose CLI is fake.
#
# The fake knows remote history from FAKE_REMOTE, prints migration list as a table (default) or
# JSON (FAKE_FORMAT=json), and, like the real CLI, refuses a push/dry-run of out-of-order files
# unless --include-all is given. Every call's arguments go to FAKE_LOG.
#
# Every case answers the first YES prompt with «no» (or stops earlier), so no case ever reaches
# the real `db push`, `git push` or the health check.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PRODUCTION_REF=nndvspgnljivkvihxlzj
STAGING_REF=itpenmxyracfhyormcep

FAILED=0
CASE=""
OUT=""
LOG=""
REPO=""
CASE_FAILED=0
done_case() { if [ "$FAILED" = "$CASE_FAILED" ]; then echo "ok   $CASE"; else echo "FAIL $CASE"; CASE_FAILED=$FAILED; fi; }
fail() { echo "  FAIL [$CASE] $*"; FAILED=$((FAILED + 1)); }
expect_out() { grep -qF -- "$1" <<< "$OUT" || fail "출력에 «$1» 없음"; }
expect_no_out() { ! grep -qF -- "$1" <<< "$OUT" || fail "출력에 «$1» 있음"; }
expect_log() { grep -qE -- "$1" "$LOG" || fail "CLI 기록에 /$1/ 없음"; }
expect_no_log() { ! grep -qE -- "$1" "$LOG" 2>/dev/null || fail "CLI 기록에 /$1/ 있음"; }

write_fake_cli() {
  mkdir -p "$1/node_modules/supabase/dist"
  cat > "$1/node_modules/supabase/dist/supabase.js" <<'JS'
// FAKE Supabase CLI for scripts/check-release.sh. Never connects anywhere.
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2).filter((a, i, all) => !(a === '--agent' || all[i - 1] === '--agent'))
fs.appendFileSync(process.env.FAKE_LOG, args.join(' ') + '\n')
const has = (a) => args.includes(a)
const remote = (process.env.FAKE_REMOTE || '').split(/\s+/).filter(Boolean)
const files = fs.readdirSync('supabase/migrations').filter((f) => /^\d{4}_/.test(f)).sort()
const local = files.map((f) => f.slice(0, 4))
const pending = files.filter((f) => !remote.includes(f.slice(0, 4)))
const maxRemote = remote.slice().sort().pop() || ''

if (args[0] === 'link') {
  fs.mkdirSync('supabase/.temp', { recursive: true })
  fs.writeFileSync('supabase/.temp/project-ref', args[args.indexOf('--project-ref') + 1])
  process.exit(0)
}
if (args[0] === 'migration' && args[1] === 'list') {
  const all = [...new Set([...local, ...remote])].sort()
  if (process.env.FAKE_FORMAT === 'json') {
    console.log('Connecting to remote database...')
    console.log(JSON.stringify({ migrations: all.map((v) => ({ local: local.includes(v) ? v : '', remote: remote.includes(v) ? v : '', time: v })) }))
  } else {
    console.log('Connecting to remote database...')
    console.log('')
    console.log('   Local | Remote | Time (UTC) ')
    console.log('  -------|--------|------------')
    for (const v of all) {
      const l = local.includes(v) ? v : '    '
      const r = remote.includes(v) ? v : '    '
      console.log(`   ${l}  | ${r}   | ${remote.includes(v) ? v : l} `)
    }
  }
  process.exit(0)
}
if (args[0] === 'db' && args[1] === 'push') {
  const early = pending.filter((f) => f.slice(0, 4) < maxRemote)
  if (early.length && !has('--include-all')) {
    console.error('Found local migration files to be inserted before the last migration on remote database.\n')
    console.error('Rerun the command with --include-all flag to apply these migrations:')
    for (const f of early) console.error('supabase/migrations/' + f)
    process.exit(1)
  }
  if (has('--dry-run')) console.log('DRY RUN: migrations will *not* be pushed to the database.')
  if (!pending.length) { console.log('Remote database is up to date.'); process.exit(0) }
  console.log(has('--dry-run') ? 'Would push these migrations:' : 'Applying migrations:')
  for (const f of pending) console.log(' • ' + f)
  process.exit(0)
}
console.error('fake supabase: unknown command ' + args.join(' '))
process.exit(1)
JS
}

# make_repo "<local versions>" — fresh temp repo with those migration files, clean and in sync.
make_repo() {
  local base="$WORK/$1"
  REPO="$base/repo"
  LOG="$base/cli.log"
  mkdir -p "$REPO/scripts" "$REPO/supabase/migrations"
  cp "$SRC/scripts/release-production.sh" "$SRC/scripts/supabase-guarded.mjs" "$REPO/scripts/"
  for v in $2; do echo "-- $v" > "$REPO/supabase/migrations/${v}_m.sql"; done
  write_fake_cli "$REPO"
  printf 'NEXT_PUBLIC_SUPABASE_URL=https://%s.supabase.co\nSUPABASE_DB_PASSWORD=fake-prod\n' "$PRODUCTION_REF" > "$REPO/.env.local"
  printf 'NEXT_PUBLIC_SUPABASE_URL=https://%s.supabase.co\nSUPABASE_DB_PASSWORD=fake-staging\n' "$STAGING_REF" > "$REPO/.env.staging.local"
  printf 'node_modules/\n.env*.local\nsupabase/.temp/\n' > "$REPO/.gitignore"
  git init -q --bare -b master "$base/origin.git"
  (
    cd "$REPO"
    git init -q -b master
    git config core.autocrlf false
    git -c user.email=t@t -c user.name=t add -A
    git -c user.email=t@t -c user.name=t commit -qm init
    git remote add origin "$base/origin.git"
    git push -q origin master
  )
  # Belt and braces: origin must be the local bare repo, never GitHub.
  local url
  url="$(git -C "$REPO" remote get-url origin)"
  case "$url" in *://*|*@*|*github*) echo "origin이 가짜가 아니다: $url"; exit 1 ;; */origin.git) ;; *) echo "origin이 가짜가 아니다: $url"; exit 1 ;; esac
}

# run_release <answer> <env…> -- <args…> — sets OUT and CODE.
run_release() {
  local answer="$1"; shift
  local envs=()
  while [ "$1" != "--" ]; do envs+=("$1"); shift; done
  shift
  set +e
  OUT="$(cd "$REPO" && printf '%s\n' "$answer" | env FAKE_LOG="$LOG" APP_URL=http://127.0.0.1:9 ${envs[@]+"${envs[@]}"} bash scripts/release-production.sh "$@" 2>&1)"
  CODE=$?
  set -e
}
expect_code() { [ "$CODE" = "$1" ] || fail "종료 코드 $CODE (기대 $1)"; }
expect_staging() { [ "$(tr -d '\r\n ' < "$REPO/supabase/.temp/project-ref")" = "$STAGING_REF" ] || fail "link가 staging으로 돌아오지 않았다"; }
expect_no_write() { expect_no_log '^db push --linked --yes'; expect_no_out 'Applying migrations'; }

IN_ORDER_REMOTE="0047 0048 0049"
OOO_REMOTE="0047 0048 0049 0054"

# --------------------------------------------------------------------------------------------
CASE="1a 플래그 없음 · 순서대로 · RELEASE_DRY_RUN"
make_repo c1a "0047 0048 0049 0054"
run_release no FAKE_REMOTE="$IN_ORDER_REMOTE" RELEASE_DRY_RUN=1 -- 0054
expect_code 0
expect_out "RELEASE_DRY_RUN=1 — 여기서 멈춘다"
expect_out "dry-run도 같은 목록이다."
expect_no_out "순서 뒤바뀜"
expect_log '^db push --linked --dry-run$'
expect_no_log 'include-all'
expect_no_write; expect_staging
done_case

CASE="1b 플래그 없음 · 순서대로 · YES에 no"
make_repo c1b "0047 0048 0049 0054 0055"
run_release no FAKE_REMOTE="$IN_ORDER_REMOTE" -- 0054 0055
expect_code 1
expect_out "0054 0055 를 적용한다. 계속하려면 YES 입력:"
expect_out "YES가 아니다. DB는 그대로다."
expect_no_out "순서 뒤바뀜"; expect_no_log 'include-all'
expect_no_write; expect_staging
done_case

CASE="1c 플래그 없음 · 순서대로 · JSON 출력 · YES에 no"
make_repo c1c "0047 0048 0049 0054"
run_release no FAKE_REMOTE="$IN_ORDER_REMOTE" FAKE_FORMAT=json -- 0054
expect_code 1
expect_out "YES가 아니다. DB는 그대로다."
expect_no_write; expect_staging
done_case

# --------------------------------------------------------------------------------------------
for fmt in table json; do
  CASE="2 플래그 없음 · 순서 뒤바뀜 → 중단 ($fmt)"
  make_repo "c2-$fmt" "0047 0048 0049 0050 0051 0052 0054"
  run_release no FAKE_REMOTE="$OOO_REMOTE" FAKE_FORMAT="$fmt" -- 0050 0051 0052
  expect_code 1
  expect_out "순서 뒤바뀜: 0050·0051·0052는 이미 적용된 0054보다 번호가 낮다 — --include-all로만 적용된다."
  expect_out "bash scripts/release-production.sh --include-all 0050 0051 0052"
  expect_no_out "YES 입력"
  expect_no_log '^db push'
  expect_no_write; expect_staging
  done_case
done

# --------------------------------------------------------------------------------------------
for fmt in table json; do
  CASE="3 --include-all · 정확히 일치 → YES 질문까지, no로 중단 ($fmt)"
  make_repo "c3-$fmt" "0047 0048 0049 0050 0051 0052 0054"
  run_release no FAKE_REMOTE="$OOO_REMOTE" FAKE_FORMAT="$fmt" -- --include-all 0050 0051 0052
  expect_code 1
  expect_out "순서 뒤바뀜: 0050·0051·0052는 이미 적용된 0054보다 번호가 낮다"
  expect_out "dry-run도 같은 목록이다."
  expect_out "0050 0051 0052 를 적용한다 (--include-all). 계속하려면 YES 입력:"
  expect_out "YES가 아니다. DB는 그대로다."
  expect_log '^db push --linked --dry-run --include-all$'
  expect_no_write; expect_staging
  done_case
done

CASE="3b --include-all · 번호를 뒤에 · RELEASE_DRY_RUN"
make_repo c3b "0047 0048 0049 0050 0051 0052 0053 0054"
run_release no FAKE_REMOTE="$OOO_REMOTE" RELEASE_DRY_RUN=1 -- 0050 0051 0052 0053 --include-all
expect_code 0
expect_out "순서 뒤바뀜: 0050·0051·0052·0053는"
expect_out "RELEASE_DRY_RUN=1 — 여기서 멈춘다"
expect_log '^db push --linked --dry-run --include-all$'
expect_no_write; expect_staging
done_case

CASE="3c --include-all · DB YES → 가짜 push에도 --include-all · 앱 YES에 no"
make_repo c3c "0047 0048 0049 0050 0051 0052 0054"
run_release "$(printf 'YES\nno')" FAKE_REMOTE="$OOO_REMOTE" -- --include-all 0050 0051 0052
expect_code 1
expect_log '^db push --linked --yes --include-all$'
expect_out "staging으로 돌아왔다."
expect_out "앱 배포하려면 YES 입력:"
expect_out "YES가 아니다. DB는 적용됐고 앱은 그대로다"
expect_staging
[ "$(git -C "$REPO" rev-parse origin/master)" = "$(git -C "$REPO" rev-parse HEAD)" ] || fail "가짜 origin이 움직였다"
done_case

# --------------------------------------------------------------------------------------------
CASE="4a --include-all · 하나 모자람 → 중단"
make_repo c4a "0047 0048 0049 0050 0051 0052 0054"
run_release no FAKE_REMOTE="$OOO_REMOTE" -- --include-all 0050 0051
expect_code 1
expect_out "대기 목록이 기대와 다르다. 아무것도 쓰지 않았다."
expect_no_out "YES 입력"
expect_no_write; expect_staging
done_case

CASE="4b --include-all · 하나 남음 → 중단"
make_repo c4b "0047 0048 0049 0050 0051 0052 0054"
run_release no FAKE_REMOTE="$OOO_REMOTE" -- --include-all 0050 0051 0052 0053
expect_code 1
expect_out "대기 목록이 기대와 다르다. 아무것도 쓰지 않았다."
expect_no_out "YES 입력"
expect_no_write; expect_staging
done_case

CASE="4c --include-all · 순서 뒤바뀜과 새 번호가 섞임, 새 번호 빠뜨림 → 중단"
make_repo c4c "0047 0048 0049 0050 0054 0055"
run_release no FAKE_REMOTE="$OOO_REMOTE" -- --include-all 0050
expect_code 1
expect_out "대기 목록이 기대와 다르다."
expect_no_write; expect_staging
done_case

CASE="5 잘못된 옵션 → 시작 전 중단"
make_repo c5 "0047 0048 0049 0054"
run_release no FAKE_REMOTE="$IN_ORDER_REMOTE" -- --include 0054
expect_code 1
expect_out "옵션은 --include-all 하나뿐"
[ ! -s "$LOG" ] || fail "CLI가 불렸다"
done_case

echo
if [ "$FAILED" = 0 ]; then echo "check:release — 모두 통과"; else echo "check:release — 실패 $FAILED 건"; exit 1; fi
