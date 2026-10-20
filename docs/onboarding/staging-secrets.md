# staging 비밀값 분리 (2026-10-20 조사 · 값은 만들지 않음)

staging(Supabase `itpenmxyracfhyormcep` · Seoul)이 운영(`nndvspgnljivkvihxlzj` · Tokyo)과 **같은 키**를 쓰는 곳을 찾고, 어떤 키를 어디서 새로 만들어 어디에 넣는지 적는다.
값은 대표가 만든다 — 이 문서와 저장소 어디에도 값이 없다.

## 1. 지금 상태 (값은 보지 않고 «같은가»만 비교)

비교: 본 저장소 `chairman-os\.env.staging.local`(staging) ↔ `chairman-os\.env.local`(운영 Supabase를 가리킴). 2026-10-20 키 이름별 같음/다름만 출력.

| 키 | staging = 운영? | 위험 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_DB_PASSWORD` | 다름 | 없음 |
| `ANTHROPIC_API_KEY` | **같음** | staging 시험이 운영과 같은 크레딧 · 한도를 쓴다. 키가 새면 둘 다 바꿔야 한다 |
| `CRON_SECRET` | **같음** | staging 쪽 값이 새면 운영 cron 주소를 부를 수 있다(OPERATIONS 1절은 «다른 값») |
| `AI_AGENT_EMAIL` · `AI_AGENT_PASSWORD` | **같음** | DB가 달라 계정은 둘이지만 비밀번호가 같다 — 한쪽이 새면 다른 쪽도 |
| `INTEGRATION_EMAIL` · `INTEGRATION_PASSWORD` | **같음** | 위와 같다 |
| `KAKAO_REST_API_KEY` | **같음** | OPERATIONS 1절: Preview · staging에는 넣지 않는다 |
| `AI_MODEL` | 같음 | 비밀 아님 |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | staging에 없음 | 없음 |
| `GOOGLE_SHEETS_SA_JSON` | 두 파일 다 없음 | 운영은 Vercel에만(있다면). staging용은 따로 |

확인하지 못한 곳(이 컴퓨터에서 볼 수 없음 — 대표가 화면에서 확인):
- **Vercel Preview 환경변수** — OPERATIONS 1절 표대로 Preview만 체크했는지, Production 값이 Preview에도 체크돼 있는지(같은 키 공유가 여기서 생긴다).
- **GitHub Actions secrets** — `chairman-tick.yml` · `fin-recalc.yml`(`APP_URL` · `CRON_SECRET`), `macro-briefing.yml`(`ANTHROPIC_API_KEY` · `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `AI_AGENT_*`)은 저장소 전체 secret 하나씩 — 지금은 운영만 가리킨다. staging용 GitHub Environment는 없다.
- **Supabase Vault** — staging의 `cost_bom_key`는 staging에서 따로 만든 것(bom-key-setup.md). `google_sheets_sa`(0089)는 아직 어디에도 없다.

## 2. 새로 만들 것 · 넣을 곳 (순서대로)

| # | 무엇 | 어디서 만드나 | 어디에 넣나 |
|---|---|---|---|
| 1 | staging `CRON_SECRET` | 아무 긴 무작위 값(비밀번호 관리자 «생성» 32자 이상) | `.env.staging.local` · Vercel **Preview** env |
| 2 | staging Anthropic 키 | https://console.anthropic.com → **Workspaces → Create workspace**(`chairman-os-staging`) → 그 워크스페이스에서 **API Keys → Create Key**. 워크스페이스 **Limits**에 월 한도(예: $10) | `.env.staging.local`의 `ANTHROPIC_API_KEY` · Vercel **Preview** env · (staging용 Actions를 만들면) GitHub Environment `staging` secret |
| 3 | staging AI Agent · Integration 비밀번호 | staging Supabase 대시보드 https://supabase.com/dashboard/project/itpenmxyracfhyormcep → **Authentication → Users** → 그 두 계정 → **Reset password**(새 값) | `.env.staging.local`의 `AI_AGENT_PASSWORD` · `INTEGRATION_PASSWORD` · Vercel **Preview** env |
| 4 | staging 구글 서비스 계정 | https://console.cloud.google.com/projectcreate → 프로젝트 `chairman-os-sheets-staging` → `process-chart-google-setup.md` 2~4단계 그대로(시험 시트에만 «뷰어» 공유) | staging 앱의 `/settings` «받을 것 › 구글 서비스 계정»에 JSON 올리기(→ staging Vault), 또는 동기화가 아직 env를 읽으므로 Vercel **Preview** env `GOOGLE_SHEETS_SA_JSON` |
| 5 | 카카오 | 만들지 않는다 | staging · Preview에서 **빼기**(`.env.staging.local`의 `KAKAO_REST_API_KEY` 줄 지움) |
| 6 | GitHub Environment `staging`(선택) | https://github.com/<저장소>/settings/environments → **New environment** `staging` | 1~3의 staging 값 + `APP_URL`(Preview 주소) · `SUPABASE_URL` · `SUPABASE_ANON_KEY`(staging). 워크플로가 `environment: staging`을 쓰게 바꾸는 것은 따로(지금 워크플로는 운영 secret만 씀) |

넣은 뒤:
- Vercel **Settings → Environment Variables**에서 각 값의 Environment가 **Preview만**인지 다시 본다(Production 체크 금지 — OPERATIONS 1절). 바꾼 뒤 Preview **Redeploy**.
- 운영 쪽 `ANTHROPIC_API_KEY` · `CRON_SECRET`은 그대로(바꾸면 운영 cron · GitHub secret도 같이 바꿔야 한다). staging이 운영 키를 썼던 기간이 있으니, 운영 키를 한 번 바꾸는 것은 대표 판단(선택).
- 확인: `.env.staging.local`과 `.env.local`을 같은 방법(키 이름별 «같은가»만)으로 다시 비교 — `ANTHROPIC_API_KEY` · `CRON_SECRET` · `AI_AGENT_PASSWORD` · `INTEGRATION_PASSWORD`가 «다른 값», `KAKAO_REST_API_KEY`가 «staging에 없음»이면 끝.

## 3. 하지 말 것

- 값을 메일 · 메신저 · 저장소 · 이 문서에 적지 않는다.
- staging 키를 운영 Vercel(Production)에 넣지 않는다. `SUPABASE_DB_PASSWORD`는 Vercel에 넣지 않는다.
- 구글 키 JSON은 올린 뒤 내려받은 파일을 지운다(휴지통 비우기까지).
