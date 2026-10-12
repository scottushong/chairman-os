# 2026-10-12 프로세스 차트 메뉴 + 구글 시트 → 캘린더 · 업무 관리 동기화

브랜치 `feat/process-charts-sync` = `release/process-charts`. 워크트리는 `C:\Users\Edison Hong\projects\chairman-os-pchart`이고, master d47ebf7에서 갈라졌다. push는 하지 않았다. 마이그레이션 번호는 **0071**이다.

## 0. 조사 (5줄)

1. process-charts는 표 `process_charts`(0021, 영업 시드는 0036)에 링크만 있었다. 읽기는 임원 이상 + 자기 회사였고(팀장 이하는 0행), 쓰기는 대표 · CFO였다. 화면은 `/settings/process-charts`와 `/process/[id]`였다.
2. 캘린더는 0017 `calendar_items` 뷰(security_invoker)로 그린다. events · 이니셔티브 다음 행동 · 마일스톤 · 결정을 합친 뷰이고, tasks 날짜는 쓰지 않는다.
3. tasks 칸은 task_id · project_id(필수) · title · owner_user_id · priority · status · blocked_since · deadline · chairman_needed다. 외부 출처 칸과 insert 정책이 없었고, 댓글 기능도 없다.
4. 사이드 메뉴는 `src/lib/nav.ts`에 있다.
5. 다음 빈 번호는 0071이다(0069 AI 어시스턴트 · 0070 재무 v2). vercel.json의 cron은 0개였다(저장소 기록: Hobby는 하루 1개).

## 결과 표

| 항목 | 결과 |
|---|---|
| 메뉴 · 화면 | 사이드 메뉴 «프로세스 차트» → `https://chairman-os-eosin.vercel.app/process-charts`. 탭은 영업 · 경영지원 · 연구소다. 위에는 시트 그림(지금 끼워 넣기 그대로), 아래에는 앱이 읽은 줄 · 마지막 동기화 · «지금 동기화» · 동기화 기록이 있다. |
| 보기 권한 | 0071에서 정책을 바꿨다. 임원 이상은 자기 회사 탭 셋을 모두 보고, 팀장 · 팀원은 자기 팀 탭만 본다. |
| 시트 주소 저장 | 대표 · CFO만 한다(화면 아래 «시트 연결 관리»). 편집 주소를 넣으면 시트 ID만 저장한다. |
| 예전 주소 | `/settings/process-charts` → `/process-charts`로 넘긴다. |
| 시트 읽기 | Google Sheets API + 서비스 계정(spreadsheets.readonly). JWT 서명은 node:crypto로 하고 새 의존성은 없다. env `GOOGLE_SHEETS_SA_JSON`이 없으면 «연결 전»이고 버튼이 꺼진다. |
| 줄 검사 | 제목 줄은 이름으로 찾는다(순서 무관). ID 없음 · 날짜 틀림은 건너뛰고 경고한다. 상태가 «예정 · 진행 · 완료 · 보류» 밖이면 «예정»으로 넣고 경고한다. 시트가 비면 거부한다(기존 업무를 «사라짐»으로 만들지 않는다). |
| 동기화 표 | `process_chart_items`((회사, 팀, 시트 ID) 유일, 사라진 줄은 gone_at으로 표시만 하고 지우지 않음) · `process_chart_syncs`(언제 · 누가/자동 · 팀 · 읽은 · 새 · 바뀜 · 사라짐 · 건너뜀 · 경고). |
| 업무 관리 | 출처는 «프로세스 차트 · <팀>»이다. 담당자 이메일로 찾지 못하면 «담당 미정» + 경고다. 앱에서는 고칠 수 없고(DB restrictive + 화면 «시트에서 고치세요»), 시트 업무는 담당자 본인 · 그 탭을 보는 사람만 읽는다. |
| 캘린더 | 새 표 없이 `calendar_items`에 'process' 갈래를 더했다(■ 표시). |
| 동기화 시점 | ① 버튼(같은 팀 1분에 1번 — DB가 막음) ② 화면을 열 때 10분이 지났으면 ③ 새벽 cron(`/api/cron/process-sync`, 03:00 KST, CRON_SECRET 헤더 — 값은 기존 것). |
| 쓰기 경로 | security definer RPC이고 **AI Agent 세션만** 부른다(야간 브리핑과 같은 로그인, service_role 없음). 누른 사람은 `p_requested_by`로 받고, DB가 그 사람이 그 탭을 보는지 다시 확인한다. |
| AI 경로 | 시트 업무 · 캘린더 'process'를 AI 도구(일정 · 내 업무 · 검증) · 야간 브리핑에서 뺐다. |
| 대표 문서 | `C:\Users\Edison Hong\projects\chairman-os-pchart\docs\onboarding\process-chart-google-setup.md`(콘솔 주소 한 상자에 하나 · 결제 설정 없음 확인) |

## 검사

- typecheck · lint(전체) PASS · build --webpack PASS.
- `check:process-sync` PASS: 새 · 바뀜 · 사라짐 · 다시 나타남 · ID 없음 · 날짜 틀림 · 상태 · 담당 미정 · 두 번 넣어도 안 늘어남 · 1분 · 팀 보기 · 연결 전 · JWT · 빈 시트.
- `check:migrations` · `check:db-safety` · `check:process-charts` · `check:ask` · `check:boundaries` PASS.
- staging 시험 SQL 0071(PGlite) PASS: a~k.
- DB/RLS 리뷰 1회: Critical 0. Important 3건은 고쳤다:
  - A: 프로젝트 id를 다른 회사가 먼저 잡으면 거부한다.
  - B: 담당 미정 시트 업무가 회사 전체에 보이던 것을 막았다(restrictive select).
  - C: 사람 판정 함수의 authenticated grant를 회수했다.
  - Minor 둘(빈 시트 거부 · 정의자 허용 목록 단언)도 고쳤다.
- **FORCE RLS를 내렸다(tasks · process_charts).** 리뷰는 안전하다고 판정했다(열리는 것은 표 소유자의 RLS 우회뿐이고, 그 표를 만지는 정의자는 0071 함수뿐 — check:migrations 단언으로 고정). process_charts는 정책이 자기 표를 다시 읽어 FORCE가 있으면 실제 PG에서 0행이 된다.

스크린샷은 `C:\Users\Edison Hong\projects\chairman-os-pchart\.screenshots\process-charts\`에 있다(진짜 구글 호출 없음, 가짜 시트 응답).
- `staff-1-pc.png`: 팀원(영업 직원) — 탭 하나(영업), 읽은 줄 · 마지막 동기화.
- `staff-3-pc-tasks.png`: /tasks(출처 표시).
- `staff-9-phone.png`
- `exec-1-pc.png` · `exec-2-pc-rnd-before-connect.png`: 임원 — 탭 셋, 연구소 «연결 전» · 버튼 꺼짐.
- `chair-2-pc-sync-log.png`: 대표 — 같은 팀 1분 제한 문구. 동기화 기록 표는 화면 아래(안쪽 스크롤)라 이 그림에는 위쪽만 나왔다.
- 직원 화면 «회장» 0은 스크립트가 확인했다.

## 하지 못한 것

1. **«댓글만»**: 업무에 댓글 기능 자체가 없어서 만들지 않았다. 시트 업무는 수정 손잡이를 끄고 «시트에서 고치세요»만 보인다.
2. 탭 이름(팀 이름)을 바꾸면 옛 줄 · 업무가 그대로 남고 새 프로젝트로 다시 생긴다(DEFERRED). cron은 1분 제한에 걸리면 그날을 거른다(재시도 없음).
3. 진짜 구글 호출 · staging 쓰기는 하지 않았다.
4. Vercel cron 한도(Hobby 하루 1개)는 저장소 기록 기준이다 — 지금 요금제를 Vercel 화면에서 확인해야 한다.

## 회장이 할 일

| 순서 | 담당 | 상태 | 방법 |
|---|---|---|---|
| 1 | 회장 | 대기 | staging에 0071 반영 + 시험 SQL(명령 1~4). staging에 AI Agent 프로필이 있어야 한다(없으면 «FAIL 준비 … AI Agent(null)»). |
| 2 | 회장 | 대기 | `C:\Users\Edison Hong\projects\chairman-os-pchart\docs\onboarding\process-chart-google-setup.md` 1~6단계(서비스 계정 · 시트 공유 · Vercel env `GOOGLE_SHEETS_SA_JSON`) |
| 3 | 회장 | 대기 | Vercel → Project → Settings → Cron Jobs에서 cron 1개가 요금제 안인지 확인 |
| 4 | 회장 | 대기 | master에 합치기 → 운영 반영(명령 5~7). 반드시 DB 먼저(release-production.sh가 순서를 지킨다) |
| 5 | 회장 | 대기 | https://chairman-os-eosin.vercel.app/process-charts → «시트 연결 관리»에 탭별 편집 주소 → «지금 동기화» |

```
cd ~/projects/chairman-os-pchart
```
```
npm run db:push:staging
```
```
cp docs/onboarding/staging-tests/0071_staging_test.sql supabase/.temp/
```
```
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0071_staging_test.sql"
```
```
cd ~/projects/chairman-os
```
```
git merge --no-ff release/process-charts -m "merge: 프로세스 차트 메뉴 · 시트 → 업무 · 캘린더 동기화 0071"
```
```
bash scripts/release-production.sh 0071
```
