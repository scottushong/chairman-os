# 운영 예시(시드) 줄 정리 — 권장안 (실행하지 않음)

작성 2026-10-12. 찾는 SQL: `C:\Users\Edison Hong\projects\chairman-os-seed\docs\onboarding\seed-check.sql`(읽기 전용, 한 상자에 한 쿼리).

## 무엇인가

- 운영을 처음 만들 때 마이그레이션 `0003_seed.sql`이 06_Dummy_Data(`src/data/*.json`, `npm run gen:seed`)를 넣었다. 사람이 만든 줄이 아니다.
- «Hot-melt 가격 승인» = `tasks.tsk_002`. 담당은 시드의 가짜 사람(user_001)이라 계정이 없다.
- staging 기준(2026-10-12, 운영도 같은 0003): 업무 5 · 프로젝트 5 · 결정 4 · 알림 4 · 목표 3 · 마일스톤 3 · 월간 우선순위 2 · 핵심 위험 3 · 야간 AI 출력 5 · 시트 재무 숫자(finance_kpis) 512.
- finance_kpis(시트 숫자)와 businesses는 **예시가 아니라 원천**이다(CLAUDE.md «06_Dummy_Data = 숫자 원천», VANA EBITDA +2.8억 유지). 정리 대상에서 뺀다.

## 권장안 A — «예시» 표시 칸 + 직원 화면에서 숨김 (권장)

1. 다음 빈 번호 마이그레이션: 시드 표 아홉(tasks · projects · decisions · alerts · goals · milestones · monthly_priorities · critical_risks · ai_night_outputs)에 `is_example boolean not null default false`를 더한다. `seed-check.sql`과 **같은 id 목록**에만 true를 적는다(감사 한 줄 — 무엇을 표시했는지).
2. 직원 화면 · 직원 AI 도구 · 아침 브리핑 · 주의 점수 · 회사 진척은 `is_example`을 뺀다(restrictive select 정책 하나 — 대표 세션만 통과).
3. 대표 화면에서는 그대로 보이고 제목 옆에 «예시» 꼬리표를 붙인다. 화면 위에 «예시 9종 · 숨기기» 토글을 둔다.
4. 지우지 않는다. 되돌리기 = `is_example = false`.

이유: 지우기 금지 원칙 안에서 직원에게는 «없는 것»이 되고, 대표는 첫 화면 모양을 계속 참고할 수 있다. 상태를 바꾸지 않으므로 «완료됐다 · 취소됐다»는 거짓 기록이 남지 않는다.

## 다른 선택지 (권장하지 않음)

| 방법 | 문제 |
|---|---|
| B 상태 바꾸기(업무 Done · 알림 Resolved · 결정 Delegated) | 일하지 않은 일이 «완료»로 남는다. 통계 · 브리핑의 완료 수가 틀어진다. 결정 enum에는 «취소»가 없다. |
| C soft delete(deleted_at) | projects · goals · milestones · priorities · risks만 칸이 있다(0042). tasks · decisions · alerts · ai_night_outputs는 없다. 대표 화면에서도 사라진다. |
| D 실제 DELETE | 되돌릴 수 없는 삭제라 금지. 감사 · 이력 줄(decision_log 등)이 그 id를 가리킨다. |

## 회장이 정할 것

- A로 갈지. A면 다음 블록에서 마이그레이션 · 화면 · check:migrations 시나리오(직원 0줄 · 대표 «예시» 꼬리표)를 만든다.
- 시드 결정 4건(dec_001~004, «Hot-melt 판매가격» 등)은 대표 화면 «내 결정 사항»에 Open으로 떠 있다. A의 «예시» 꼬리표로 충분한지.
