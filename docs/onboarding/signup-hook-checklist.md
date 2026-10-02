# 0043 Before User Created Hook — production에서 켜기 전 (2026-10-02 · 실행 전)

Hook은 **새 계정이 생길 때만** 돈다 — 이미 있는 계정(회장 · ai-agent 등)의 로그인은 막지 않는다. 막힐 수 있는 것은 **앞으로 만들 계정**이다.
실패는 **닫힌 쪽**이다: 함수가 오류를 내거나 Auth가 함수를 못 부르면 초대된 사람까지 가입이 500으로 막힌다. 끄면 즉시 0042 상태로 돌아간다(DB 변경 없음).

## A. production 상태 확인 — 회장 · SQL Editor · 읽기 전용

```sql
-- A1. Auth 서버가 함수를 부를 수 있는가 (staging은 2026-10-02 둘 다 true 확인)
select has_function_privilege('supabase_auth_admin','public.before_user_created_hook(jsonb)','execute') as auth_exec,
       has_schema_privilege('supabase_auth_admin','public','usage')                                  as auth_schema_usage,
       has_function_privilege('anon','public.before_user_created_hook(jsonb)','execute')             as anon_exec;
-- 기대: true · true · false. auth_schema_usage가 false면 켜지 않는다 → 0049(옛 stash의 grant 한 줄)를 staging → production으로 먼저.

-- A2. 함수가 초대를 실제로 보는가 (stable 함수, 아무것도 쓰지 않는다)
select email from user_invitations where accepted_at is null and revoked_at is null limit 1;
select public.before_user_created_hook('{"user":{"email":"<위 이메일>"}}'::jsonb);         -- 기대: {}
select public.before_user_created_hook('{"user":{"email":"nobody@example.com"}}'::jsonb);  -- 기대: error · http_code 403

-- A3. 지금 있는 계정 — 있는 계정은 안전, 없는 계정을 어떻게 만들지 정한다
select u.email, u.created_at, p.role, p.revoked_at
  from auth.users u left join user_profiles p on p.user_id = u.id order by u.created_at;

-- A4. 손으로 넣은 초대의 이메일에 공백 · 대문자가 섞였는가 (0행이어야 한다)
select email from user_invitations where email <> lower(trim(email));

-- A5. 이력 (staging은 0044 = city_anchors로 정상 확인)
select version, name from supabase_migrations.schema_migrations where version >= '0042' order by version;
```

## B. 초대 흐름 밖에서 계정이 생기는 길

| 경로 | Hook에 걸리나 | 할 것 |
|---|---|---|
| 직원 `/signup` | 걸림 | 앱 초대가 먼저(지금 흐름 그대로) |
| 대시보드 **Add user** · **Invite user** | 걸림 | `/settings/users` 초대 저장 → 같은 이메일로 생성(OPERATIONS 3절 ①→②) |
| **시스템 계정 ai-agent@ (0005)** · **integration@ (0006, 예약)** | 걸림 | **초대 행을 넣지 않는다** — 시스템 역할은 초대 대상이 아니고(permissions.ts INVITABLE_ROLE), 초대 이행이 사람 규칙(상사 · 입사일)을 채운다. **Hook 끔 → Add user → bootstrap SQL → Hook 켬**을 한 묶음으로. ai-agent@가 A3에 이미 있으면 할 일 없음 |
| 첫 회장 bootstrap(새 프로젝트 · 재구축) | 걸림, 초대 불가(`invited_by`가 기존 사용자를 요구) | Hook을 켜기 **전에** 만든다 |
| SQL 직접 insert · 덤프 복원 | 안 걸림 | 복원 뒤 bootstrap을 Add user로 다시 할 때는 위 줄 |
| 지운 계정을 다시 만들기 | 걸림(수락된 초대는 무효) | 앱에서 재초대 후 생성 |
| 비밀번호 재설정 · 이메일 변경 | 안 걸림 | — |

## C. staging에서 먼저 (회장 대시보드 + 코드 쪽 확인)

1. staging Hook 켬 → 초대된 이메일로 `/signup` 끝까지(메일 → `/auth/confirm` → 비밀번호 → `/me`).
2. 초대 없는 이메일을 anon 키로 직접 `/auth/v1/signup` → **403**과 «등록되지 않은 이메일…»(500이면 실패).
3. Add user: 초대 없는 이메일 거절 · 초대된 이메일은 생성 + 권한 붙음. 대소문자/공백 섞인 이메일 · 회수된 초대(403) · 결재 대기 초대(통과, 권한은 승인 뒤).
4. 기존 계정(회장 · AIAgent) 로그인 · 야간 Job.
5. Auth Logs에 hook 오류 없음 → **끄고** 초대 없는 이메일이 다시 통과하는지(롤백이 즉시 듣는지) → 테스트 계정 정리.
   앱 화면은 403이든 500이든 «가입 메일을 보내지 못했습니다»로 같다 — 원인은 Vercel 로그 `[signup] signUp <code>`와 Supabase Auth Logs로 가른다.

## D. production

A 확인 → (필요하면 grant 마이그레이션, 승인) → 시스템 계정 처리 끝 → 대시보드 Hooks → Before User Created → Postgres `public.before_user_created_hook` 켬 → C-1 · C-2를 한 번씩.
**되돌리기:** 같은 화면에서 끈다. 그게 전부다.

## 문서와 어긋난 곳 (같이 고칠 것)

- 0043 머리 주석은 시스템 계정에 «초대를 먼저 넣거나»를 허용하지만 permissions.ts 원칙과 맞지 않는다 — «Hook을 끈다»로 통일.
- OPERATIONS 3-1 6번은 schema usage 선행 조건을 말하지 않고, 2절 bootstrap 절차에 Hook 끄기가 없다.
- stash `0044 signup hook schema usage`는 번호가 0044_city_anchors와 겹친다 — 쓸 일이 생기면 새 번호로. staging에서는 필요 없음(이미 USAGE 있음).
