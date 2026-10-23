#!/usr/bin/env bash
# 0093 — /api/health 응답 시간 N번(GET만 · 쓰지 않음). Vercel 함수 지역(icn1 · hnd1) 비교용.
#   bash scripts/measure-health.sh [주소] [횟수]
#   기본: https://chairman-os-eosin.vercel.app 10번
# 줄마다: 번호 · 전체(초) · 첫 바이트(초) · 서버 안 DB 시간(elapsed_ms — 표 24개 count를 한꺼번에) · 지역(X-Vercel-Id 앞머리).
# 첫 줄은 콜드 스타트가 섞이니 중앙값은 2~N번으로 본다.
set -euo pipefail
base="${1:-https://chairman-os-eosin.vercel.app}"
n="${2:-10}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '%-4s %-8s %-8s %-10s %s\n' '#' 'total' 'ttfb' 'server_ms' 'region'
for i in $(seq 1 "$n"); do
  t="$(curl -s -o "$tmp/b" -D "$tmp/h" -w '%{time_total} %{time_starttransfer}' "$base/api/health")"
  ms="$(grep -o '"elapsed_ms":[0-9]*' "$tmp/b" | cut -d: -f2 || true)"
  region="$(grep -i '^x-vercel-id' "$tmp/h" | tr -d '\r' | awk '{print $2}' | cut -d: -f1-3 || true)"
  printf '%-4s %-8s %-8s %-10s %s\n' "$i" ${t} "${ms:-?}" "${region:-?}"
done
