# 첫 직원 가입 뒤 회장이 볼 것 (DY 경영지원 1명)

순서대로. 하나라도 어긋나면 그 자리에서 멈추고 원인을 본다.

## 0. 가입 전

- [ ] `/settings/users`에서 **회장이 직접** 초대: 이메일 · **DY** · 역할 **TeamLead** · 팀 **경영지원** · 상사(회장 또는 DY 대표).
  회장이 만들거나 승인한 초대일 때만 가입 순간 **DY 재무 입력**이 자동으로 붙는다(0047). 다른 사람이 위임 초대하면 붙지 않는다 — 가입 뒤 회장이 체크한다.
- [ ] Resend SMTP가 켜져 있다(OPERATIONS 3-1 «메일 한도»). 켜기 전이면 시간당 몇 통에서 막힌다.
- [ ] 안내서 `docs/onboarding/staff-ko.pdf`의 **문의처** 칸을 채워 건넨다.

## 1. 로그인 기록 — `/settings/activity`

- [ ] 오늘 로그인 수에 1이 더해졌다.
- [ ] 타임라인에 그 사람 이름 · **팀장** 줄이 있고, 펼치면 **로그인** 줄(기기 요약 · 도시 · 시간대)이 맨 위.
- [ ] 이어서 `/me`, `/finance/biz_dy/…` **열람** 줄이 쌓인다(같은 화면 5분 안 재방문은 한 줄).
- [ ] 로그인 실패가 여러 줄이면 비밀번호 문제 — 본인에게 확인.

## 2. 조직도 — `/settings/users`

- [ ] 조직도에서 **DY → 경영지원** 아래에 그 사람이 있다(초대의 팀 · 상사가 가입 순간 붙는다, 0028).
- [ ] 상세 패널: 역할 팀장 · 회사 범위 DY만 · **모듈 권한 → 재무 → DY: 재무 입력 ☑ / 월 마감 ☐**.
- [ ] 재무 권한은 회사마다 따로다(`/finance/biz_dy`). 나중에 다른 회사 범위를 더해도 그 회사 재무는 따로 체크하기 전까지 닫혀 있다.

## 3. 첫 전표의 감사 기록

`/settings/activity`는 **열람 · 로그인**만 보여 준다. 쓰기(전표 입력) 기록은 `audit_log`에 있고 지금은 화면이 없다.
Supabase 대시보드(production) **SQL Editor**에서 읽기 전용으로:

```sql
select occurred_at, actor_role, action, entity_table, entity_id, business_id, note, after->'lines' as lines
  from audit_log
 where entity_table in ('journal_entries', 'official_statements')
   and business_id = 'biz_dy'
 order by occurred_at desc
 limit 10;
```

- [ ] 맨 위 줄: `actor_role = TeamLead` · `action = create` · `entity_table = journal_entries` · `note = 전표 입력` · 전표번호(M…).
- [ ] `/finance/biz_dy/journal`에서 같은 전표번호가 **잠정**으로 보인다.
- [ ] 그 사람에게 `/finance/biz_vana` 같은 다른 회사 주소를 열게 해 본다 — 숫자가 비어 있거나 404여야 한다.
- [ ] 마감 버튼이 그 사람 화면에 없다(월 마감은 회장 · CFO).

## 4. 되돌릴 때

권한만 거둔다: `/settings/users` 상세 → 모듈 권한 체크 해제(즉시 DB가 막는다). 사람 전체는 «권한 회수»(OPERATIONS 4절) —
회수하면 모듈 권한 줄도 함께 지워지고, 다시 초대해도 옛 권한은 살아나지 않는다.
입력된 전표는 지우지 않는다 — 마감 전이면 정정 전표로 바로잡는다.
