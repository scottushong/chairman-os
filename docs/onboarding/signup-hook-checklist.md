# 0043 Before User Created Hook — 회장이 따라 할 클릭 순서 (2026-10-03 · 2026-10-06 갱신 · 아직 켜지 않음)

> **2026-10-06 현황:** 첫 직원(김병훈 · DY 경영지원)이 가입을 마쳤다. production에서 돌린 **A1 결과 = `true · true · false` → 정상**(2절 표 첫 줄). 남은 것은 3 → 4 → 5뿐이다.
> **켜는 때:** 다음 직원을 초대하기 **전**(회장 초대든 «DY 사용자 관리자» 위임 초대든). 위임 초대(0055)가 production에 들어가기 전에 켜 두면, 관리자가 초대를 시작하는 첫날부터 초대 없는 가입이 막혀 있다.

**언제:** 첫 직원이 가입을 마친 **뒤**. 그 전에는 켜지 않는다(첫 가입이 막히면 원인 가르기가 두 겹이 된다).
**한 줄 요약:** A1 쿼리 → 결과 읽기 → 시스템 계정 확인 → 대시보드에서 켬 → 두 가지 확인 → 문제면 같은 화면에서 끔.

## 1. A1 쿼리 돌리기 (읽기 전용 · 아무것도 바꾸지 않는다)

1. https://supabase.com/dashboard → 프로젝트 **nndvspgnljivkvihxlzj**(production · Tokyo)를 고른다. staging(itpenmxyracfhyormcep · Seoul)이 아닌지 주소창으로 확인.
2. 왼쪽 세로 메뉴 **SQL Editor** → 위쪽 **+ New query**.
3. 아래를 붙여 넣고 오른쪽 아래 **Run**(또는 Ctrl+Enter). 같은 쿼리가 `docs/onboarding/hook-a1.sql`에 파일로 있다.

```sql
select has_function_privilege('supabase_auth_admin','public.before_user_created_hook(jsonb)','execute') as auth_exec,
       has_schema_privilege('supabase_auth_admin','public','usage')                                  as auth_schema_usage,
       has_function_privilege('anon','public.before_user_created_hook(jsonb)','execute')             as anon_exec;
```

## 2. 결과 읽기

| auth_exec | auth_schema_usage | anon_exec | 뜻 | 할 일 |
|---|---|---|---|---|
| true | true | false | 정상 | 3으로 |
| true | **false** | false | Auth가 함수를 못 찾는다 → 켜는 순간 **모든 가입이 500** | 켜지 말고 결과를 Claude에게. grant 한 줄 마이그레이션(새 번호)을 staging → production으로 먼저 |
| **false** | — | — | Auth가 함수를 못 부른다 | 위와 같음 |
| — | — | **true** | 로그인 안 한 사람도 함수를 부른다(정보 노출은 없지만 0043 의도와 다름) | 켜도 되지만 결과를 Claude에게 |
| 오류 «function … does not exist» | | | production에 0043이 없다 | 켜지 말고 Claude에게 |

## 3. 시스템 계정 확인 (같은 SQL Editor)

```sql
select u.email, u.created_at, p.role, p.revoked_at
  from auth.users u left join user_profiles p on p.user_id = u.id order by u.created_at;
```

- **ai-agent@…가 목록에 있다** → 할 일 없음(Hook은 이미 있는 계정의 로그인을 막지 않는다).
- **없다**(야간 Job을 아직 안 켰다) → 지금은 그대로 둔다. 나중에 만들 때는 **Hook 끔 → Authentication → Users → Add user → bootstrap SQL → Hook 켬**을 한 번에(아래 B표). 초대 행을 넣어 통과시키지 않는다.
- integration@는 예약(아직 만들지 않음) — 같은 규칙.
- 회장 · 첫 직원 계정이 보이면 정상.

## 4. 대시보드에서 켜기

1. 왼쪽 세로 메뉴 **Authentication**(사람 아이콘) → 안쪽 메뉴 **Auth Hooks**(«Hooks»로 보일 수 있음).
2. **Add hook**(또는 **Add a new hook**) → **Before User Created hook**.
3. Hook type: **Postgres** → Schema: **public** → Function: **before_user_created_hook**.
4. **Enable hook** 스위치 켬 → **Create hook**(또는 **Save**).
5. 목록에 «Before User Created · Enabled»가 보이면 끝. 이 순간부터 초대 없는 이메일은 가입이 막힌다.

## 5. 켠 뒤 확인 (5분)

1. **초대 없는 이메일이 막히는가:** 앱의 `/signup`은 초대 없는 이메일이면 Hook까지 가지 않고 «관리자에게 문의»로 먼저 멈춘다 — 그래서 대시보드로 시험한다.
   **Authentication → Users → Add user → Create new user** → 초대하지 않은 이메일(예: `hook-test@example.com`) · 아무 비밀번호 → **Create user**.
   «등록되지 않은 이메일…» 같은 오류로 **거절되면 정상**. 사용자가 만들어지면 Hook이 안 켜진 것 — 그 사용자를 ⋯ → Delete user로 지우고 4를 다시 본다.
   Authentication → Logs에 hook 403이 보이면 정확히 막힌 것. **500 · «hook failed»**면 즉시 6으로.
2. **기존 계정이 그대로인가:** 회장 계정으로 로그아웃 → 로그인. 첫 직원에게 «다시 로그인해 보라»고 한 번.
3. (다음 직원을 초대할 때) 초대 저장 → 그 이메일로 `/signup` → 메일 → 비밀번호 → `/me`까지 가면 Hook이 초대를 정확히 본 것.
4. (0055 이후) **사용자 관리자가 보낸 초대**도 같은 길로 통과해야 한다 — 위임 초대도 `user_invitations` 한 줄이라 Hook이 똑같이 본다. 회장이 관리자 권한을 끈 뒤에는 그 관리자의 대기 초대가 자동으로 «취소됨»이 되고, 그 이메일 가입은 Hook에서 막힌다(정상).
5. 가입한 직원의 조직도 패널에 **결재 올리기 ☑**가 자동으로 있다(0054) — 없으면 0054가 production에 없는 것.

## 6. 문제가 생기면 끄는 법 (즉시 원상태)

**Authentication → Auth Hooks → Before User Created → Enable 스위치 끔 → Save.** 그게 전부다 — DB는 바뀌지 않았고, 끄는 순간 0042 상태로 돌아간다.
그다음 Claude에게 «Hook 껐다 + Auth Logs 오류 한 줄»을 주면 원인을 가른다.
끈 동안에는 초대 없는 이메일도 가입은 된다 — 다만 프로필이 생기지 않아 로그인 뒤 아무것도 보이지 않는다(기본 거부). 다시 켠 뒤 Authentication → Users에서 그런 계정이 생겼는지 한 번 본다.

---

# 참고 — 사전 작업 원본 (2026-10-02)


Hook은 **새 계정이 생길 때만** 돈다 — 이미 있는 계정(회장 · ai-agent 등)의 로그인은 막지 않는다. 막힐 수 있는 것은 **앞으로 만들 계정**이다.
실패는 **닫힌 쪽**이다: 함수가 오류를 내거나 Auth가 함수를 못 부르면 초대된 사람까지 가입이 500으로 막힌다. 끄면 즉시 0042 상태로 돌아간다(DB 변경 없음).

## A. production 상태 확인 — 회장 · SQL Editor · 읽기 전용

```sql
-- A1. Auth 서버가 함수를 부를 수 있는가 (staging은 2026-10-02 둘 다 true 확인)
select has_function_privilege('supabase_auth_admin','public.before_user_created_hook(jsonb)','execute') as auth_exec,
       has_schema_privilege('supabase_auth_admin','public','usage')                                  as auth_schema_usage,
       has_function_privilege('anon','public.before_user_created_hook(jsonb)','execute')             as anon_exec;
-- 기대: true · true · false. auth_schema_usage가 false면 켜지 않는다 → 옛 stash의 grant 한 줄을 **새 번호**(0049는 staff_terms · 0050은 ECOUNT가 썼다)로 staging → production 먼저.

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
