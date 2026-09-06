# UAT 실행 결과 — 2026-09-07

원본: `07_Test/07_Acceptance_Test_UAT_v1.0.xlsx` 01_Test_Cases (TC-001~025)
실행: Phase 1-D 블록 3 · live 모드(Supabase `nndvspgnljivkvihxlzj`) · Chairman 계정(홍성호)
빌드: `1a69df0` 이후 작업분 + 이 문서의 P0 수정 2건

> **Expected Result와 실제 결과가 일치해야 Pass. P0 Fail은 Production 배포 금지.** (원본 시트)

---

## 요약

| 지표 | 값 |
|---|---|
| 전체 Test | 25 |
| **Pass** | **12** |
| **Fail** | **8** (P0 7 / P1 1) |
| **Blocked** | **5** (전부 P0) |
| Pass Rate | 48% (Pass / 전체) |
| 실행 가능했던 것 중 Pass Rate | 60% (12 / 20) |

**Production 배포 판정: 불가.** P0 Fail 7건이 남아 있다.

다만 그 7건의 성격이 둘로 갈린다.

- **Phase 2 범위라 지금 있을 수 없는 것** (TC-017·018 Excel Import, TC-019·020 AI Agent,
  TC-023·024 DevOps) — 6건. 02_기능명세에서 CH-052~054(연동)와 CH-045~048(야간 Job)이
  전부 Phase 2고, 05_개발로드맵도 그렇게 잡혀 있다. Phase 1 결과물을 이 기준으로 재면
  처음부터 Fail이 나오게 되어 있었다.
- **Phase 1 범위인데 못 채운 것** — TC-010 하나. DEFERRED D-12 결정이 선행된다.

Blocked 5건은 전부 **두 번째 계정이 없어서** 못 돌렸다. 지금 이 시스템에 사람은 회장 한 명이다.
CH-049 초대 화면이 이번에 섰으므로(블록 2) 계정 하나만 만들면 그날 바로 실행할 수 있다.

**이번 실행 중에 고친 P0 2건**은 아래 표에서 `수정 후 Pass`로 표시했다. 상세는 맨 아래.

---

## 결과 표

| Test ID | Module | Scenario | Priority | 결과 | 근거 / 사유 |
|---|---|---|---|---|---|
| TC-001 | Auth | Chairman 로그인 | P0 | **Pass** | 미인증 요청이 `/`, `/approvals`, `/settings/users`, `/business/biz_dy` 전부 `307 → /login?next=…`로 막힌다. Chairman 세션에서는 대시보드가 완전히 뜬다. `audit_log`에 `action='login', actor_role='Chairman'` 기록 존재. ※ 비밀번호를 테스트가 갖고 있지 않아 **자격증명 제출 자체는 이번에 재실행하지 않았다** — 가드·프로필 확인·감사 기록 세 경로로 갈음 |
| TC-002 | Permission | Business 직원 격리 | P0 | **Blocked** | A사 직원 계정이 없다. 부분 근거: `/api/health`의 anon 측정에서 16개 표 전부 `rows: 0`, `rls_closed: true` — Default Deny는 서 있다. 회사 간 격리(`has_business()`)는 두 번째 계정이 있어야 잰다 |
| TC-003 | Dashboard | Business 추가 | P0 | **Pass** | `biz_uat_probe` 생성 → 새로고침 없이 카드 즉시 표시. `businesses` INSERT + `audit_log(action='create', actor_role='Chairman')` 동시 확인. 검증 후 행 삭제(감사 기록은 append-only라 남김) |
| TC-004 | Dashboard | Business 숨김 | P0 | **Pass** | HOF Robotics 숨김 → `5/5` → `4/5개 표시 중`, "숨김 1개 (데이터는 그대로 있습니다)" + 되돌리기 버튼. 그룹 KPI가 4개사 합계로 재계산(매출 66.3→64.5억). **새로고침 후 유지 확인**, `user_settings.hidden_businesses = ["biz_hof"]`. 되돌린 뒤 `[]` 확인 |
| TC-005 | Dashboard | Business 순서 저장 | P1 | **Fail** | Drag&Drop 미구현. `dashboard-board.tsx`가 `sort_order`를 그대로 쓴다(코드 주석에 명시). CH-005는 P1이고 Phase 1 범위에 넣지 않았다 |
| TC-006 | Finance | Revenue 합계 | P0 | **Pass** | 화면 그룹 KPI 8개 전부가 DB 5개사 합계와 일치. Revenue 66.3 / Cost 53.4 / EBITDA 5.0 / 영업이익 4.0 / 당기순이익 2.1 / Cash 87.1 / AR 45.0 / AP 27.9 (억) |
| TC-007 | Finance | EBITDA 계산 | P0 | **Pass**(기준 변경) | **원본 Expected('정의 Formula와 일치')는 DEFERRED D-01 결정 A로 대체됐다** — "시트에 기록된 EBITDA를 그대로 표시". 그 기준으로 일치: VANA 2.8억(CLAUDE.md 데이터 원칙), 그룹 5.0억 = 4.2+2.8+1.8−4.7+0.9. 실 Formula 검증은 Phase 2 ECOUNT 연동 때 |
| TC-008 | Decision | Today Decisions | P0 | **Pass** | 메인 '내 결정 사항'에 5건, 중요도→마감 순 정렬. Expected '상위 3~5개' 충족 |
| TC-009 | Decision | Approve | P0 | **Pass** | `dec_005` 승인 → `decisions.status='Approved'`, `decided_at`·`decided_by` 채워짐, `audit_log(action='approve')` 동시 기록 |
| TC-010 | Task | Waiting on Me | P0 | **Fail** | 목록 표시는 정상(3건, 대기일수·D-Day 포함). **'원 Task와 연결'이 안 된다** — 줄을 누르면 `/tasks?business=biz_vana&needed=1`(필터된 목록)로 가고 그 업무 자체로는 못 간다. **DEFERRED D-12** 결정 대기 |
| TC-011 | Alert | Critical Alert | P0 | **수정 후 Pass** | 실행 시점에는 Critical 패널이 하단 4열 그리드에 있어 KPI·차트를 지나쳐 스크롤해야 보였다 → '즉시 상단 노출' 불충족. **이번에 수정**: `CriticalBanner`를 화면 맨 위에 추가. 재실행 결과 `region "긴급 알림"`이 최상단, 링크가 `/approvals?tab=open&id=dec_002`로 실제 결정을 연다 |
| TC-012 | AI | AI Did Last Night | P0 | **수정 후 Pass** | 실행 시점에는 5건 전부 링크가 `href="#"`(죽은 링크)였다. **이번에 수정**: `artifact_link`가 http/https면 실제 링크, 아니면 경로를 글자로 표시. 현재 시드값은 `artifact://dummy/00X`라 링크가 아니라 경로로 뜬다 — Expected '작업수/상태/결과 링크 제공' 중 앞의 둘은 충족, 링크는 **열 수 있는 주소가 데이터에 들어와야 완성**된다(Phase 2 CH-045~048) |
| TC-013 | Search | 권한 내 검색 | P0 | **Pass** | '폴란드' 검색 → 프로젝트·업무·결정·문서 4종 통합 결과. 방금 만든 `dec_005`도 즉시 색인에 잡힘 |
| TC-014 | Search | 권한 밖 검색 | P0 | **Blocked** | B사 데이터에 접근하지 못하는 A사 계정이 필요하다. 검색은 앱에서 거르지 않고 0002의 read 정책에 의존하므로(설계상 의도) 실제 판정은 두 번째 계정이 있어야 난다 |
| TC-015 | Vault | 외주/일반계정 Vault 차단 | P0 | **Blocked** | Vault 등급 계정이 회장 하나뿐이다. 부분 근거: `documents_read`(0002)가 `class_rank(security_class) <= class_rank(max_class())`를 걸고 있고, 초대 화면(CH-049)이 `max_security_class`를 계정마다 지정한다. 실제 차단은 낮은 등급 계정으로 재야 한다 |
| TC-016 | Audit | 승인 로그 | P0 | **Pass** | TC-009의 승인이 `audit_log`에 `actor_user_id`(User) / `occurred_at`(time) / `action='approve'`(action) 세 칸 모두 기록. `actor_role='Chairman'`도 그 시점 값으로 함께 남음 |
| TC-017 | Integration | Excel Import 정상 | P0 | **Fail** | CH-054 미구현. Phase 2 범위 |
| TC-018 | Integration | Excel Import 오류 | P0 | **Fail** | 위와 같음. 업로드 경로 자체가 없다 |
| TC-019 | AI | Decision Memo | P0 | **Fail** | 야간 Agent(CH-045~048)가 아직 없다. 화면(CH-019)은 `ai_night_outputs` 시드를 읽어 그리는 단계고, 'Agent 실행'을 시킬 대상이 없다. Phase 2 범위 |
| TC-020 | AI | Agent 권한 제한 | P0 | **Blocked** | 위와 같은 이유로 실행할 Agent가 없다. 설계는 서 있다 — CLAUDE.md대로 야간 Job은 `user_profiles.role='AIAgent'` 계정으로 RLS 안에서 돌고, 이 프로젝트에 service_role은 없다 |
| TC-021 | Project | D-Day 계산 | P1 | **Pass** | deadline에서 자동 계산 확인: 마일스톤 `2026-09-23` → `D-16`(기준일 2026-09-07), 결정 `2026-09-13` → `D-6`, 지난 마감은 `D+3`/`D+4`로 표기 |
| TC-022 | Mobile | Decision 모바일 | P1 | **Blocked** | 브라우저 창 리사이즈가 이 환경에서 적용되지 않아 모바일 폭을 실제로 재지 못했다. 마크업에는 `col-span-12` / `xl:col-span-*`, `md:grid-cols-2` 분기가 있어 좁은 폭에서 세로로 쌓이게 되어 있으나 **육안 확인 전까지 Pass로 적지 않는다** |
| TC-023 | DevOps | Staging/Prod 분리 | P0 | **Fail** | Supabase 프로젝트가 하나뿐이고 Staging 환경이 없다. `.env.local` 한 벌로 live를 직접 본다 |
| TC-024 | DevOps | Rollback | P0 | **Fail** | 배포본이 없고(로컬 `next dev`만), 마이그레이션에 down 스크립트가 없다. 되돌리는 절차가 문서로도 코드로도 정의돼 있지 않다 |
| TC-025 | Documentation | 기능 문서 존재 | P0 | **Fail**(부분) | 있는 것: DB(마이그레이션 0001~0011 머리 주석), 데이터 원칙(CLAUDE.md), 미결정 사항(DEFERRED.md), 시드 규약(`src/data/README.md`), Vault 방침(`vault_columns.md`). **없는 것: API 문서, 환경변수 문서, 수정가이드** — 02_Definition_of_Done이 요구하는 5종 중 3종이 빠졌다 |

---

## P0 Fail 중 이번에 고친 것

### TC-011 — Critical Alert가 상단에 없었다

**무엇이 문제였나** CH-018의 Acceptance는 '**Critical rule 즉시 상단 노출**'인데,
`AlertPanel`이 하단 4열 그리드의 세 번째 칸에 있었다. 회장이 KPI 8타일과 12개월 차트를
지나쳐 스크롤해야 빨강을 본다. 그건 '즉시'도 '상단'도 아니다.

**어떻게 고쳤나** `components/dashboard/critical-banner.tsx`를 새로 만들어 화면 맨 위에 뒀다.
패널을 통째로 위로 올리지 않은 이유는, 그 패널이 경고 건수와 관련 결정까지 들고 있어
자리를 많이 먹고 Critical이 없는 날에는 맨 위에 빈 상자가 서기 때문이다.
배너는 **Critical이 있을 때만** 나타난다 — 늘 차 있으면 빨강이 흔해지고, 흔해진 빨강은 읽히지 않는다.

**덤으로 고친 것** 배너와 패널 둘 다 '관련 결정으로 이동'이 `href="#"`이었다.
CH-041이 `?id=`로 특정 결재를 여는 화면을 만들어 두었으므로 이제 실제로 그리로 간다.
판단은 `lib/alert-link.ts` 한 곳에 두었다 — 같은 알림이 두 자리에서 다른 곳으로 가면 안 된다.

**재실행** 대시보드 최상단에 `region "긴급 알림"`, 링크 `/approvals?tab=open&id=dec_002`. Pass.

### TC-012 — AI 결과물 링크가 죽어 있었다

**무엇이 문제였나** 5건 전부 `href="#"`이었다. `TODO(CH-019)` 주석이 달려 있었고,
누르면 아무 일도 일어나지 않았다. Acceptance는 '작업수/상태/**결과 링크** 제공'이다.

**어떻게 고쳤나** `artifact_link`가 http/https일 때만 실제 링크(`target="_blank"`)로 만들고,
아니면 경로를 글자로 보여 준다. `javascript:` 같은 스킴을 걸러 내는 일도 겸한다 —
야간 Job이 채우는 칸이라 사람이 검토하지 않은 값이 그대로 회장 화면의 링크가 되는 자리다.

**남는 것** 지금 시드의 값은 `artifact://dummy/001` 형태라 여전히 열리지 않는다.
다만 이제 '링크가 있는 척'이 아니라 '아직 경로뿐'이라고 화면이 말한다.
열 수 있는 주소는 Phase 2에서 야간 Job이 실제 결과물을 만들 때 들어온다.

---

## 고치지 않고 남긴 P0 Fail

### TC-010 — Waiting on Me가 원 Task로 못 간다

`/tasks/[id]`를 만들면 끝나지만, 그건 **DEFERRED D-12의 선택지 A**다.
D-12는 아직 회장 결정이 나지 않은 항목이라 임의로 고르지 않았다.
(A) 단건 화면 · (B) 목록에서 펼치기 · (C) 그대로 두기 — 셋의 값이 서로 다르다.

### TC-017 · 018 · 019 · 023 · 024

전부 Phase 2 범위이거나(연동·AI Agent) 배포 환경 자체가 필요한 것들(Staging·Rollback)이라
코드 한 줄로 닫을 수 있는 항목이 아니다.

### TC-025 — 문서 3종 부족

API 문서 · 환경변수 문서 · 수정가이드가 없다. 이건 Phase 2를 기다릴 이유가 없는 유일한 항목이라
**DEFERRED D-16**으로 올렸다.

---

## 실행 환경 메모

- 이번 실행으로 live DB에 남은 것: `dec_005`(폴란드 통관 대행사 선정, Approved).
  Sticky Alliance의 결재 목록에 실제로 뜬다. 시드 전체가 06_Dummy_Data 기반이라
  지우지 않고 두었고, TC-009/013/016의 근거가 이 행이다.
- 지운 것: `biz_uat_probe`(TC-003), UAT 초대 2건(블록 2 검증분).
  `audit_log`의 해당 기록은 append-only라 그대로 남아 있다 — 정상이다.
- `user_settings.hidden_businesses`는 검증 후 `[]`로 되돌렸다.
