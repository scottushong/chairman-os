# 가격 리포트(DY 구매팀 · 0084) 반영 — 대표가 따라 하는 순서

**넣는 것:** 브랜치 `feat/purchase-price-report`(워크트리 `C:\Users\Edison Hong\projects\chairman-os-macro`) — 2026-10-19 로컬 master 969c6a2(0082 수신함 · 0083 공식 결산 v2) 위로 옮기고 번호를 **0082 → 0084**로 바꿨다.
**2026-10-20 보강(release/2026-10-20):** 자동 일정 뺌 · 1회 비용 low 프리셋(추정 보통 $0.26 · 최악 $0.94) — 아래 «비용» · «비용 확인 → 자동 되살리기».
**마이그레이션 1개:** `0084_purchase_price_report`(표 넷 · 읽기 문 · 버튼 RPC · AI Agent RPC · 1월~10/14 가격 87점 · 메모 1 적재).
**화면:** `https://chairman-os-eosin.vercel.app/purchasing/biz_dy/price-report` (구매 메뉴 «가격 리포트») · 구매 개요 요약 카드 · 시장가 화면 «참고» 한 줄. 대표 홈에는 없다.

규칙: 상자 하나에 명령 하나. `&&`는 쓰지 않는다. 상자 아래 «기대»와 다르면 멈추고 결과를 보낸다.

---

## 0) 먼저 — Anthropic 크레딧 (브라우저)

2026-10-14 시험 중 Anthropic API가 «credit balance is too low»로 거절했다. **운영 AI(분류 · 어시스턴트 · 가격 리포트) 전부가 같은 키라면 지금 멈춰 있다.**
`https://console.anthropic.com/settings/billing` → 크레딧 충전. 가격 리포트는 2026-10-20부터 **자동 일정이 꺼져 있고**(손으로만) 1회 low 프리셋 추정 보통 약 $0.26 · 최악 $0.94 — 아래 «비용 확인 → 자동 되살리기». 자동 충전 켜기 권장.

## 1) 앞 반영 — 0082 수신함 · 0083 공식 결산이 먼저

`docs/onboarding/release-2026-10-16.md`(0082) → `docs/onboarding/release-2026-10-17a.md`(0083)를 **먼저** 끝낸다. production이 0083이어야 아래 dry-run 대기 목록이 `0084` 하나다(첫 사용 고침은 0082 반영에 이미 들어 있다).

## 2) 합치기 (Git Bash)

```bash
cd ~/projects/chairman-os
```

```bash
git checkout master
```

```bash
git merge --no-ff feat/purchase-price-report -m "merge: DY 가격 리포트 (0084 · feat/purchase-price-report)"
```

기대: 충돌 없음. `git status`가 깨끗하다.

## 3) staging push

```bash
npm run db:push:staging
```

기대: dry-run 목록이 **정확히** `0084_purchase_price_report.sql` 하나 → 적용.

staging 시험(쓰지 않는다 — 끝에 되돌림):

```bash
node scripts/build-staging-dryrun.mjs 0084 0084 --tests-only
```

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/dryrun_0084_0084_tests.sql"
```

기대: `ERROR … 0084-0084 DRYRUN PASS (… tests 1/1 · 0084)`. (Claude Code가 2026-10-14에 같은 본문(그때 이름 0082) + 시험을 한 트랜잭션으로 staging에서 돌려 PASS · 되돌림을 확인했다. 10-19 번호를 바꾼 뒤 다시 돌린 결과는 이 문서 끝 «10-19 다시 확인».)

## 4) GitHub Secrets · Variables (브라우저)

`https://github.com/scottushong/chairman-os/settings/secrets/actions` → «New repository secret» 다섯(값은 Vercel → chairman-os → Settings → Environment Variables의 같은 값):

| Secret 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | Vercel의 `ANTHROPIC_API_KEY` |
| `SUPABASE_URL` | Vercel의 `NEXT_PUBLIC_SUPABASE_URL`(production) |
| `SUPABASE_ANON_KEY` | Vercel의 `NEXT_PUBLIC_SUPABASE_ANON_KEY`(production) |
| `AI_AGENT_EMAIL` | Vercel의 `AI_AGENT_EMAIL`(야간 브리핑 로그인) |
| `AI_AGENT_PASSWORD` | Vercel의 `AI_AGENT_PASSWORD` |

선택 — 같은 화면 «Variables» 탭(**비워 두는 것이 권장** — 비면 low 프리셋 값): `BRIEFING_PRESET`(low · normal — 화면 버튼 실행에 쓰임) · `BRIEFING_MODEL`(비우면 claude-sonnet-5-5) · `BRIEFING_SOURCES_OFF`(`te`면 TradingEconomics를 열지 않음) · `BRIEFING_MAX_SEARCHES` · `BRIEFING_MAX_FETCHES` · `BRIEFING_FETCH_MAX_TOKENS` · `BRIEFING_MAX_TOKENS`. 값을 넣으면 프리셋 위에 덮여 비용 추정이 바뀐다.

## 5) production 반영 (Git Bash — DB 먼저 → 앱)

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0084
```

기대: 대기 목록 = `0084` 하나 → «여기서 멈춘다».

```bash
bash scripts/release-production.sh 0084
```

기대: YES 두 번(DB · 앱) → 배포 success → health. 이 push로 `.github/workflows/macro-briefing.yml`이 master에 들어간다 — **자동 일정 없음**(2026-10-20 뺌). 돌리는 길은 화면 «지금 업데이트» · Actions «Run workflow»뿐.

## 6) «지금 업데이트» 토큰 (브라우저)

1. `https://github.com/settings/personal-access-tokens/new` → Token name `chairman-os price report dispatch` · Expiration **1년** · Resource owner `scottushong` · Repository access **Only select repositories → chairman-os** · Permissions → Repository permissions → **Actions: Read and write**(나머지는 없음 · Metadata 읽기는 자동) → Generate → 값 복사.
2. `https://vercel.com` → chairman-os → Settings → Environment Variables → Production에 둘:
   - `GITHUB_DISPATCH_TOKEN` = 위 값
   - `PRICE_REPORT_MANUAL_PER_DAY` = `6`(회사 하루 수동 횟수 — DB 천장 12)
3. Deployments → 최신 Production → «Redeploy»(env는 다시 배포해야 붙는다).

토큰이 없으면 화면 버튼 자리에 «설정 전 — 업데이트 버튼 준비 중»이 보인다(자동을 되살린 뒤에는 «설정 전 — 자동 업데이트만 됩니다»).

## 7) 첫 실행 확인 = 비용 확인 한 번

아래 «비용 확인 → 자동 되살리기» ①~④를 그대로 한다(첫 실행이 곧 low 1회 비용 측정).
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
2. 지금은 **자동으로 만들지 않습니다** — 새로 보려면 맨 위 **«지금 업데이트»**(구매 입력 권한)를 누릅니다. (자동 08시 · 18시를 켜면 이 줄을 «매일 08시 · 18시에 자동으로 새로 만듭니다»로 바꿔 보냅니다.)
3. «지금 업데이트»는 3~5분 걸리고, 수집 중에는 잠기며, 마지막 실행 뒤 10분 안에는 다시 못 누르고, 회사 전체 하루 6번까지입니다.
4. **«미확인»**은 그 회차에 가격을 새로 확인하지 못했다는 뜻입니다 — 보이는 숫자는 직전에 확인된 값이니 출처(오피넷 · TradingEconomics)를 직접 확인하세요.

## 비용 — 2026-10-20 줄임(0084 보강 · 결정 `docs/decisions/2026-10-20-price-report-cost.md`)

### 왜 $2.36이었나
10-14 진짜 1회: 입력 1,053,198 · 출력 13,409 · 검색 12 · 페이지 6(Sonnet 5.5 · 캐싱 없음) → $2.11 + $0.13 + $0.12 = **$2.36**.
서버 도구(web_fetch · web_search)는 한 요청 안에서 여러 차례 돌고, **차례마다 그때까지 대화 전체(읽은 페이지 · 검색 결과 포함)를 다시 입력으로 센다**. 천장 없는 페이지 6장 + 검색 12번이 한 대화에 쌓여 19차례쯤 다시 읽혀 105만 토큰이 됐다(도구 1번 결과 평균 약 6,000토큰으로 맞는다).

### 무엇을 줄였나 (low 프리셋 — 기본)
| 손잡이 | 전(10-14) | 후(low) |
|---|---|---|
| 일정 | 매일 08 · 18시 자동 | **꺼짐**(손으로만 — 아래 ③으로 되살림) |
| 부르는 방식 | 한 대화에 페이지 + 검색 + 글 | **두 단계 독립 호출**: ① 가격 페이지만 → ② ①의 숫자(JSON 몇 줄)만 받아 사건 검색 + 글. 페이지 본문이 ② 대화에 실리지 않는다 |
| 페이지 글 천장(max_content_tokens) | 없음 | **6,000토큰**/장 · 출처 수(5장, te 끄면 2장)만 |
| 검색(max_uses) | 15(실제 12) | **4** |
| 프롬프트 캐싱(cache_control) | 없음 | **켬** — 서버 도구 차례마다 다시 읽는 몫이 캐시 읽기($0.10/백만, 기본 입력의 5%) |
| 이어받기(pause_turn) | 8번까지 | 단계마다 **2요청**까지(합계 4요청) |
| 출력 천장(max_tokens) | 16,000 | ① 3,000 · ② 7,000 |
| 생각 깊이(effort) | 모델 기본(high) | ① low · ② medium |
| 직전 리포트(중복 확인용) | 4,000자 | **1,200자** |
| 모델 | claude-sonnet-5-5 | 그대로(Haiku로 내리는 것은 ④의 다음 손잡이 — 품질 · 동적 거르기 미확인) |

예전 방식은 `preset=normal`(검색 15 · 페이지 12 · 천장 없음, 캐싱만 추가)로 남겼다.

### 토큰으로 계산한 추정(진짜 호출 0 — `cd macro/engine` 뒤 `python -m briefing.estimate`)
가격(2026-10-20 platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5 입력 $2 · 캐시 쓰기 $2.50 · 캐시 읽기 $0.10 · 출력 $10(백만 토큰) · 검색 $0.01/번 · 페이지 읽기 추가 요금 없음.
글자 → 토큰은 로컬 근사(한글 1자 = 1토큰, 그 밖 3자 = 1토큰 — 실제보다 크게 잡는 쪽). 계산식: 차례 i마다 입력 = 프롬프트 + 앞 결과 합, 이어받기 요청마다 전체를 한 번 더, 출력 = 요청 수 × max_tokens.

| 단계 | 프롬프트(도구 안내 1,500 포함) | 도구 × 결과 상한 | 최악 입력 / 출력 | 최악 $ (캐시 안 먹음) | 최악 $ (캐시 먹음) | 보통 입력 / 출력 | 보통 $ |
|---|---|---|---|---|---|---|---|
| ① 가격 페이지 | 2,044 | 페이지 5 × 6,000 | 146,308 / 6,000 | $0.35 | $0.16 | 91,764 / 1,500 | $0.09 |
| ② 사건 + 글 | 4,419 | 검색 4 × 12,000 | 202,914 / 14,000 | $0.59(검색 $0.04 포함) | $0.33 | 85,095 / 4,500 | $0.17 |
| **합계(1회)** | | | 349,222 / 20,000 | **$0.94** | **$0.49** | 176,859 / 6,000 | **$0.26** |
| 비교: 10-14 실측 | | 페이지 6 + 검색 12(천장 없음) | 1,053,198 / 13,409 | **$2.36** | | | |

«보통»은 페이지 5,000 · 검색 6,000토큰(10-14 평균)/번, 캐시가 먹고, 이어받기 없음. 월(하루 4회 · 120회 — 자동 2 + 버튼 평균 2): 보통 약 **$31** · 최악 $113(예전 $283).
`check:price-report` ④가 가짜 Anthropic 클라이언트로 low의 요청 수(≤4) · 도구 천장 · 캐싱 · 요청 글 크기 · «최악 < $1»을 매번 검사한다(`macro/engine/tests/test_cost.py`).

## 비용 확인 → 자동 되살리기 (대표가 하는 순서)

**① low 한 번 돌리기(브라우저)** — 둘 중 하나.
- `https://github.com/scottushong/chairman-os/actions/workflows/macro-briefing.yml` → (처음이면 노란 띠의 **«Enable workflow»** — 지금 «disabled_manually» 상태) → **«Run workflow»** → Branch `master` · preset **`low`** · 나머지 비움 → «Run workflow». 3~5분 뒤 초록.
- 또는 `https://chairman-os-eosin.vercel.app/purchasing/biz_dy/price-report` → **«지금 업데이트»**(6)의 토큰이 있어야 보임 — 화면 버튼은 늘 low).
초록이 되면 그 실행 → «Run briefing → Supabase» 줄을 펴서 마지막의 `사용량: {… "usd": 0.xx}` 한 줄을 본다(엔진이 가격표로 계산한 값). `cache_read`가 0이 아니면 캐싱이 먹은 것.

**② 실제 비용 확인(브라우저)** — `https://platform.claude.com/usage`(Claude Console → Usage — 예전 주소 console.anthropic.com도 같은 곳) → 오늘 날짜 · 모델 claude-sonnet-5-5 → 그 시각의 비용(검색은 «web search» 줄). 한 번만 돌린 날이면 그날 합계가 그 회차다. ①의 `usd`와 몇 센트 안이면 맞다.

**③ $1 미만이면 — 자동 되살리기.** `.github/workflows/macro-briefing.yml`의 `on:` 바로 아래(`workflow_dispatch:` 위)에 이 세 줄을 넣고 커밋 · push(Claude Code에 «가격 리포트 자동 되살려»라고 해도 된다):

```yaml
  schedule:
    - cron: "0 23 * * *"   # 08:00 KST (UTC 전날 23:00)
    - cron: "0 9 * * *"    # 18:00 KST (UTC 09:00)
```

같이: 이름 `Macro briefing (manual)` → `Macro briefing (08:00 / 18:00 KST)`, Vercel env `PRICE_REPORT_AUTO` = `1`(화면에 «다음 자동 08 · 18시»가 다시 보임) → Redeploy, `scripts/check-price-report.ts` ⑤의 «schedule 없음» 검사를 «cron 두 줄 있음»으로 되돌린다. 자동 회차는 Variable `BRIEFING_PRESET`(비면 low)을 쓴다.

**④ $1을 넘으면 — 더 줄일 순서**(Actions → Settings → Variables, 한 번에 하나씩 바꾸고 ①②를 다시):
1. `BRIEFING_MAX_SEARCHES` = `2` (②의 검색 결과가 대부분이다 — 최악 약 −$0.26)
2. `BRIEFING_SOURCES_OFF` = `te` (TradingEconomics 3장 빼기 — 장중 · 나프타 CFD는 «미확인» · 최악 약 −$0.21)
3. `BRIEFING_FETCH_MAX_TOKENS` = `4000` — 단, 오피넷 값이 missing에 뜨면(표가 잘림) 되돌리고 반대로 `10000`
4. 모델을 Haiku 5.5(`claude-haiku-5-5`, $0.10/$0.50 — 요청이 10만 토큰을 넘으면 $0.50/$2.50)로 — **엔진 손질이 필요**: 동적 거르기 판(_20260209) 지원이 문서에서 확인되지 않아 도구를 `web_search_20250305` · `web_fetch_20250910`로 바꾸고 단위 검증(884) 결과를 몇 회 지켜본다. Claude Code에 시킬 일.
반대로 ①에서 오피넷 · 사건이 비어 «미확인»이 잦으면 `BRIEFING_FETCH_MAX_TOKENS`=`10000` 또는 `BRIEFING_MAX_SEARCHES`=`6`으로 올린다(추정은 `python -m briefing.estimate`가 다시 계산 — Variables 값은 그 실행 로그 맨 위 «비용 추정»에도 찍힌다).

## 되돌리는 길

앱: Vercel 직전 Production «Promote». 화면만 숨기기: `/settings/features` «가격 리포트(구매)» 끄기. 자동 수집 멈추기: Actions → «Macro briefing» → «Disable workflow»(지금은 자동 일정 자체가 없다 — 10-20). DB 0084 표는 남겨 둬도 다른 화면에 영향 없다(원가 엔진 표에 쓰지 않는다).

## 10-19 다시 확인 (번호 0082 → 0084)

- master 969c6a2(0082 수신함 · 0083 공식 결산 v2)를 이 브랜치에 합치고 이름만 바꿨다 — 본문 SQL은 그대로(설명 줄의 번호만).
- `check:price-report` 10묶음 · `check:migrations`(0001 → 0084, 81개) · `check:features` · `typecheck` PASS.
- staging 되돌리는 시험: `0084-0084 DRYRUN PASS (1 files · tests 1/1 · 0084)` — 남은 것 없음.
