# 결재 저장소(대장) · 엑셀 · 조직도 상사 승인 — 2026-10-07 블록

브랜치 `feat/approvals-ledger` · 마이그레이션 `supabase/migrations/0059_approval_chain.sql`.

## 0. 마이그레이션 번호

| 번호 | 상태 | 어디 |
|---|---|---|
| 0050 · 0051 · 0052 | 사용(ECOUNT) | feat/ecount-import · staging 반영 · production 미반영(릴리스 B) |
| 0053 | 일부러 비움 | — |
| 0054 · 0055 | 사용(첫 직원 결재 · 온보딩 위임) | master · staging · production 반영 |
| 0056 | 사용(ECOUNT 마무리) | feat/ecount-import · staging 반영 · production 미반영(릴리스 B) |
| 0057 | 예약(전표 증빙 제안) | 파일 없음 |
| 0058 | 사용(입구) | feat/intake · 회장이 staging 반영 중 |
| **0059** | **이 블록** | 구매(0059)가 원가 엔진으로 대체되어 빈 번호 — 다음 빈 번호 |
| 0060 | 사용(2026-10-10 긴급 수정 — 0059 읽기 정책을 `to authenticated`로) | master · `0060_approval_read_authenticated.sql` |
| 0061~0065 · 0066 | 원가 엔진 · 가격 엔진(견적) | feat/cost-engine |
| 0067 | 제안(판매 · 회계) | 파일 없음 |
| 0068~ | 제안(결산 잠정 — 0060에서 옮김) | 파일 없음 |

0059는 0058보다 뒤 번호라 production 순서는 B(0050 0051 0052 0056) → 0058 → 0059다. 0059를 0058보다 먼저 보내려면
`--include-all`이 필요해진다(0058이 그 뒤에 «앞 번호»가 된다) — 권장하지 않는다.

## 1. 현황(0059 전)

| 항목 | 0059 전 | 어디 |
|---|---|---|
| 결재선 첫 칸 | `my_approval_lead()` — 팀장(teams.lead_user_id), 공석 · 본인 · 떠남이면 reports_to 한 칸. 대표는 후보 아님(0054) | 0038 · 0054 1절 |
| 결재선 모양 | `approval_line` jsonb `[lead, rule, (chairman)]` 한 줄, 올리는 순간 얼림 | 0038 2절 · 0054 2절 |
| 단계 구조 | 팀장 한 단계(`lead_status` pending · approved · rejected · skipped) + 대표 큐(`chairman_required`). 단계 표 없음 | 0042 1절 |
| 팀장 처리 | `lead_decide(id, 승인?, 대표 확인 요청?)` — 승인 시 기준 미만은 «규칙 종결»(decided_by_kind 'rule') | 0042 |
| 팀장이 없을 때 | 팀장 단계 건너뜀(skipped) → 기준 미만은 **아무도 누르지 않고 «기록 완료»** · 이상은 대표 대기 | 0042 · 0054 |
| 대표 처리 | `decisions_decide` 정책으로 status update(4버튼: 승인 · 거절 · 수정요청 · 위임) | 0002 · 앱 recordDecisionAction |
| 반려 사유 | 없음(메모 칸 없음 — audit_log note만, 화면에서 안 받음) | — |
| 재상신 | 없음 | — |
| 저장 칸 | `form` jsonb(양식 값, 전부 문자열 · 금액 key 'amount'), `template_key`, `attachment_url` | 0038 |
| 끝난 결재 수정 | 양식 · 결재선만 얼림. 제목 · 상태는 승인권자(대표 · CEO)가 update 가능 | 0038 · 0042 |
| 읽기 | 회사 범위 AND (본인 · 처리자 · subtree · 주인 없음) + 팀장 칸 + 대표 큐 + 대표가 건너뛴 결재 | 0026 · 0042 · 0054 3절 |
| 대장 · 검색 · 합계 · 엑셀 | 없음(/approvals 목록 · 상세만) | — |

### 회장 결정과 다른 점

1. 결재선이 «팀장 한 칸»이다 — 상사의 상사를 거치지 않는다(결정: 사슬 전부 → 대표).
2. 팀장이 없거나 상사가 대표면 소액이 **승인 없이 «기록 완료»**로 닫힌다(결정: 대표 승인 필요).
3. 팀장 칸이 `teams.lead_user_id`를 먼저 본다(결정: `reports_to` 사슬만).
4. 반려 사유 · 재상신이 없다.
5. 끝난 결재를 승인권자가 update로 바꿀 수 있다(결정: 끝나면 값 수정 불가).
6. «결재 대장 열람» 권한 · 대장 화면 · 엑셀이 없다.
7. 대표 «한 번에 승인» · 하루 한 번 요약이 없다.

## 2. 이미 올라간 결재 — 권장안(원칙: 끝난 결재는 손대지 않는다)

| 종류 | 권장 | 이유 |
|---|---|---|
| 끝난 것(승인 · 반려 · «기록 완료») | **그대로 둔다.** 0059부터 세션은 고치지 못한다(`approval_closed_frozen`). 이름 · 팀 스냅숏만 백필 | 감사 기록. «기록 완료»를 다시 열면 이미 집행된 지출을 되돌리는 꼴 |
| 열린 «팀장 대기» | **예전 길로 끝낸다** — 팀장이 /me 요청함에서 처리(lead_decide 그대로 동작) | 새 규칙으로 바꾸면 이미 얼린 결재선을 고치는 일 |
| 열린 «대표 대기» | **예전 길로 끝낸다** — 대표가 /approvals에서 4버튼 처리(그대로 동작) | 같은 이유 |
| «기록 완료»로 닫힌 소액 중 회장이 보고 싶은 것 | 결재 대장(/approvals/ledger)에서 상태 «기록 완료»로 걸러 본다. 문제가 있으면 직원에게 새로 올리게 한다 | 닫힌 결재를 여는 길을 만들지 않는다 |

production의 열린 건수 확인(읽기 전용, 회장이 SQL 편집기에서):

```sql
select status::text, lead_status, decided_by_kind, count(*)
  from decisions where template_key is not null group by 1, 2, 3 order by 1, 2, 3;
```

## 3. 0059 설계 요약

- `approval_steps(decision_id, seq, approver_user_id, approver_name, why, is_chairman, status, decided_at, decided_by, note)` — 올리는 순간
  `decisions.approval_line`(얼린 값)에서 만든다. 쓰기는 definer 함수만(authenticated는 select만).
- 사슬: `approval_boss_chain(사람, 회사)` — reports_to를 따라 올라가며 떠남 · 사람 역할 아님 · **그 회사 접근 없음** · 중복을 건너뛰고,
  대표를 만나면 멈춘다. 회사 접근 없는 상사를 건너뛰는 이유: 그 사람은 결재를 읽지도 처리하지도 못해 결재가 멈춘다(회사 격리 유지).
- 처리: `approval_decide(id, 승인?, 의견)` · `approval_decide_many(ids, 의견)`. 차례인 결재자만. 대표는 결재자가 떠났거나 회사 접근을
  잃은 칸만 «대표 대리»로 처리(감사 메모에 남는다) — 멈춘 결재를 푸는 유일한 길.
- 대표 본인이 올린 양식 결재는 바로 대표 결정으로 닫힌다(자기에게 올리지 않는다).
- 알림: 다음 결재자(대표 제외) · 반려(사유 포함) · 최종 승인(올린 사람). 대표는 아침 요약 숫자 한 줄 + 승인함.
- 읽기: `decisions_chain_read`(결재선에 든 사람) · `decisions_ledger_read`(대표 전부 · `/approvals/ledger/<회사>` 줄은 그 회사 양식 결재 전부) ·
  `approval_steps_read`(결재가 보이면).
- 내려받기 감사: `approval_ledger_log(회사, 건수, 거르기)` → audit_log `download` · entity `decisions/ledger`.

## 4. 위임 결재(휴가 중 대리) — 설계만, 이번에 만들지 않는다

- 표 `approval_delegations(delegator, delegate, business_id null=전체, starts_on, ends_on, created_by, revoked_at)`.
  만드는 사람: 본인(자기 결재 권한을 남에게) 또는 대표. 받는 사람은 같은 회사 접근이 있어야 하고, 위임자의 **상사 사슬 안 또는 같은 팀**만.
- 처리 시점 판정(얼린 사슬은 그대로): `approval_decide`에서 «지금 차례 결재자 = auth.uid()» 또는
  «지금 차례 결재자가 오늘 유효한 위임을 auth.uid()에게 줬다»면 통과. 감사 메모 «위임 처리(원 결재자 X)», 단계의 decided_by = 대리인.
- 금지: 기안자 본인이 대리인이면 거부(자기 결재를 자기가 승인), 위임의 재위임 없음, 대표 칸은 위임 불가(대표 대리는 지금처럼 떠난 칸만).
- 알림: 위임 기간에 차례가 오면 원 결재자와 대리인 둘 다에게.
- 화면: /me «부재 설정»(기간 · 대리인 고르기 — 고르기 칸은 0055 staff_admin_options처럼 이름 · 팀만 주는 definer 함수).
- 시험: 기간 밖 · 다른 회사 · 기안자 = 대리인 · 재위임 · 대표 칸 위임이 모두 거부되는지.
