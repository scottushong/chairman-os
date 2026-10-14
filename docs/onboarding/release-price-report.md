# 가격 리포트(DY 구매팀 · 0082) 반영 — 대표가 따라 하는 순서

**넣는 것:** 브랜치 `feat/purchase-price-report`(워크트리 `C:\Users\Edison Hong\projects\chairman-os-macro`) — master 5b3922a 위.
**마이그레이션 1개:** `0082_purchase_price_report`(표 넷 · 읽기 문 · 버튼 RPC · AI Agent RPC · 1월~10/14 가격 87점 · 메모 1 적재).
**화면:** `https://chairman-os-eosin.vercel.app/purchasing/biz_dy/price-report` (구매 메뉴 «가격 리포트») · 구매 개요 요약 카드 · 시장가 화면 «참고» 한 줄. 대표 홈에는 없다.

규칙: 상자 하나에 명령 하나. `&&`는 쓰지 않는다. 상자 아래 «기대»와 다르면 멈추고 결과를 보낸다.

---

## 0) 먼저 — Anthropic 크레딧 (브라우저)

2026-10-14 시험 중 Anthropic API가 «credit balance is too low»로 거절했다. **운영 AI(분류 · 어시스턴트 · 가격 리포트) 전부가 같은 키라면 지금 멈춰 있다.**
`https://console.anthropic.com/settings/billing` → 크레딧 충전(가격 리포트만 Sonnet 5.5로 월 약 $283 — 아래 «비용»). 자동 충전 켜기 권장.

## 1) 앞 반영 — 첫 사용 고침(마이그레이션 없음)이 먼저

`docs/onboarding/release-2026-10-14b.md`대로 `bash scripts/release-production.sh --app-only`를 **먼저** 끝낸다(master에 0082가 들어오면 --app-only가 멈춘다).

## 2) 합치기 (Git Bash)

```bash
cd ~/projects/chairman-os
```

```bash
git checkout master
```

```bash
git merge --no-ff feat/purchase-price-report -m "merge: DY 가격 리포트 (0082 · feat/purchase-price-report)"
```

기대: 충돌 없음. `git status`가 깨끗하다.

## 3) staging push

```bash
npm run db:push:staging
```

기대: dry-run 목록이 **정확히** `0082_purchase_price_report.sql` 하나 → 적용.

staging 시험(쓰지 않는다 — 끝에 되돌림):

```bash
node scripts/build-staging-dryrun.mjs 0082 0082 --tests-only
```

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/dryrun_0082_0082_tests.sql"
```

기대: `ERROR … 0082-0082 DRYRUN PASS (… tests 1/1 · 0082)`. (Claude Code가 2026-10-14에 0082 + 시험을 한 트랜잭션으로 staging에서 돌려 PASS · 되돌림을 확인했다.)

## 4) GitHub Secrets · Variables (브라우저)

`https://github.com/scottushong/chairman-os/settings/secrets/actions` → «New repository secret» 다섯(값은 Vercel → chairman-os → Settings → Environment Variables의 같은 값):

| Secret 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | Vercel의 `ANTHROPIC_API_KEY` |
| `SUPABASE_URL` | Vercel의 `NEXT_PUBLIC_SUPABASE_URL`(production) |
| `SUPABASE_ANON_KEY` | Vercel의 `NEXT_PUBLIC_SUPABASE_ANON_KEY`(production) |
| `AI_AGENT_EMAIL` | Vercel의 `AI_AGENT_EMAIL`(야간 브리핑 로그인) |
| `AI_AGENT_PASSWORD` | Vercel의 `AI_AGENT_PASSWORD` |

선택 — 같은 화면 «Variables» 탭: `BRIEFING_MODEL`(비우면 claude-sonnet-5-5 · Opus는 `claude-opus-5-5`) · `BRIEFING_SOURCES_OFF`(`te`면 TradingEconomics를 열지 않음) · `BRIEFING_MAX_SEARCHES` · `BRIEFING_FETCH_MAX_TOKENS`(비용 줄이기 — 효과 미측정).

## 5) production 반영 (Git Bash — DB 먼저 → 앱)

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0082
```

기대: 대기 목록 = `0082` 하나 → «여기서 멈춘다».

```bash
bash scripts/release-production.sh 0082
```

기대: YES 두 번(DB · 앱) → 배포 success → health. 이 push로 `.github/workflows/macro-briefing.yml`이 master에 들어가 08 · 18시 자동이 켜진다.

## 6) «지금 업데이트» 토큰 (브라우저)

1. `https://github.com/settings/personal-access-tokens/new` → Token name `chairman-os price report dispatch` · Expiration **1년** · Resource owner `scottushong` · Repository access **Only select repositories → chairman-os** · Permissions → Repository permissions → **Actions: Read and write**(나머지는 없음 · Metadata 읽기는 자동) → Generate → 값 복사.
2. `https://vercel.com` → chairman-os → Settings → Environment Variables → Production에 둘:
   - `GITHUB_DISPATCH_TOKEN` = 위 값
   - `PRICE_REPORT_MANUAL_PER_DAY` = `6`(회사 하루 수동 횟수 — DB 천장 12)
3. Deployments → 최신 Production → «Redeploy»(env는 다시 배포해야 붙는다).

토큰이 없으면 화면 버튼 자리에 «설정 전 — 자동 업데이트만 됩니다»가 보인다(자동 08 · 18시는 그대로 돈다).

## 7) 첫 실행 확인

`https://github.com/scottushong/chairman-os/actions/workflows/macro-briefing.yml` → «Run workflow»(입력 비움) → 3~5분 뒤 초록 → `https://chairman-os-eosin.vercel.app/purchasing/biz_dy/price-report` 맨 위 «마지막 업데이트»가 방금 시각.
빨강이면 Actions 로그의 마지막 줄을 보낸다(로그인 실패 = Secrets 이름 · 값, `price_report_*` = DB 반영 전).

## 8) 구매 권한 줄 주기 (브라우저 — 대표)

`https://chairman-os-eosin.vercel.app/settings/users` → 사람 → 모듈 권한 «구매 /purchasing/biz_dy» — **쓰기**면 «지금 업데이트»까지, 읽기만이면 보기만. 대표 · DY 임원 이상은 줄 없이도 본다.
지금 몇 명인지(Supabase → production → SQL Editor, 읽기만):

```sql
select m.can_write, count(*) from user_module_access m join user_profiles p on p.user_id = m.user_id where m.module = '/purchasing/biz_dy' and p.revoked_at is null group by 1;
```

(staging은 2026-10-14 기준 0명.)

---

## 구매팀 안내 (4줄 — 그대로 보내면 된다)

1. 가격 리포트는 **구매 → 가격 리포트**(`/purchasing/biz_dy/price-report`)에서 봅니다. 지난 리포트는 위 «지난 리포트»에서 날짜 · 회차를 고릅니다.
2. 매일 **08시 · 18시**에 자동으로 새로 만듭니다(몇 분 늦을 수 있습니다).
3. 급하면 맨 위 **«지금 업데이트»**(구매 입력 권한) — 3~5분 걸리고, 수집 중에는 잠기며, 마지막 실행 뒤 10분 안에는 다시 못 누르고, 회사 전체 하루 6번까지입니다.
4. **«미확인»**은 그 회차에 가격을 새로 확인하지 못했다는 뜻입니다 — 보이는 숫자는 직전에 확인된 값이니 출처(오피넷 · TradingEconomics)를 직접 확인하세요.

## 비용 (2026-10-14 진짜 1회 측정)

| 모델 | 회당 | 월(자동 2 + 버튼 평균 2 = 하루 4 · 120회) |
|---|---|---|
| Sonnet 5.5(기본) | 약 $2.36 | 약 $283 |
| Opus 5.5 | 약 $4.60 | 약 $552 |

회당 입력 약 105만 토큰(웹 페이지 · 검색 결과 12건 · 페이지 6장)이 대부분이다. 줄이는 손잡이는 4)의 Variables(효과는 아직 재지 못함 — 크레딧 부족).

## 되돌리는 길

앱: Vercel 직전 Production «Promote». 화면만 숨기기: `/settings/features` «가격 리포트(구매)» 끄기. 자동 수집 멈추기: Actions → «Macro briefing» → «Disable workflow». DB 0082 표는 남겨 둬도 다른 화면에 영향 없다(원가 엔진 표에 쓰지 않는다).
