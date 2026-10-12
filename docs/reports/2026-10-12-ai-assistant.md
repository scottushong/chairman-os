# 2026-10-12 AI 어시스턴트 보강 — 의도 파악 · 권한 조회 · 이어서 질문 · 보완 의견 · 시스템 보완함

브랜치 `feat/ai-assist` = `release/ai-assist` (워크트리 `C:\Users\Edison Hong\projects\chairman-os-assist`), master d47ebf7에서. push 없음.
마이그레이션 **0069_ai_feedback** (다음 빈 번호. «결산 잠정» 제안 번호는 0070 뒤로 — 설계서 정정은 미결 4).

## 1. 현황 표 (고치기 전)

| 항목 | 내용 |
|---|---|
| 도구(모든 역할) | calculate · list_businesses · list_approvals · list_calendar · org_lookup · validate_screen · attachment_summaries(web) · propose_attachment_summary · list_approval_templates · propose_approval_form · closing_status · search_documents · my_tasks |
| 재무 권한자 | + finance_query · finance_input_help |
| 대표 · 그룹 CFO | + list_initiatives · get_initiative · propose_initiative_update · propose_event |
| 대표만 | + dependency · attention · chairman_direction · propose_approval_draft · propose_checkin · propose_memo_tidy |
| «막히면 끝내는» 원인 | 규칙 9(다)는 «제가 볼 수 있는 자료에는 없습니다»**까지만** 말하게 했다. 규칙 12의 화면 목록에 사용자 화면(조직도)이 없다. 규칙 10은 주소를 답에 쓰지 못하게 한다. 그래서 어디서 볼지 · 링크를 줄 수 없었다. |
| 조직 도구가 돌려주는 칸 | org_lookup: teams(id · name · business · has_lead) · people(id · name · name_en). 역할 · 팀 · 상사 · 모듈 권한은 없다. 남의 모듈 줄은 0002가 본인과 대표에게만 연다. |

## 2. 무엇을 만들었나

| 회장 결정 | 결과 |
|---|---|
| 1 의도 파악 | 프롬프트: 첫 줄은 의도 확인. 못 할 때는 «어디서: » · «대신: »을 붙인다(9번). 직원의 재무 거절 규칙 답에도 어디서 · 대신을 붙였다. |
| 2 권한 조회 | DB `org_access_lookup`(definer, 읽기만): 대표는 전원, 사용자 관리자는 맡은 회사의 사원 · 팀장(회수자 제외 · 맡은 회사 줄만), 그 밖은 본인. 원가 4종은 대표 세션에만 싣는다. 도구 `person_access`. «X 권한은?» · «내 권한은?»은 **모델 없이 코드가 표로 답한다**(규칙 답 ⑥, 비용 0). 바꾸는 곳: 대표에게는 `https://chairman-os-eosin.vercel.app/settings/users?person=<id>` → 조직도 → 그 사람(조직도가 그 사람 패널을 바로 연다). 직원에게는 «대표에게 요청». |
| 3 이어서 질문 3개 | 모든 답 아래 버튼(누르면 바로 묻는다). 모델의 `[이어서]` 줄, 규칙 답 후보, 화면 기본 묶음 순으로 고른다. 코드 거름망을 거친다: 직원에게는 «회장» · 원가 · 구성 · 단가 낱말 금지, 재무 권한 없으면 재무 금지, 이니셔티브 · 대표 전용 금지, 화면 바꾸기 금지, 겹침 금지. |
| 4 보완 의견 | 답마다 접힌 «이 답이 부족했나요? 보완 의견 남기기». 질문 · 답 원문은 **DB가 본인 대화에서 복사한다**. 같은 답에 한 번, 하루 30건. 쓴 사람은 자기 것만(`ai_feedback_mine`), 대표는 전부 읽는다. 수정 · 삭제 grant 없음, 취소는 표시만. 쓰기마다 감사 줄. 민감 차단 세 겹: 앱 감지(mix-ratio + 낱말) · DB 낱말(켜기만) · 정리 직전 재감지. |
| 5 시스템 보완함 | `https://chairman-os-eosin.vercel.app/settings/feedback` (대표만). 거르기(상태 · 쓴 사람 · 화면 · 날짜), «AI 정리»(요약 · 기대 결과 · 지시문), 같은 화면 묶음 → «묶음 지시문», 복사 버튼 → «지시문 복사함», 상태 바꾸기, 이번 달 AI 정리 비용(ai_usage_log). 밤 정리: night-brief cron 끝에 새 의견 20개까지. 지시문 모양은 코드가 짓는다: ■ 보고 작성 규칙 · ■ 공통 규칙은 고정 글이고, 결정 줄은 늘 «(회장 확인 필요)». 비밀 · 이메일 · 전화는 지우고, 원가 낱말이 있으면 저장을 거부한다. 실행 경로는 없다. |

## 3. 고친 AI 답 — 실제 출력 그대로 (dummy, 규칙 답 — 모델 호출 없음)

dummy에는 «김병훈»이 없어서 같은 자리(사원 · DY · 팀 없음 · 상사 = 대표)인 «팀 없는 사원»으로 물었다.

대표 «팀 없는 사원 권한은?»:
```
팀 없는 사원의 권한 · 팀 · 상사를 보시려는 것으로 이해했습니다.

팀 없는 사원 — 사원 · 재직
팀: 미배정
직속 상사: 홍석현(회장)
회사 범위: DY (주)
권한:
· 결재 올리기 — 없음
· 사용자 관리자 — 없음
· 재무 입력 — 없음
· 월 마감 — 없음
· 문서 등록 — 없음
· 결재 대장 열람 — 없음
· 구매 — 없음
· 생산 — 없음
· 영업 — 없음
· 원가 관리 — 없음
바꾸려면: https://chairman-os-eosin.vercel.app/settings/users?person=00000000-0000-0000-0000-0000000d0012 → 조직도 → 팀 없는 사원
[근거 카드] 팀 없는 사원 · 권한 바꾸는 곳 → /settings/users?person=…0012
[이어서] 대기 중인 결재 보여줘 | 내가 처리할 결재 있어? | 이번 주 일정 알려줘
```

직원 «내 권한은?»:
```
내 권한 · 팀 · 상사를 보시려는 것으로 이해했습니다.

팀 없는 사원 — 사원 · 재직
팀: 미배정
직속 상사: 대표
회사 범위: DY (주)
권한:
· 결재 올리기 — 없음
· 사용자 관리자 — 없음
· 재무 입력 — 없음
· 월 마감 — 없음
· 문서 등록 — 없음
· 결재 대장 열람 — 없음
· 원가 관련 — 원가 관련 권한은 대표에게 문의
바꾸려면: 대표에게 요청하세요(대표가 사용자 화면 조직도에서 바꿉니다).
[이어서] 결재 양식 뭐 있어? | 내가 처리할 결재 있어? | 내 업무 보여줘
```

## 4. AI 정리 예시 (요약 · 기대 결과 · 지시문)

**모델 출력이 아니다.** 돈 드는 호출을 하지 않아서, dummy 시드에 손으로 쓴 예시를 넣었다(model `dummy-seed`). 모양은 실제 정리와 같다 — 같은 `buildInstruction`이 짓는다.
- ① 요약: 대표 화면의 AI 어시스턴트가 «사원의 권한은?»에 이름 · id만 답하고 끝났다 — 권한 · 팀 · 상사 칸과 바꾸는 곳이 없다.
- ② 기대 결과: «(사원) 권한은?»을 물으면 팀 · 직속 상사 · 회사 범위 · 모듈 권한 표와 «바꾸려면: 사용자 화면 → 조직도 → 그 사람» 링크가 한 번에 보인다.
- ③ 지시문: `[블록 지시 — 보완 의견 · /settings/users]` → ■ 현황 2줄 → ■ 회장 결정(아래는 AI 초안 — 회장 확인 필요) 2줄 → ■ 보고 작성 규칙 → ■ 공통 규칙 → 단계 3줄 → 최종 보고. 스크린샷 `3b-pc-feedback-inbox-main.png`.

## 5. 비용 추정

| 경로 | 추정(claude-sonnet-5-5, 입력 $2 · 출력 $10 / 100만 토큰) |
|---|---|
| «X 권한은?» 규칙 답 | $0 (모델 없음) |
| 그 밖 질문 + 이어서 줄 | 답마다 출력 약 30~60토큰 더 → +$0.0003~0.0006 |
| AI 정리 한 건(버튼) | 입력 약 3~4k(프롬프트 캐시) + 출력 약 0.8k ≈ **$0.015** |
| 묶음 지시문 | ≈ $0.02~0.04 |
| 밤 정리 상한(20건 + 묶음) | ≈ $0.3~0.5/밤. 새 의견이 없으면 $0 |

## 6. 검사 (워크트리, 하나씩)

typecheck PASS · lint PASS · check 전부 PASS(mobile은 서버 필요라 제외 — 미결 3) · check:migrations PASS · check:staging-sql-cost(0069 PGlite) PASS · build --webpack PASS.
DB/RLS 리뷰 1회: Critical 0. Important 3건은 고쳤다 — I1 지어낸 답은 믿지 않는 글로 다룬다, I2 대표 상사는 top만 싣는다, I3 관리자는 맡은 회사 · 회수자 숨김. Minor 3건도 고쳤다 — can_view grant 걷음 · 묶음 잠금 · 제출 잠금.

스크린샷: `C:\Users\Edison Hong\projects\chairman-os-assist\.screenshots\ai-assist\`
1 PC 도크(대표 권한 답) · 2 보완 칸 열림 · 3/3b 보완함 PC · 4 조직도 ?person= · 5 보완함 폰 · 6 폰 도크(직원 «내 권한은?») · 7 보완 의견 쓰기 · 8 보냄. 직원 화면 본문 «회장» 0(스크립트가 확인).

## 7. 회장이 할 일

| 순서 | 담당 | 상태 | 방법 |
|---|---|---|---|
| 1 | 회장 | 대기 | staging에 0069 반영(아래 명령 1) |
| 2 | 회장 | 대기 | staging 시험 SQL(명령 2~4) — 기대 `ERROR 0069 STAGING PASS a(…) … f(anon 거부)` |
| 3 | 회장 | 대기 | master에 합치기(명령 5~6) |
| 4 | 회장 | 대기 | 운영 반영(명령 7) — release-production.sh가 dry-run이 0069 하나인지 확인한 뒤 push · 배포 · health |
| 5 | 회장 | 대기 | 운영에서 AI 창에 «김병훈 권한은?» → 표 · 링크 확인. https://chairman-os-eosin.vercel.app/settings/feedback 열기 |

명령(한 상자에 하나):
```
cd ~/projects/chairman-os-assist
```
```
npm run db:push:staging
```
```
cp docs/onboarding/staging-tests/0069_staging_test.sql supabase/.temp/
```
```
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0069_staging_test.sql"
```
```
cd ~/projects/chairman-os
```
```
git merge --no-ff release/ai-assist -m "merge: AI 어시스턴트 보강 0069 — 권한 조회 · 이어서 질문 · 보완 의견 · 시스템 보완함"
```
```
bash scripts/release-production.sh 0069
```

## 8. 미결

1. **사용자 관리자 범위 해석** — «자기 회사 · 자기 아래 사람만»을 «맡은 회사의 사원 · 팀장»으로 구현했다. 0055의 사원 관리자(김병훈)는 자기 아래 사람이 없어서, subtree 교집합으로 하면 본인만 보인다. 회장 확인이 필요하다.
2. 이어서 질문은 저장하지 않는다 — 대화를 다시 열면 마지막 답의 버튼이 없다(칸이 0041에 없다). 필요하면 다음 번호에 칸을 하나 더한다.
3. check:mobile(120화면)은 메모리 때문에 돌리지 않았다.
4. «결산 잠정» 제안 번호 → 0070 뒤로 설계서를 정정해야 한다(다음 재무 블록에서 번호가 정해지면 같이).
5. 실제 모델로 AI 정리 · 이어서 줄을 시험하지 않았다(돈 드는 호출 금지). staging에서 버튼 한 번이 첫 실측이다(≈$0.015).
6. 지어낸 «답» 줄(0041 insert가 role을 보지 않음)은 막지 못한다. 그래서 프롬프트는 믿지 않는 글로 다루고, 화면이 경고를 띄운다. 0041을 고치려면 별도 결정이 필요하다.
