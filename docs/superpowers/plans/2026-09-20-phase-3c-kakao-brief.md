# Phase 3-C — 카톡 아침 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 07:00 KST에 야간 Job이 브리핑을 만들고, 그 마지막 단계로 회장의 카카오톡에 "나에게 보내기"로 한 줄 요약과 `/ai` 링크를 보낸다.

**Architecture:** 카카오 OAuth 토큰은 `chairman_kakao_token`(0023) 한 행에 담기고, **표는 아무도 직접 읽지 못한다** — `revoke all` + RLS를 두 겹으로 걸고, security definer 함수 네 개만 문으로 남긴다(0019 `chairman_today_condition()` keyhole의 전례를 한 단계 더 좁힌 것이다). 발송은 `runNightBrief()`의 마지막 단계로 들어가고 `trigger === 'cron'`일 때만 돈다. 실패해도 예외를 밖으로 던지지 않는다 — Job의 성패는 브리핑 행이 남았느냐로만 정한다. Vercel Hobby는 cron 슬롯이 하나라서 기존 23:00 KST Job을 07:00 KST로 옮겨 생성과 발송을 한 번에 한다.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript, Supabase(PostgREST + RLS, service_role 없음), 카카오 로그인 REST API(`kauth.kakao.com`) + 카카오톡 메시지 REST API(`kapi.kakao.com/v2/api/talk/memo/default/send`), Vercel Cron.

**Spec:** 이 문서 맨 아래 [부록 A — 원문 스펙](#부록-a--원문-스펙). 별도 spec 파일을 두지 않는다 — 스펙이 다섯 줄짜리라 계획과 떨어지면 오히려 찾기 어렵다.

---

## Global Constraints

이 절의 값은 모든 Task의 요구사항에 묵시적으로 포함된다.

- **service_role은 이 프로젝트에 없다.** 야간 Job은 `AI_AGENT_EMAIL`/`AI_AGENT_PASSWORD`로 로그인한 AIAgent 세션으로 RLS 안에서 돈다(`src/lib/supabase/service-account.ts`). 카카오 토큰도 그 세션이 읽을 수 있어야 한다.
- **새 마이그레이션은 번호 `0023`.** 적용된 SQL(0001~0022)은 편집·삭제·번호 변경하지 않는다. 고칠 것이 있으면 새 번호로 앞으로 고친다(`docs/OPERATIONS.md` 9절).
- **`alter type ... add value`와 같은 트랜잭션 안에서 새 enum 값을 리터럴로 쓰면 55P04로 터진다.** 0013·0015가 같은 이유로 `auth_role()::text` 비교를 쓴다. 0023도 새 `audit_action` 값을 같은 파일 안에서 리터럴로 쓰지 않는다 — 실제 사용은 런타임 TypeScript에서만 한다.
- **`audit_action` enum에 `insert`는 없다.** 현재 값: `read`, `create`, `update`, `delete_request`, `approve`, `reject`, `modify`, `delegate`, `permission_change`, `export`, `login`, `night_job_completed`(0013), `ecount_sync_completed`(0015). 0022가 이 함정으로 production에서 터진 적이 있다.
- **'오늘'은 언제나 KST다.** SQL에서는 `(now() at time zone 'Asia/Seoul')::date`, TypeScript에서는 `kstToday()` / `kstDate()`. Postgres `current_date`(서버 UTC)를 쓰지 않는다.
- **카카오 텍스트 템플릿의 `text`는 200자 제한이다.** 넘치면 카카오가 거절한다. 자르는 책임은 우리에게 있다.
- **비밀값은 `NEXT_PUBLIC_` 접두사를 붙이지 않는다.** 붙이는 순간 빌드 산출물에 박혀 브라우저로 나간다.
- **모든 사용자용 문구는 한국어다.** 코드 주석도 이 저장소 전체와 같이 한국어로 쓰고, "무엇을"이 아니라 "왜 이렇게 했나"를 적는다.
- **나가기 전에 `npm run typecheck && npm run lint && npm run build`가 전부 통과해야 한다.** 새 동적 라우트를 만든 직후에는 `build`를 한 번 돌려야 `tsc`가 통과한다(`docs/OPERATIONS.md` 1절).
- 이 저장소에는 단위 테스트 러너가 없다. 검증은 `scripts/check-*.ts` + `npm run check:*` 관례를 따른다(`check:migrations`, `check:fx`, `check:weather` 등).

### 새 환경변수 (Vercel에 넣을 이름)

| 이름 | 값 | 어디에 |
|---|---|---|
| `KAKAO_REST_API_KEY` | 카카오 앱의 REST API 키 | Production + Preview |
| `KAKAO_REDIRECT_URI` | `https://chairman-os-eosin.vercel.app/api/kakao/callback` | Production |
| `APP_BASE_URL` | `https://chairman-os-eosin.vercel.app` | Production |
| `KAKAO_CLIENT_SECRET` | 카카오 콘솔에서 Client Secret을 **사용함**으로 켰을 때만 | Production + Preview |

`KAKAO_REDIRECT_URI`를 요청 호스트에서 유도하지 않고 환경변수로 박는 이유: Vercel Preview는 배포마다 호스트가 달라지는데 카카오 콘솔에 등록된 리다이렉트 URI는 고정된 두 개(`https://chairman-os-eosin.vercel.app/api/kakao/callback`, `http://localhost:3000/api/kakao/callback`)뿐이다. 유도하면 Preview에서 매번 `KOE006`(등록되지 않은 redirect_uri)이 난다.

Preview(staging)에서 카카오 연결까지 시험하려면 별도 카카오 앱과 등록된 고정 Preview URL이 필요하다. **이번 릴리스에서는 하지 않는다** — Preview에서는 연결이 없는 상태(= "카카오 연결" 버튼만 보이고 발송은 건너뛴다)가 정상 동작이고, 그것 자체가 Task 8에서 검증할 경로다.

---

## File Structure

**새로 만드는 것**

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0023_chairman_kakao_token.sql` | 토큰 표 + RLS + keyhole 함수 4개 + `audit_action` 값 2개 + 컨디션 fallback 함수 |
| `src/types/kakao.ts` | `KakaoConnection`(화면용 상태), `KakaoTokenSet`(서버 전용 토큰 한 벌) |
| `src/lib/kakao/config.ts` | 환경변수 읽기 한 자리. `requireKakaoConfig()` |
| `src/lib/kakao/token.ts` | 인가코드 교환 · refresh · `ensureFreshAccessToken()` |
| `src/lib/kakao/message.ts` | **순수 함수** `buildKakaoBriefText()` + `sendKakaoMemo()` |
| `src/lib/kakao/send-brief.ts` | `sendKakaoBrief()` — 토큰 확보 → 발송 → `audit_log` |
| `src/app/api/kakao/auth/route.ts` | 카카오 로그인으로 보내는 입구 (Chairman만) |
| `src/app/api/kakao/callback/route.ts` | 인가코드 → 토큰 저장 → `/settings/chairman`으로 복귀 |
| `src/app/api/kakao/test/route.ts` | 테스트 발송 (Chairman만) |
| `src/components/settings/kakao-connect.tsx` | "카카오 연결" · "다시 연결" · "연결 해제" · "테스트 발송" |
| `scripts/check-kakao.ts` | `buildKakaoBriefText()` 검사 (`npm run check:kakao`) |

**고치는 것**

| 파일 | 무엇을 |
|---|---|
| `vercel.json` | cron `0 14 * * *` → `0 22 * * *` |
| `src/lib/ai/night-brief.ts` | 마지막 단계로 `sendKakaoBrief()` 호출, 23:00 주석 정정, 컨디션 fallback |
| `src/lib/ai/adapter.ts` | `ChairmanContext['checkin']`에 `as_of` 추가 |
| `src/lib/ai/prompts/daily-brief.md` | 컨디션이 전날 값일 때의 문장 지시 |
| `src/lib/repository/types.ts` | `getTodayCondition` → `getRecentCondition`, `getKakaoConnection` 추가 |
| `src/lib/repository/supabase.ts` | 위 둘의 구현 |
| `src/lib/repository/dummy.ts` | 위 둘의 dummy 구현 |
| `src/app/(dashboard)/settings/chairman/page.tsx` | "카카오 알림" 절 추가 |
| `scripts/check-migrations.ts` | 0023 RLS·keyhole 검사 |
| `package.json` | `check:kakao` 스크립트 |
| `.env.example` | 카카오 4종 + cron 시각 정정 |
| `docs/OPERATIONS.md` | 1절 Preview 환경변수 표, cron 시각 |
| `DEFERRED.md` | 이번에 고른 것과 버린 것 |

---

## Task 1: 0023 마이그레이션 — 토큰 표와 네 개의 문

**Files:**
- Create: `supabase/migrations/0023_chairman_kakao_token.sql`
- Modify: `scripts/check-migrations.ts` (RLS 절 끝에 0023 검사 추가)

**Interfaces:**
- Consumes: 0001의 `audit_action` enum · `set_updated_at()`, 0002의 `is_active()` · `auth_role()`, 0015의 `is_integration()`
- Produces: 표 `chairman_kakao_token`; 함수 `kakao_token_status()`, `kakao_token_for_send()`, `kakao_token_save(text,text,timestamptz,timestamptz,text)`, `kakao_token_refreshed(text,timestamptz,text,timestamptz)`, `kakao_token_clear()`, `chairman_recent_condition()`; enum 값 `kakao_sent` · `kakao_failed`

- [ ] **Step 1: 마이그레이션 파일을 쓴다**

`supabase/migrations/0023_chairman_kakao_token.sql`:

```sql
-- =====================================================================
-- Chairman OS — 0023_chairman_kakao_token
-- 출처: Phase 3-C 카톡 아침 알림
-- 작성: Phase 3-C (2026-09-20)
--
-- 무엇이 없어서 만드나
--   야간 브리핑은 /ai를 열어야 보인다. 회장이 아침에 앱을 안 열면 브리핑은 없는 것과 같다.
--   카카오톡 '나에게 보내기'로 한 줄을 밀어 넣으면 그 한 줄이 링크가 되어 /ai로 데려온다.
--   그러려면 회장의 카카오 OAuth 토큰을 보관할 자리가 필요하다.
--
-- 권한 — 0019보다 한 단계 더 좁다. **아무도 표를 직접 읽지 못한다**
--   0019 chairman_checkins는 표 자체를 Chairman에게 열어 두고 AIAgent에게만 keyhole을 줬다.
--   여기서는 Chairman에게도 표를 열지 않는다. 담긴 것이 건강 기록이 아니라 **외부 계정의
--   bearer 자격증명**이기 때문이다. 체중은 새 나가면 프라이버시 사고지만, access_token은
--   새 나가는 순간 남이 회장 이름으로 카카오톡을 보낸다. 값을 읽을 수 있는 코드 경로가
--   하나라도 더 있으면 언젠가 그 경로가 화면으로 이어진다 — 0019가 sleep_hours를 keyhole
--   반환값에서 아예 뺀 것과 같은 판단을, 여기서는 표 전체에 적용한다.
--
--   그래서 문은 네 개뿐이고 전부 security definer다. 각 함수가 자기 몸통 안에서 역할을 판정한다.
--
--     kakao_token_status()     Chairman           연결됐나 · 언제까지 · 어떤 동의를 받았나.
--                                                 **토큰 값은 반환하지 않는다.** 화면이 쓴다.
--     kakao_token_for_send()   Chairman, AIAgent  토큰 한 벌. 발송하는 코드만 쓴다.
--     kakao_token_save(...)    Chairman           연결/재연결. 행을 만들거나 통째로 갈아 끼운다.
--     kakao_token_refreshed(…) Chairman, AIAgent  refresh로 받은 새 access_token만 갈아 끼운다.
--                                                 **행을 만들지 못한다** — AIAgent가 없는 연결을
--                                                 되살릴 수는 없다. 연결은 사람이 한다.
--     kakao_token_clear()      Chairman           연결 해제.
--
--   왜 AIAgent에게 for_send를 주는가 — 야간 Job은 매일 07:00 KST에 사람 없이 cron으로 돈다.
--   빌려 올 회장 세션이 없다(0019 P5-5d 1라운드 수정에서 같은 결론에 도달했다).
--
-- 왜 refresh와 save를 나누는가
--   두 경로의 권한이 다르다. 연결은 회장이 브라우저에서 카카오에 로그인해야 생긴다.
--   갱신은 Job이 사람 없이 해야 한다. 한 함수로 합치면 AIAgent에게 '행 만들기'까지 주게 되고,
--   그러면 Job 쪽 버그 하나가 회장이 끊어 둔 연결을 되살릴 수 있다.
--
-- 왜 행이 하나뿐인가
--   user_id가 기본키지만 실제로는 늘 한 행이다 — 행을 만들 수 있는 역할이 Chairman뿐이고
--   Chairman은 한 사람이다. kakao_token_refreshed()가 대상 행을 user_id로 찾지 않고 표 전체를
--   갱신하는 것은 그래서다(AIAgent는 그 행이 누구 것인지 알 필요가 없고, 알아서도 안 된다).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 어휘
--    이 트랜잭션 안에서는 새 값을 리터럴로 쓸 수 없다(55P04). 실제 사용은 런타임
--    TypeScript(lib/kakao/send-brief.ts)에서만 한다 — 이 파일 안에는 등장하지 않는다.
-- ---------------------------------------------------------------------
alter type audit_action add value if not exists 'kakao_sent';
alter type audit_action add value if not exists 'kakao_failed';

-- ---------------------------------------------------------------------
-- 2. 표
-- ---------------------------------------------------------------------
create table chairman_kakao_token (
  user_id            uuid primary key references auth.users(id) on delete cascade, -- [Vault] 연결한 사람
  access_token       text        not null,                  -- [Vault] bearer 자격증명. 절대 화면으로 나가지 않는다
  refresh_token      text        not null,                  -- [Vault] 같은 등급
  expires_at         timestamptz not null,                  -- [일반] access_token 만료 시각
  refresh_expires_at timestamptz not null,                  -- [일반] 지나면 사람이 다시 연결해야 한다
  scopes             text        not null default '',       -- [일반] 카카오가 실제로 준 동의항목(공백 구분)
  updated_at         timestamptz not null default now()     -- [일반]
);

comment on table chairman_kakao_token is
  'Phase 3-C. 회장 카카오 OAuth 토큰. 외부 계정의 bearer 자격증명이라 0019 chairman_checkins보다 한 단계 더 좁다 — Chairman에게도 표를 직접 열지 않고, security definer 함수 네 개만 문이다.';
comment on column chairman_kakao_token.access_token is
  '[Vault] 이 값을 select 하는 코드는 kakao_token_for_send()뿐이어야 한다. 화면·로그·모델 프롬프트 어디에도 나가지 않는다.';
comment on column chairman_kakao_token.scopes is
  '카카오 토큰 응답의 scope. talk_message가 없으면 연결은 됐어도 발송은 -402로 거절된다 — 화면이 그때 "다시 연결"을 띄운다.';

create trigger chairman_kakao_token_updated_at before update on chairman_kakao_token
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. 자물쇠 두 겹
--
--    ① grant를 걷는다. 이것이 실제로 표를 닫는다 — security definer 함수는 소유자 권한으로
--       돌아서 이 revoke에 걸리지 않는다.
--    ② 그래도 RLS를 켜고 Chairman 정책을 남긴다. 나중에 누가 grant를 되살리는 날
--       (Supabase의 alter default privileges, 또는 검사 스크립트의 일괄 grant) 이 층이 남는다.
--       0019가 keyhole 함수에 revoke를 걸고도 표의 RLS를 그대로 둔 것과 같은 이유다.
-- ---------------------------------------------------------------------
revoke all on table chairman_kakao_token from anon, authenticated;

alter table chairman_kakao_token enable row level security;
alter table chairman_kakao_token force  row level security;

create policy chairman_kakao_token_all on chairman_kakao_token for all
  using (is_active() and auth_role() = 'Chairman')
  with check (is_active() and auth_role() = 'Chairman' and user_id = auth.uid());

do $$
begin
  execute format(
    'create policy integration_no_insert on public.%I as restrictive for insert
       with check (not is_integration())', 'chairman_kakao_token');
  execute format(
    'create policy integration_no_update on public.%I as restrictive for update
       using (not is_integration()) with check (not is_integration())', 'chairman_kakao_token');
  execute format(
    'create policy integration_no_delete on public.%I as restrictive for delete
       using (not is_integration()) with check (not is_integration())', 'chairman_kakao_token');
end
$$;

-- ---------------------------------------------------------------------
-- 4. 문 네 개
--    전부 예외를 던지지 않는다. 역할이 맞지 않으면 조용히 0행 / null이다 —
--    '없는 것'과 '못 읽는 것'을 구분하지 않는 이 저장소의 계약을 그대로 따른다.
-- ---------------------------------------------------------------------

-- 4-1. 화면용. 토큰 값이 반환 목록에 아예 없다.
create or replace function kakao_token_status()
returns table (connected boolean, scopes text, expires_at timestamptz,
               refresh_expires_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select true, t.scopes, t.expires_at, t.refresh_expires_at, t.updated_at
    from chairman_kakao_token t
   where is_active() and auth_role() = 'Chairman';
$fn$;

comment on function kakao_token_status() is
  '0023. /settings/chairman이 "연결됨/다시 연결"을 그리는 데 쓰는 유일한 값. access_token·refresh_token은 반환 목록에 없다 — 반환하지 않은 값은 HTML로도 새어 나갈 수 없다.';

-- 4-2. 발송용. 유일하게 토큰 값을 내주는 자리다.
create or replace function kakao_token_for_send()
returns table (user_id uuid, access_token text, refresh_token text,
               expires_at timestamptz, refresh_expires_at timestamptz, scopes text)
language sql stable security definer set search_path = public as $fn$
  select t.user_id, t.access_token, t.refresh_token, t.expires_at, t.refresh_expires_at, t.scopes
    from chairman_kakao_token t
   where is_active() and auth_role() in ('Chairman', 'AIAgent');
$fn$;

comment on function kakao_token_for_send() is
  '0023. 토큰 값을 내주는 유일한 함수. AIAgent에게도 주는 이유는 야간 Job이 07:00 KST에 사람 없이 돌기 때문이다(0019 chairman_today_condition()과 같은 사정).';

-- 4-3. 연결/재연결. Chairman만. 행을 만든다.
create or replace function kakao_token_save(
  p_access text, p_refresh text, p_expires timestamptz,
  p_refresh_expires timestamptz, p_scopes text
) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (is_active() and auth_role() = 'Chairman') then
    return false;
  end if;
  insert into chairman_kakao_token
    (user_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes)
  values (auth.uid(), p_access, p_refresh, p_expires, p_refresh_expires, coalesce(p_scopes, ''))
  on conflict (user_id) do update set
    access_token       = excluded.access_token,
    refresh_token      = excluded.refresh_token,
    expires_at         = excluded.expires_at,
    refresh_expires_at = excluded.refresh_expires_at,
    scopes             = excluded.scopes;
  return true;
end;
$fn$;

comment on function kakao_token_save is
  '0023. 카카오 연결/재연결. Chairman만, 자기 user_id로만. 실패를 예외가 아니라 false로 돌려준다 — 호출부(/api/kakao/callback)가 사람에게 보여 줄 문구를 스스로 고르게 한다.';

-- 4-4. 갱신. Chairman + AIAgent. **행을 만들지 못한다.**
create or replace function kakao_token_refreshed(
  p_access text, p_expires timestamptz,
  p_refresh text, p_refresh_expires timestamptz
) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  n integer;
begin
  if not (is_active() and auth_role() in ('Chairman', 'AIAgent')) then
    return false;
  end if;
  -- 행은 늘 하나다(머리 주석). 그래서 누구 것인지 묻지 않고 그 하나를 갱신한다.
  -- 카카오는 refresh_token을 '만료 한 달 미만'일 때만 새로 준다. 안 준 회차에는
  -- 기존 값을 그대로 둬야 한다 — null로 덮으면 not null 제약에 걸리기 전에 연결이 끊긴다.
  update chairman_kakao_token set
    access_token       = p_access,
    expires_at         = p_expires,
    refresh_token      = coalesce(p_refresh, refresh_token),
    refresh_expires_at = coalesce(p_refresh_expires, refresh_expires_at);
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

comment on function kakao_token_refreshed is
  '0023. refresh_token 교환 결과를 되쓴다. insert 경로가 없는 것이 요점이다 — 연결은 사람이 브라우저에서 하는 일이고, Job은 이미 있는 연결을 잇기만 한다.';

-- 4-5. 해제. Chairman만.
create or replace function kakao_token_clear() returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (is_active() and auth_role() = 'Chairman') then
    return false;
  end if;
  delete from chairman_kakao_token;
  return true;
end;
$fn$;

comment on function kakao_token_clear() is
  '0023. 연결 해제. 카카오 쪽 연결(unlink)까지 끊지는 않는다 — 우리가 가진 토큰을 버릴 뿐이다.';

-- 0019와 같은 이유로 public 기본 execute 권한을 먼저 걷고 필요한 역할에만 다시 준다.
revoke all on function kakao_token_status()      from public;
revoke all on function kakao_token_for_send()    from public;
revoke all on function kakao_token_save(text, text, timestamptz, timestamptz, text) from public;
revoke all on function kakao_token_refreshed(text, timestamptz, text, timestamptz)  from public;
revoke all on function kakao_token_clear()       from public;

grant execute on function kakao_token_status()      to authenticated;
grant execute on function kakao_token_for_send()    to authenticated;
grant execute on function kakao_token_save(text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function kakao_token_refreshed(text, timestamptz, text, timestamptz)  to authenticated;
grant execute on function kakao_token_clear()       to authenticated;

-- ---------------------------------------------------------------------
-- 5. 컨디션 keyhole을 하루 넓힌다 (cron이 23:00 → 07:00로 옮겨 간 결과)
--
--    0019 chairman_today_condition()은 23:00 KST에 도는 Job을 위한 함수였다. 그 시각이면
--    회장은 이미 아침 체크인을 했다. 07:00으로 옮기면 거의 매일 체크인 **전**이라 그 함수는
--    늘 null을 준다 — 브리핑에서 컨디션 문장이 통째로 사라진다.
--
--    그래서 '오늘 아니면 어제'까지 본다. 이틀을 넘기지 않는 이유: 사흘 전 컨디션으로
--    "오늘은 큰 결정을 미루라"고 말하는 것은 근거가 아니라 추측이다.
--    checkin_date를 같이 돌려주는 것은 화면과 모델이 **어제 값임을 알고 말하게** 하기 위해서다.
--
--    0019의 함수는 아무도 부르지 않게 되므로 지운다. 이 저장소는 배선만 되고 실제로는
--    안 켜지는 코드를 남기지 않는다(P5-5d 2라운드에서 listRecentCheckins를 지운 전례).
-- ---------------------------------------------------------------------
create or replace function chairman_recent_condition()
returns table (condition smallint, checkin_date date)
language sql stable security definer set search_path = public as $fn$
  select c.condition, c.checkin_date
    from chairman_checkins c
   where c.checkin_date >= (now() at time zone 'Asia/Seoul')::date - 1
     and c.checkin_date <= (now() at time zone 'Asia/Seoul')::date
     and is_active()
     and auth_role() in ('Chairman', 'AIAgent')
   order by c.checkin_date desc
   limit 1;
$fn$;

comment on function chairman_recent_condition() is
  '0023. 0019 chairman_today_condition()을 대체한다. 야간 Job이 07:00 KST로 옮겨 가 체크인보다 먼저 도는 날이 기본이 됐다 — 오늘 행이 없으면 어제 것을 주고, 어느 날 값인지 같이 준다. sleep_hours·weight_kg·meal_note는 여기서도 반환값에 없다.';

revoke all on function chairman_recent_condition() from public;
grant execute on function chairman_recent_condition() to authenticated;

drop function if exists chairman_today_condition();

commit;
```

- [ ] **Step 2: 마이그레이션이 적용되는지 본다 (실패를 먼저 확인한다)**

Run: `npm run check:migrations`

Expected: PASS. 0023이 적용되고 기존 검사가 전부 통과한다.
**여기서 실패하면** 이 Task를 벗어나지 않는다 — 특히 `55P04 unsafe use of new value`가 나면 1절의 enum 값을 같은 파일 안에서 리터럴로 쓴 자리가 있다는 뜻이다.

- [ ] **Step 3: 실패하는 RLS 검사를 쓴다**

`scripts/check-migrations.ts`의 `rls()` 함수 **맨 끝**(마지막 `assert.equal(await as(UID.chairman, ... '(검사 준비) Chairman에게는 보인다')` 줄 바로 아래)에 붙인다:

```ts
  // ── 0023 chairman_kakao_token — 표는 아무에게도 안 열린다 ────────────────
  //
  // 0019와 다른 검사다. 저기서는 "Chairman은 되고 나머지는 안 된다"를 쟀다.
  // 여기서는 **Chairman도 안 된다**를 잰다 — 문은 함수 네 개뿐이라는 것이 이 표의 계약이다.
  //
  // 주의: 이 스크립트는 rls() 첫머리에서 authenticated에게 모든 표의 grant를 통째로 준다.
  // 0023의 revoke는 그 grant보다 먼저 돌았으므로 여기서 다시 걷어야 실제 배포와 같은 상태가 된다.
  // (실제 Supabase에서는 alter default privileges가 같은 일을 하고, 0023의 revoke가 최종 상태다.)
  await db.exec('revoke all on table chairman_kakao_token from authenticated')

  const kakaoRow = `insert into chairman_kakao_token
      (user_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes)
    values ('${UID.chairman}', 'AT', 'RT', now() + interval '6 hours', now() + interval '60 days', 'talk_message')`

  // 표 직접 접근 — 역할 불문 전부 막힌다. grant가 없으면 RLS 이전에 42501로 거절된다.
  for (const [who, uid] of [['Chairman', UID.chairman], ['AIAgent', UID.agent], ['GroupCFO', UID.cfo]] as const) {
    await assert.rejects(
      as(uid, 'select count(*)::int from chairman_kakao_token'),
      /permission denied|row-level security/,
      `0023: ${who}가 chairman_kakao_token을 직접 읽는다 (문은 함수뿐이어야 한다)`,
    )
  }

  /**
   * 함수 호출 전용 헬퍼. as()를 그대로 못 쓰는 이유는 condition()과 같다 —
   * 이 함수들은 예외를 던지지 않고 0행이나 false로 돌아온다.
   * as()는 0행을 affectedRows 0으로, false를 Number(false) === 0으로 뭉개 버려
   * '거부됨'과 '진짜 없음'을 구분하지 못한다.
   */
  async function rpc<T>(uid: string, sql: string, setup = ''): Promise<T[]> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      if (setup) await db.exec(setup)
      const res = await db.query<T>(sql)
      return res.rows
    } finally {
      await db.exec('rollback')
    }
  }

  // 아직 연결이 없다 — status는 누구에게도 행을 주지 않는다.
  assert.equal(
    (await rpc(UID.chairman, 'select * from kakao_token_status()')).length, 0,
    '0023: 연결이 없는데 kakao_token_status()가 행을 준다',
  )

  // Chairman만 연결을 만든다.
  assert.equal(
    (await rpc<{ kakao_token_save: boolean }>(UID.chairman,
      `select kakao_token_save('AT', 'RT', now() + interval '6 hours', now() + interval '60 days', 'talk_message')`,
    ))[0].kakao_token_save, true,
    '0023: Chairman이 카카오 연결을 저장하지 못한다',
  )
  for (const [who, uid] of [['AIAgent', UID.agent], ['GroupCFO', UID.cfo], ['Member', UID.member]] as const) {
    assert.equal(
      (await rpc<{ kakao_token_save: boolean }>(uid,
        `select kakao_token_save('X', 'X', now(), now(), 'talk_message')`,
      ))[0].kakao_token_save, false,
      `0023: ${who}가 카카오 연결을 만들 수 있다`,
    )
  }

  // 연결이 있는 상태에서: status는 Chairman만, 그리고 토큰 값은 반환 목록에 아예 없다.
  const statusRows = await rpc<Record<string, unknown>>(UID.chairman, 'select * from kakao_token_status()', kakaoRow)
  assert.equal(statusRows.length, 1, '0023: Chairman이 kakao_token_status()를 못 받는다')
  assert.ok(!('access_token' in statusRows[0]), '0023: kakao_token_status()가 access_token을 내보낸다')
  assert.ok(!('refresh_token' in statusRows[0]), '0023: kakao_token_status()가 refresh_token을 내보낸다')
  for (const [who, uid] of [['AIAgent', UID.agent], ['GroupCFO', UID.cfo], ['Member', UID.member]] as const) {
    assert.equal(
      (await rpc(uid, 'select * from kakao_token_status()', kakaoRow)).length, 0,
      `0023: ${who}에게 kakao_token_status()가 보인다`,
    )
  }

  // for_send — Chairman과 AIAgent만.
  for (const [who, uid] of [['Chairman', UID.chairman], ['AIAgent', UID.agent]] as const) {
    const rows = await rpc<{ access_token: string }>(uid, 'select * from kakao_token_for_send()', kakaoRow)
    assert.equal(rows[0]?.access_token, 'AT', `0023: ${who}가 kakao_token_for_send()로 토큰을 못 받는다`)
  }
  for (const [who, uid] of [['GroupCFO', UID.cfo], ['Member', UID.member], ['Integration', UID.integration], ['BusinessCEO', UID.ceo]] as const) {
    assert.equal(
      (await rpc(uid, 'select * from kakao_token_for_send()', kakaoRow)).length, 0,
      `0023: ${who}에게 카카오 토큰이 보인다`,
    )
  }

  // refreshed — AIAgent는 **있는 행만** 갱신한다. 없는 연결을 되살리지는 못한다.
  assert.equal(
    (await rpc<{ kakao_token_refreshed: boolean }>(UID.agent,
      `select kakao_token_refreshed('AT2', now() + interval '6 hours', null, null)`, kakaoRow,
    ))[0].kakao_token_refreshed, true,
    '0023: AIAgent가 토큰을 갱신하지 못한다',
  )
  assert.equal(
    (await rpc<{ kakao_token_refreshed: boolean }>(UID.agent,
      `select kakao_token_refreshed('AT2', now() + interval '6 hours', null, null)`,
    ))[0].kakao_token_refreshed, false,
    '0023: AIAgent가 없는 연결을 만들어 낸다 (행이 없으면 false여야 한다)',
  )
  assert.equal(
    (await rpc<{ kakao_token_refreshed: boolean }>(UID.cfo,
      `select kakao_token_refreshed('AT2', now(), null, null)`, kakaoRow,
    ))[0].kakao_token_refreshed, false,
    '0023: GroupCFO가 토큰을 갱신할 수 있다',
  )
  // 카카오가 refresh_token을 안 준 회차(null)에 기존 값이 지워지지 않는가.
  assert.equal(
    (await rpc<{ refresh_token: string }>(UID.agent,
      `select refresh_token from kakao_token_for_send()`,
      `${kakaoRow}; select kakao_token_refreshed('AT2', now() + interval '6 hours', null, null)`,
    ))[0].refresh_token, 'RT',
    '0023: refresh_token을 안 준 갱신이 기존 refresh_token을 지운다',
  )

  // clear — Chairman만.
  assert.equal(
    (await rpc<{ kakao_token_clear: boolean }>(UID.agent, 'select kakao_token_clear()', kakaoRow))[0].kakao_token_clear,
    false, '0023: AIAgent가 연결을 해제할 수 있다',
  )
  assert.equal(
    (await rpc<{ kakao_token_clear: boolean }>(UID.chairman, 'select kakao_token_clear()', kakaoRow))[0].kakao_token_clear,
    true, '0023: Chairman이 연결을 해제하지 못한다',
  )

  // ── 0023 chairman_recent_condition() — 오늘이 없으면 어제 ─────────────────
  const today = kstToday()
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const twoDaysAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10)
  const recent = (uid: string, setup: string) =>
    rpc<{ condition: number; checkin_date: string }>(uid, 'select * from chairman_recent_condition()', setup)

  const ci = (d: string, c: number) => `insert into chairman_checkins (checkin_date, condition) values ('${d}', ${c})`

  assert.equal((await recent(UID.agent, ci(twoDaysAgo, 2))).length, 0,
    '0023: chairman_recent_condition()이 그저께 값을 준다 (이틀을 넘기면 안 된다)')

  let r = await recent(UID.agent, ci(yesterday, 3))
  assert.equal(r[0]?.condition, 3, '0023: 오늘 체크인이 없을 때 어제 값을 못 받는다')
  assert.equal(r[0]?.checkin_date, yesterday, '0023: 어제 값인데 checkin_date가 어제가 아니다')

  r = await recent(UID.agent, `${ci(yesterday, 3)}; ${ci(today, 5)}`)
  assert.equal(r[0]?.condition, 5, '0023: 오늘 체크인이 있는데 어제 값을 준다')
  assert.equal(r[0]?.checkin_date, today, '0023: 오늘 값인데 checkin_date가 오늘이 아니다')

  for (const [who, uid] of [['GroupCFO', UID.cfo], ['Member', UID.member]] as const) {
    assert.equal((await recent(uid, ci(today, 5))).length, 0,
      `0023: ${who}에게 chairman_recent_condition()이 값을 준다`)
  }
```

- [ ] **Step 4: 검사가 도는지 확인한다**

Run: `npm run check:migrations`

Expected: PASS. 실패하면 메시지가 어느 계약이 깨졌는지 그대로 말한다.

`chairman_today_condition`을 지웠으므로 스크립트에 남아 있는 0019 keyhole 검사(`condition()` 헬퍼와 그 assert 4줄, 617~633행 근처)도 같이 지운다 — 없는 함수를 부르면 스크립트가 터진다. `condition()` 헬퍼 자체도 쓰는 곳이 없어지므로 지운다.

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0023_chairman_kakao_token.sql scripts/check-migrations.ts
git commit -m "feat(kakao): 0023 — 카카오 토큰 표와 네 개의 문

표는 아무도 직접 읽지 못한다. Chairman에게도 열지 않는다 — 담긴 것이
건강 기록이 아니라 외부 계정의 bearer 자격증명이라서다(0019보다 한 단계 좁다).
야간 Job이 07:00으로 옮겨 가 체크인보다 먼저 도므로 컨디션 keyhole도
'오늘 아니면 어제'까지 넓힌다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 메시지 문자열 — 순수 함수와 그 검사

이 Task를 먼저 하는 이유: 200자 자르기가 이 기능에서 **유일하게 논리가 있는 부분**이고, 카카오도 DB도 없이 혼자 검사할 수 있다.

**Files:**
- Create: `src/types/kakao.ts`
- Create: `src/lib/kakao/message.ts` (이 Task에서는 `buildKakaoBriefText()`만)
- Create: `scripts/check-kakao.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildKakaoBriefText(input: BriefTextInput): string`, `KAKAO_TEXT_LIMIT = 200`, 타입 `KakaoConnection`

- [ ] **Step 1: 실패하는 검사를 쓴다**

`scripts/check-kakao.ts`:

```ts
/**
 * 카카오 메시지 문자열 검사 — npm run check:kakao
 *
 * 재는 것은 buildKakaoBriefText() 하나다. 카카오도 DB도 부르지 않는다.
 * 이 함수가 이 기능에서 유일하게 논리가 있는 자리라서다 — 200자를 넘기면 카카오가
 * 통째로 거절하고, 그 실패는 아침 07:00에 사람 없이 일어난다.
 */
import assert from 'node:assert/strict'

import { buildKakaoBriefText, KAKAO_TEXT_LIMIT } from '../src/lib/kakao/message'

const LONG =
  '첫 문장은 어제 마감 기준 그룹 전체 매출이 전월 대비 늘었다는 것이다. ' +
  '두 번째 문장은 VANA의 원가 드라이버가 전기료 쪽으로 옮겨 갔다는 관찰이다. ' +
  '세 번째 문장은 스티키의 결정 건이 마감을 사흘 남겼다는 사실이다. ' +
  '네 번째 문장은 보람의 알림이 아직 열려 있다는 것이고, 다섯 번째 문장은 호프의 업무가 막혀 있다는 것이다.'

function len(s: string): number {
  return [...s].length
}

// 1. 머리글 — D-day와 프로젝트 제목이 한 줄에 온다.
{
  const text = buildKakaoBriefText({
    dDay: 'D-780',
    projectTitle: '회장직 승계',
    summary: '오늘은 조용하다.',
  })
  assert.ok(text.startsWith('☀️ D-780 · 회장직 승계\n\n'), `머리글이 다르다: ${JSON.stringify(text)}`)
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), `꼬리가 다르다: ${JSON.stringify(text)}`)
  assert.ok(text.includes('오늘은 조용하다.'), '요약이 빠졌다')
}

// 2. 진행 중인 장기 프로젝트가 없으면 D-day 자리를 비운다 — 'D-null'을 만들지 않는다.
{
  const text = buildKakaoBriefText({ dDay: null, projectTitle: null, summary: '오늘은 조용하다.' })
  assert.ok(text.startsWith('☀️ 오늘의 브리핑\n\n'), `프로젝트 없을 때 머리글이 다르다: ${JSON.stringify(text)}`)
  assert.ok(!text.includes('null'), 'null이 문자열로 샜다')
}

// 3. 200자를 절대 넘지 않는다. 카카오 텍스트 템플릿의 한계다.
{
  const text = buildKakaoBriefText({ dDay: 'D-780', projectTitle: '회장직 승계', summary: LONG })
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT, `${len(text)}자 — 200자를 넘었다`)
  assert.ok(text.startsWith('☀️ D-780 · 회장직 승계\n\n'), '자르다가 머리글을 잃었다')
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '자르다가 꼬리를 잃었다')
}

// 4. 문장 단위로 자른다 — 들어갈 만큼만 넣되 최소 한 문장은 산다.
{
  const text = buildKakaoBriefText({ dDay: 'D-780', projectTitle: '회장직 승계', summary: LONG })
  assert.ok(text.includes('첫 문장은'), '첫 문장이 통째로 사라졌다')
  assert.ok(!text.includes('다섯 번째 문장은'), '200자 안에 다섯 문장이 들어갈 리 없다')
}

// 5. 세 문장을 넘기지 않는다 — 짧아서 들어가더라도.
{
  const text = buildKakaoBriefText({
    dDay: 'D-1', projectTitle: 'A',
    summary: '하나. 둘. 셋. 넷.',
  })
  assert.ok(text.includes('셋.'), '세 문장은 들어가야 한다')
  assert.ok(!text.includes('넷.'), '네 번째 문장까지 넣었다')
}

// 6. 머리글만으로 이미 긴 제목 — 요약이 한 글자도 안 들어가도 터지지 않는다.
{
  const text = buildKakaoBriefText({
    dDay: 'D-9999', projectTitle: '가'.repeat(180), summary: LONG,
  })
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT, `${len(text)}자 — 긴 제목에서 200자를 넘었다`)
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '긴 제목에서 꼬리를 잃었다')
}

// 7. 요약이 비어도 보낼 것이 남는다 — 링크를 여는 것이 이 메시지의 목적이다.
{
  const text = buildKakaoBriefText({ dDay: 'D-3', projectTitle: 'A', summary: '   ' })
  assert.ok(text.includes('요약을 만들지 못했습니다'), `빈 요약 문구가 다르다: ${JSON.stringify(text)}`)
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT)
}

console.log('PASS: buildKakaoBriefText — 머리글 · 200자 · 문장 자르기 · 빈 요약')
```

`package.json`의 `scripts`에 `check:process-charts` 아래로 한 줄 넣는다:

```json
    "check:kakao": "tsx scripts/check-kakao.ts",
```

- [ ] **Step 2: 검사가 실패하는지 확인한다**

Run: `npm run check:kakao`

Expected: FAIL — `Cannot find module '../src/lib/kakao/message'`

- [ ] **Step 3: 타입을 만든다**

`src/types/kakao.ts`:

```ts
import type { IsoDateTime } from './primitives'

/**
 * Phase 3-C 카톡 아침 알림 (0023_chairman_kakao_token).
 *
 * 토큰 값 자체를 담는 타입은 여기 두지 않는다. 화면 코드가 import 할 수 있는 자리에
 * access_token 칸이 있는 타입을 두면, 언젠가 누가 그 타입을 props로 넘긴다.
 * 토큰 한 벌의 모양은 서버 전용 모듈(src/lib/kakao/token.ts)에만 산다.
 */

/** 0023 kakao_token_status()가 내주는 전부. 화면이 "연결됨 / 다시 연결"을 이 값으로만 고른다. */
export interface KakaoConnection {
  connected: true
  /** 카카오가 실제로 준 동의항목(공백 구분). talk_message가 없으면 발송이 -402로 거절된다. */
  scopes: string
  expires_at: IsoDateTime
  refresh_expires_at: IsoDateTime
  updated_at: IsoDateTime
}
```

`src/types/index.ts`에 재수출을 한 줄 더한다 (기존 `export * from './checkin'` 등과 같은 자리, 알파벳 순서를 지킨다):

```ts
export * from './kakao'
```

- [ ] **Step 4: 순수 함수를 만든다**

`src/lib/kakao/message.ts` (이 Task에서는 이 파일의 앞부분만; `sendKakaoMemo()`는 Task 4에서 같은 파일에 덧붙인다):

```ts
/**
 * 카카오톡 '나에게 보내기'로 나가는 문자열 (Phase 3-C).
 *
 * 카카오 텍스트 템플릿의 text는 200자다. 넘으면 카카오가 메시지를 통째로 거절한다 —
 * 그 실패는 아침 07:00에 사람 없이 일어나므로, 자르는 책임을 여기서 끝낸다.
 *
 * 이 파일의 buildKakaoBriefText()는 순수 함수다. 네트워크도 시계도 건드리지 않는다.
 * scripts/check-kakao.ts가 그 덕에 카카오 계정 없이 이 로직 전부를 잰다.
 */

/** 카카오 text 템플릿의 text 한계. 카카오가 세는 단위는 코드포인트다. */
export const KAKAO_TEXT_LIMIT = 200

/** 요약에서 끌어올 문장 수. 이보다 길면 알림이 아니라 본문이 된다. */
const MAX_SENTENCES = 3

const HEAD_FALLBACK = '☀️ 오늘의 브리핑'
const TAIL = '▶ 전문 보기'
const EMPTY_SUMMARY = '요약을 만들지 못했습니다. 전문에서 확인하세요.'

export interface BriefTextInput {
  /** 'D-780' / 'D-DAY' / 'D+3'. 진행 중인 장기 프로젝트가 없으면 null. */
  dDay: string | null
  /** 그 프로젝트의 제목. dDay가 null이면 같이 null이다. */
  projectTitle: string | null
  /** 그룹 브리핑 summary 전문. 여기서 앞 2~3문장만 뽑아 쓴다. */
  summary: string
}

/** 코드포인트 기준 길이. '☀️'처럼 surrogate pair인 글자를 2로 세지 않는다. */
function len(s: string): number {
  return [...s].length
}

/** 코드포인트 기준 자르기. 문자 중간에서 끊어 깨진 글자를 만들지 않는다. */
function cut(s: string, max: number): string {
  const cp = [...s]
  return cp.length <= max ? s : cp.slice(0, max).join('')
}

/**
 * 한국어 문장 끝에서 자른다. '다.', '요.', '!', '?'가 경계다.
 * 소수점("2.8억")에서 끊기지 않게 마침표 뒤에 공백이나 끝이 오는 자리만 경계로 본다.
 */
function sentences(summary: string): string[] {
  return summary
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])(?=\s)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function buildKakaoBriefText(input: BriefTextInput): string {
  const head =
    input.dDay && input.projectTitle ? `☀️ ${input.dDay} · ${input.projectTitle}` : HEAD_FALLBACK

  // 머리글과 꼬리를 먼저 확보한다. 본문이 밀려나더라도 '무슨 날이고 어디를 열면 되는가'는 남는다.
  // 긴 제목 하나로 200자를 다 먹는 경우가 있어 머리글도 자른다.
  // SCAFFOLD는 줄바꿈 넷('\n\n' 두 번)과 꼬리가 차지하는 고정 비용이다.
  const SCAFFOLD = len(`\n\n\n\n${TAIL}`)
  const safeHead = cut(head, Math.max(0, KAKAO_TEXT_LIMIT - SCAFFOLD))
  const budget = KAKAO_TEXT_LIMIT - SCAFFOLD - len(safeHead)

  const parts = sentences(input.summary)
  let body = ''
  if (parts.length === 0) {
    // 요약이 비어도 보낸다. 이 메시지의 목적은 요약이 아니라 /ai를 여는 것이다.
    body = cut(EMPTY_SUMMARY, budget)
  } else {
    for (const s of parts.slice(0, MAX_SENTENCES)) {
      const next = body ? `${body} ${s}` : s
      if (len(next) > budget) break
      body = next
    }
    // 첫 문장조차 예산을 넘으면 그 문장을 잘라서라도 넣는다. 빈 본문보다는 반 문장이 낫다.
    if (!body) body = budget > 1 ? `${cut(parts[0], budget - 1)}…` : ''
  }

  return body ? `${safeHead}\n\n${body}\n\n${TAIL}` : `${safeHead}\n\n${TAIL}`
}
```

- [ ] **Step 5: 검사가 통과하는지 확인한다**

Run: `npm run check:kakao`

Expected: `PASS: buildKakaoBriefText — 머리글 · 200자 · 문장 자르기 · 빈 요약`

- [ ] **Step 6: 타입과 린트**

Run: `npm run typecheck && npm run lint`

Expected: 둘 다 통과.

- [ ] **Step 7: 커밋**

```bash
git add src/types/kakao.ts src/types/index.ts src/lib/kakao/message.ts scripts/check-kakao.ts package.json
git commit -m "feat(kakao): 메시지 문자열과 200자 자르기

카카오 텍스트 템플릿은 200자를 넘으면 메시지를 통째로 거절한다. 그 실패는
아침 07:00에 사람 없이 일어나므로 순수 함수로 떼어 내고 npm run check:kakao로 잰다.
머리글과 '전문 보기'를 먼저 확보한다 — 본문이 밀려나도 어디를 열면 되는지는 남아야 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 카카오 설정과 토큰 교환

**Files:**
- Create: `src/lib/kakao/config.ts`
- Create: `src/lib/kakao/token.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `signInServiceAccount` 없음 — 이 Task는 Supabase를 모른다. 카카오 HTTP만 안다.
- Produces:
  - `requireKakaoConfig(): KakaoConfig` — `{ restApiKey, clientSecret, redirectUri, appBaseUrl }`
  - `authorizeUrl(state: string): string`
  - `exchangeCode(code: string): Promise<KakaoTokenSet>`
  - `refreshTokens(refreshToken: string): Promise<KakaoRefreshResult>`
  - `KakaoTokenSet = { accessToken, refreshToken, expiresAt, refreshExpiresAt, scopes }` (`expiresAt`/`refreshExpiresAt`은 ISO 문자열)
  - `KakaoRefreshResult = { accessToken, expiresAt, refreshToken: string | null, refreshExpiresAt: string | null }`
  - `TALK_MESSAGE_SCOPE = 'talk_message'`

- [ ] **Step 1: 설정을 읽는 자리를 만든다**

`src/lib/kakao/config.ts`:

```ts
import 'server-only'

/**
 * 카카오 연동 환경변수를 읽는 유일한 자리 (Phase 3-C).
 *
 * 전부 서버 전용이다 — NEXT_PUBLIC_을 붙이지 않는다. 붙이는 순간 REST API 키가
 * 빌드 산출물에 박혀 브라우저로 나간다.
 *
 * redirect_uri를 요청 호스트에서 유도하지 않고 환경변수로 박는 이유:
 * 카카오 콘솔에 등록된 리다이렉트 URI는 고정된 두 개뿐인데(production과 localhost),
 * Vercel Preview는 배포마다 호스트가 바뀐다. 유도하면 Preview에서 매번 KOE006이 난다.
 * 틀린 값으로 조용히 도는 것보다 없을 때 던지는 쪽이 낫다.
 */

export interface KakaoConfig {
  restApiKey: string
  /** 카카오 콘솔에서 Client Secret을 '사용함'으로 켰을 때만. 안 켰으면 빈 문자열. */
  clientSecret: string
  /** 카카오 콘솔에 등록된 것과 **한 글자도 다르지 않아야** 한다. */
  redirectUri: string
  /** 카톡 메시지 안의 '전문 보기'가 가리킬 곳. 끝에 / 를 붙이지 않는다. */
  appBaseUrl: string
}

export function kakaoConfig(): KakaoConfig | null {
  const restApiKey = process.env.KAKAO_REST_API_KEY
  const redirectUri = process.env.KAKAO_REDIRECT_URI
  const appBaseUrl = process.env.APP_BASE_URL
  if (!restApiKey || !redirectUri || !appBaseUrl) return null
  return {
    restApiKey,
    clientSecret: process.env.KAKAO_CLIENT_SECRET ?? '',
    redirectUri,
    appBaseUrl: appBaseUrl.replace(/\/+$/, ''),
  }
}

export function requireKakaoConfig(): KakaoConfig {
  const c = kakaoConfig()
  if (!c) {
    throw new Error(
      'KAKAO_REST_API_KEY / KAKAO_REDIRECT_URI / APP_BASE_URL 중 빠진 것이 있다. ' +
        '.env.local 또는 Vercel 환경변수를 확인한다(docs/OPERATIONS.md 1절).',
    )
  }
  return c
}
```

- [ ] **Step 2: 토큰 교환을 만든다**

`src/lib/kakao/token.ts`:

```ts
import 'server-only'

import { requireKakaoConfig } from './config'

/**
 * 카카오 OAuth 토큰 교환 (Phase 3-C).
 *
 * 이 파일은 Supabase를 모른다. 카카오와 HTTP로 말하는 일만 한다 —
 * 저장은 lib/kakao/send-brief.ts와 /api/kakao/callback이 0023의 함수로 한다.
 * 둘을 갈라 둔 덕에 '카카오가 뭘 돌려주나'와 '우리가 그걸 어디에 넣나'를 따로 고칠 수 있다.
 *
 * 카카오 문서: https://developers.kakao.com/docs/latest/ko/kakaologin/rest-api
 */

const AUTHORIZE = 'https://kauth.kakao.com/oauth/authorize'
const TOKEN = 'https://kauth.kakao.com/oauth/token'

/** 선택 동의항목. 이것이 없으면 로그인은 되고 발송만 -402로 거절된다. */
export const TALK_MESSAGE_SCOPE = 'talk_message'

export interface KakaoTokenSet {
  accessToken: string
  refreshToken: string
  /** ISO 8601 */
  expiresAt: string
  refreshExpiresAt: string
  /** 카카오가 실제로 준 동의항목. 공백 구분. */
  scopes: string
}

export interface KakaoRefreshResult {
  accessToken: string
  expiresAt: string
  /** 카카오는 만료가 한 달 미만일 때만 새 refresh_token을 준다. 안 준 회차는 null이다. */
  refreshToken: string | null
  refreshExpiresAt: string | null
}

interface KakaoTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

function at(seconds: number | undefined, fallbackSeconds: number): string {
  return new Date(Date.now() + (seconds ?? fallbackSeconds) * 1000).toISOString()
}

/** 카카오 로그인 화면 주소. state는 호출부가 만들어 쿠키에도 심는다(CSRF). */
export function authorizeUrl(state: string): string {
  const c = requireKakaoConfig()
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.restApiKey,
    redirect_uri: c.redirectUri,
    scope: TALK_MESSAGE_SCOPE,
    state,
  })
  return `${AUTHORIZE}?${q}`
}

async function postToken(body: URLSearchParams): Promise<KakaoTokenResponse> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => ({}))) as KakaoTokenResponse
  if (!res.ok || json.error || !json.access_token) {
    // error_description에 우리가 보낸 redirect_uri가 그대로 들어오는 경우가 있다.
    // 비밀은 아니지만 500자로 자른다 — 감사 기록과 로그에 그대로 실릴 문장이다.
    throw new Error(
      `카카오 토큰 요청 실패 (HTTP ${res.status}) ${json.error ?? ''} ${json.error_description ?? ''}`
        .trim()
        .slice(0, 500),
    )
  }
  return json
}

/** 인가코드 → 토큰 한 벌. /api/kakao/callback이 부른다. */
export async function exchangeCode(code: string): Promise<KakaoTokenSet> {
  const c = requireKakaoConfig()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: c.restApiKey,
    redirect_uri: c.redirectUri,
    code,
  })
  if (c.clientSecret) body.set('client_secret', c.clientSecret)

  const json = await postToken(body)
  if (!json.refresh_token) {
    throw new Error('카카오가 refresh_token을 주지 않았다. 앱의 동의항목 설정을 확인한다.')
  }
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token,
    // 카카오 기본값: access 6시간(21600초), refresh 60일(5184000초).
    // 응답에 값이 있으면 그것을 쓰고, 없을 때만 이 기본값으로 떨어진다.
    expiresAt: at(json.expires_in, 21_600),
    refreshExpiresAt: at(json.refresh_token_expires_in, 5_184_000),
    scopes: json.scope ?? '',
  }
}

/** refresh_token → 새 access_token. 야간 Job과 테스트 발송이 부른다. */
export async function refreshTokens(refreshToken: string): Promise<KakaoRefreshResult> {
  const c = requireKakaoConfig()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.restApiKey,
    refresh_token: refreshToken,
  })
  if (c.clientSecret) body.set('client_secret', c.clientSecret)

  const json = await postToken(body)
  return {
    accessToken: json.access_token!,
    expiresAt: at(json.expires_in, 21_600),
    // 안 준 회차는 null로 넘긴다. 0023 kakao_token_refreshed()가 coalesce로 기존 값을 지킨다 —
    // 여기서 빈 문자열을 보내면 그 방어가 무력해진다.
    refreshToken: json.refresh_token ?? null,
    refreshExpiresAt: json.refresh_token ? at(json.refresh_token_expires_in, 5_184_000) : null,
  }
}

/** 동의항목에 talk_message가 있는가. 없으면 연결은 됐어도 발송이 -402로 거절된다. */
export function canSendMessage(scopes: string): boolean {
  return scopes.split(/[\s,]+/).includes(TALK_MESSAGE_SCOPE)
}
```

- [ ] **Step 3: `.env.example`에 카카오 절을 더한다**

`.env.example`의 `--- Integration 계정 (예약) ---` 절 **바로 위**에 넣는다:

```
# --- 카카오 아침 알림 (Phase 3-C) ----------------------------------------
# 야간 Job의 마지막 단계가 카카오톡 '나에게 보내기'로 브리핑 한 줄을 보낸다.
# 전부 서버 전용이다 — NEXT_PUBLIC_ 을 붙이면 REST API 키가 빌드 산출물에 박혀 브라우저로 나간다.

# 카카오 개발자 콘솔 > 내 애플리케이션 > 앱 키 > REST API 키.
KAKAO_REST_API_KEY=

# 카카오 콘솔의 [카카오 로그인 > Redirect URI]에 등록한 값과 **한 글자도 달라서는 안 된다**.
# 요청 호스트에서 유도하지 않는 이유: Vercel Preview는 배포마다 호스트가 바뀌는데
# 등록된 URI는 고정된 둘(production, localhost)뿐이라 유도하면 Preview에서 KOE006이 난다.
#   production  https://chairman-os-eosin.vercel.app/api/kakao/callback
#   로컬        http://localhost:3000/api/kakao/callback
KAKAO_REDIRECT_URI=

# 카톡 메시지 안의 '전문 보기'가 가리킬 곳. 끝에 / 를 붙이지 않는다.
# Cron에는 요청이 없어 호스트를 알 방법이 이 값뿐이다.
#   production  https://chairman-os-eosin.vercel.app
#   로컬        http://localhost:3000
APP_BASE_URL=

# 카카오 콘솔 [보안]에서 Client Secret을 '사용함'으로 켰을 때만 채운다. 안 켰으면 비워 둔다.
KAKAO_CLIENT_SECRET=
```

같은 파일의 야간 AI 브리핑 절에서 cron 시각을 고친다 (Task 6에서 vercel.json을 바꾸므로 문서도 같이 맞춘다):

```
# /api/cron/night-brief. 매일 07:00 KST(vercel.json 22:00 UTC)에 돈다. 서버 전용 — NEXT_PUBLIC_ 을 붙이지 않는다.
```

- [ ] **Step 4: 타입과 린트**

Run: `npm run typecheck && npm run lint`

Expected: 둘 다 통과. (`server-only` 패키지는 이미 의존성에 있다.)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/kakao/config.ts src/lib/kakao/token.ts .env.example
git commit -m "feat(kakao): 설정과 토큰 교환

redirect_uri를 요청 호스트에서 유도하지 않고 환경변수로 박는다 — 카카오에 등록된
URI는 고정된 둘뿐인데 Vercel Preview는 배포마다 호스트가 바뀐다.
refresh 응답에 refresh_token이 없는 회차는 null로 넘긴다. 0023 쪽 coalesce가
기존 값을 지키는데, 빈 문자열을 보내면 그 방어가 무력해진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 발송 — 토큰 확보부터 감사 기록까지

**Files:**
- Modify: `src/lib/kakao/message.ts` (`sendKakaoMemo()` 추가)
- Create: `src/lib/kakao/send-brief.ts`

**Interfaces:**
- Consumes: `buildKakaoBriefText`(Task 2), `refreshTokens`·`canSendMessage`·`requireKakaoConfig`(Task 3), 0023의 `kakao_token_for_send()`·`kakao_token_refreshed()`(Task 1)
- Produces: `sendKakaoBrief(opts): Promise<KakaoSendResult>` — `{ sent: boolean; skipped?: string; error?: string }`

- [ ] **Step 1: `sendKakaoMemo()`를 `message.ts` 끝에 붙인다**

```ts
/**
 * 카카오톡 '나에게 보내기'. 텍스트 템플릿 하나만 쓴다.
 *
 * 성공은 { result_code: 0 }이고, 실패는 HTTP 200으로도 온다 — 그래서 res.ok만 보지 않는다.
 * 자주 보게 될 코드:
 *   -401  토큰이 만료·무효 (호출부가 refresh로 한 번 되살려 본다)
 *   -402  talk_message 동의가 없다 (사람이 다시 연결해야 한다. refresh로는 안 고쳐진다)
 */
export interface KakaoSendFailure {
  /** 카카오가 준 code. HTTP 계층에서 실패하면 null. */
  code: number | null
  message: string
}

export async function sendKakaoMemo(opts: {
  accessToken: string
  text: string
  /** '전문 보기' 버튼과 텍스트 링크가 가리킬 절대 주소. */
  linkUrl: string
}): Promise<KakaoSendFailure | null> {
  const templateObject = {
    object_type: 'text',
    text: opts.text,
    link: { web_url: opts.linkUrl, mobile_web_url: opts.linkUrl },
    button_title: '전문 보기',
  }

  let res: Response
  try {
    res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.accessToken}`,
        'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
      cache: 'no-store',
    })
  } catch (e) {
    return { code: null, message: `카카오 호출 실패: ${e instanceof Error ? e.message : String(e)}` }
  }

  const json = (await res.json().catch(() => ({}))) as {
    result_code?: number
    code?: number
    msg?: string
  }
  if (res.ok && json.result_code === 0) return null
  return {
    code: json.code ?? null,
    message: `카카오 발송 실패 (HTTP ${res.status}, code ${json.code ?? '?'}) ${json.msg ?? ''}`
      .trim()
      .slice(0, 500),
  }
}
```

- [ ] **Step 2: 발송 오케스트레이션을 만든다**

`src/lib/kakao/send-brief.ts`:

```ts
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { IsoDate } from '@/types'

import { kakaoConfig } from './config'
import { buildKakaoBriefText, sendKakaoMemo } from './message'
import { canSendMessage, refreshTokens } from './token'

/**
 * 브리핑 한 줄을 회장 카카오톡으로 보낸다 (Phase 3-C).
 *
 * 야간 Job의 **마지막 단계**다. 그래서 이 파일의 모든 실패 경로는 던지지 않고 돌려준다 —
 * 카카오가 죽었다고 브리핑 행까지 Failed가 되면, 아침에 /ai를 열어도 "어젯밤 실패"만 보인다.
 * 발송은 브리핑의 배달 수단이지 브리핑 자체가 아니다.
 *
 * audit_log에 남기는 것도 같은 이유다. 응답 JSON은 cron 로그에만 남고 아무도 안 본다 —
 * "지난주 화요일에 카톡이 왔던가"는 감사 기록에서만 답할 수 있다.
 *
 * 토큰을 읽고 쓰는 유일한 길은 0023의 함수 둘이다(kakao_token_for_send / kakao_token_refreshed).
 * 이 세션은 AIAgent이고, AIAgent는 chairman_kakao_token 표에 select 문 한 줄도 못 던진다.
 */

export interface KakaoSendResult {
  sent: boolean
  /** 보낼 조건이 아니어서 안 보낸 경우(연결 없음, 설정 없음 등). 실패가 아니다. */
  skipped?: string
  error?: string
}

interface TokenRow {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  refresh_expires_at: string
  scopes: string
}

/** 만료 5분 전부터는 이미 만료된 것으로 본다. 발송 도중에 넘어가는 경계를 없앤다. */
const EARLY_REFRESH_MS = 5 * 60 * 1000

export async function sendKakaoBrief(opts: {
  /** AIAgent(야간 Job) 또는 Chairman(테스트 발송) 세션. */
  sb: SupabaseClient
  /** audit_log의 actor. 세션 주인의 user_id다. */
  actorUserId: string
  actorRole: 'AIAgent' | 'Chairman'
  runDate: IsoDate
  /** 그룹 브리핑 summary 전문. 앞 2~3문장만 나간다. */
  summary: string
  /** 'D-780'. 진행 중인 장기 프로젝트가 없으면 null. */
  dDay: string | null
  projectTitle: string | null
  /** 'cron' | 'manual' | 'test'. 감사 기록의 note에 그대로 들어간다. */
  trigger: string
}): Promise<KakaoSendResult> {
  const config = kakaoConfig()
  if (!config) {
    return await done(opts, { sent: false, skipped: '카카오 환경변수가 없다' })
  }

  // ① 토큰. 0023의 keyhole 하나가 유일한 길이다.
  const { data, error } = await opts.sb.rpc('kakao_token_for_send')
  if (error) {
    return await done(opts, { sent: false, error: `kakao_token_for_send ${error.code ?? '?'}: ${error.message}` })
  }
  const token = (data as TokenRow[] | null)?.[0]
  if (!token) {
    // 연결이 없는 것과 이 세션이 못 읽는 것을 구분하지 않는다(0023의 계약).
    return await done(opts, { sent: false, skipped: '카카오가 연결되어 있지 않다' })
  }

  if (Date.parse(token.refresh_expires_at) <= Date.now()) {
    return await done(opts, { sent: false, skipped: 'refresh_token이 만료됐다 — 회장이 다시 연결해야 한다' })
  }
  if (!canSendMessage(token.scopes)) {
    // refresh로는 안 고쳐진다. 동의는 사람이 카카오 화면에서 주는 것이다.
    return await done(opts, { sent: false, skipped: '카카오톡 메시지 전송 동의가 없다 — 다시 연결해야 한다' })
  }

  // ② 만료가 가까우면 먼저 갱신한다. 갱신 자체가 실패하면 낡은 토큰으로 한 번 시도해 본다 —
  //    카카오의 만료 시각 계산과 우리 시계가 어긋났을 수 있고, 안 보내는 것보다 시도가 낫다.
  let accessToken = token.access_token
  if (Date.parse(token.expires_at) - Date.now() <= EARLY_REFRESH_MS) {
    const refreshed = await tryRefresh(opts.sb, token.refresh_token)
    if (refreshed) accessToken = refreshed
  }

  const text = buildKakaoBriefText({
    dDay: opts.dDay,
    projectTitle: opts.projectTitle,
    summary: opts.summary,
  })
  const linkUrl = `${config.appBaseUrl}/ai?date=${opts.runDate}`

  // ③ 보낸다. -401이면 토큰 문제이므로 한 번만 갱신하고 다시 시도한다.
  let failure = await sendKakaoMemo({ accessToken, text, linkUrl })
  if (failure?.code === -401) {
    const refreshed = await tryRefresh(opts.sb, token.refresh_token)
    if (refreshed) failure = await sendKakaoMemo({ accessToken: refreshed, text, linkUrl })
  }

  return await done(opts, failure ? { sent: false, error: failure.message } : { sent: true })
}

/**
 * refresh 한 번. 실패는 삼킨다 — 호출부가 낡은 토큰으로 계속 가거나 발송 실패로 끝낸다.
 * 성공하면 0023 kakao_token_refreshed()로 되쓴다. AIAgent에게는 그 함수가 유일한 쓰기 길이고,
 * 그 함수는 행을 만들지 못한다 — 연결이 사라진 뒤 Job이 되살리는 일은 일어나지 않는다.
 */
async function tryRefresh(sb: SupabaseClient, refreshToken: string): Promise<string | null> {
  try {
    const next = await refreshTokens(refreshToken)
    const { error } = await sb.rpc('kakao_token_refreshed', {
      p_access: next.accessToken,
      p_expires: next.expiresAt,
      p_refresh: next.refreshToken,
      p_refresh_expires: next.refreshExpiresAt,
    })
    if (error) console.error('[kakao] token write', error.code, error.message)
    return next.accessToken
  } catch (e) {
    console.error('[kakao] refresh', e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * 결과를 audit_log에 남기고 그대로 돌려준다. 이 기록 자체가 실패해도 발송 결과는 바꾸지 않는다 —
 * 카톡은 이미 갔거나 안 갔고, 기록을 못 남겼다고 그 사실이 달라지지는 않는다.
 *
 * action은 0023이 더한 kakao_sent / kakao_failed다. '보낼 조건이 아니어서 안 보냄'(skipped)도
 * kakao_failed로 남긴다 — 낱말은 거칠지만 note가 정확히 말한다(0022가 delete_request로
 * 실제 삭제를 적은 것과 같은 절제다). 조용히 아무 기록도 없으면 "오늘 카톡이 왜 안 왔지"에
 * 답할 자리가 없어진다.
 */
async function done(
  opts: { sb: SupabaseClient; actorUserId: string; actorRole: string; runDate: IsoDate; trigger: string },
  result: KakaoSendResult,
): Promise<KakaoSendResult> {
  const note = result.sent
    ? `카카오 아침 알림 발송 (${opts.trigger})`
    : `카카오 아침 알림 실패 (${opts.trigger}) — ${result.skipped ?? result.error ?? '원인 미상'}`

  const { error } = await opts.sb.from('audit_log').insert({
    actor_user_id: opts.actorUserId,
    actor_role: opts.actorRole,
    action: result.sent ? 'kakao_sent' : 'kakao_failed',
    entity_table: 'chairman_kakao_token',
    entity_id: opts.runDate,
    // 토큰은 여기 실리지 않는다. 실린 적 없는 값은 감사 기록을 읽는 사람에게도 새지 않는다.
    after: { run_date: opts.runDate, trigger: opts.trigger, sent: result.sent, reason: result.skipped ?? result.error ?? null },
    note,
  })
  if (error) console.error('[kakao] audit', error.code, error.message)

  if (!result.sent) console.error('[kakao]', note)
  return result
}
```

- [ ] **Step 3: 타입과 린트**

Run: `npm run typecheck && npm run lint`

Expected: 둘 다 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/kakao/message.ts src/lib/kakao/send-brief.ts
git commit -m "feat(kakao): 발송 — 토큰 확보부터 감사 기록까지

모든 실패 경로가 던지지 않고 돌려준다. 카카오가 죽었다고 브리핑 행까지 Failed가
되면 아침에 /ai를 열어도 '어젯밤 실패'만 보인다 — 발송은 브리핑의 배달 수단이지
브리핑 자체가 아니다.

'보낼 조건이 아니어서 안 보냄'도 kakao_failed로 남긴다. 조용히 아무 기록도 없으면
'오늘 카톡이 왜 안 왔지'에 답할 자리가 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: OAuth 라우트 세 개

**Files:**
- Create: `src/app/api/kakao/auth/route.ts`
- Create: `src/app/api/kakao/callback/route.ts`
- Create: `src/app/api/kakao/test/route.ts`

**Interfaces:**
- Consumes: `currentUser()`(`@/lib/auth/session`), `authorizeUrl`·`exchangeCode`(Task 3), `sendKakaoBrief`(Task 4), `createSupabaseServerClient`(`@/lib/supabase/server`)
- Produces: `GET /api/kakao/auth`, `GET /api/kakao/callback`, `POST /api/kakao/test`

**주의:** `src/proxy.ts`의 matcher는 손대지 않는다. 이 세 경로는 로그인 쿠키가 있는 브라우저 요청이고(카카오에서 돌아오는 리다이렉트도 top-level GET이라 SameSite=Lax 쿠키가 실린다), 미로그인이면 `/login`으로 튕기는 편이 맞다. `/api/cron`·`/api/health`를 뺀 이유(쿠키 없는 요청)가 여기에는 없다.

- [ ] **Step 1: 입구**

`src/app/api/kakao/auth/route.ts`:

```ts
import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { authorizeUrl } from '@/lib/kakao/token'

/**
 * /api/kakao/auth — 카카오 로그인으로 보내는 입구 (Phase 3-C).
 *
 * state는 여기서 만들어 쿠키에도 심고 카카오에도 실어 보낸다. 돌아왔을 때 둘이 같아야
 * 우리가 시작한 흐름이다 — 남이 회장 브라우저로 자기 카카오 계정을 연결시키는
 * (로그인 CSRF) 길을 막는다.
 *
 * 쿠키는 httpOnly다. 이 값을 읽을 이유가 있는 코드는 /api/kakao/callback뿐이다.
 */
export const dynamic = 'force-dynamic'

export const KAKAO_STATE_COOKIE = 'kakao_oauth_state'

export async function GET() {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '카카오 연결은 Chairman만 할 수 있습니다.' }, { status: 403 })
  }

  let url: string
  const state = randomBytes(16).toString('hex')
  try {
    url = authorizeUrl(state)
  } catch (e) {
    // 환경변수가 빠진 채로 카카오에 가면 KOE006이 뜬다. 우리 화면에서 우리 말로 말한다.
    const reason = e instanceof Error ? e.message : String(e)
    return NextResponse.redirect(
      new URL(`/settings/chairman?kakao=config&reason=${encodeURIComponent(reason)}`, process.env.APP_BASE_URL ?? 'http://localhost:3000'),
    )
  }

  const res = NextResponse.redirect(url)
  res.cookies.set(KAKAO_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax', // 카카오에서 돌아오는 top-level GET에 실려야 한다. strict면 안 실린다.
    secure: process.env.NODE_ENV === 'production',
    path: '/api/kakao',
    maxAge: 600, // 10분. 카카오 화면에 머무는 시간이면 충분하다.
  })
  return res
}
```

- [ ] **Step 2: 돌아오는 자리**

`src/app/api/kakao/callback/route.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { requireKakaoConfig } from '@/lib/kakao/config'
import { canSendMessage, exchangeCode } from '@/lib/kakao/token'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { KAKAO_STATE_COOKIE } from '../auth/route'

/**
 * /api/kakao/callback — 카카오가 인가코드를 들고 돌려보내는 자리 (Phase 3-C).
 *
 * 항상 /settings/chairman으로 되돌린다. JSON을 보여 주는 화면이 아니라 회장이 버튼을
 * 누르고 돌아오는 자리라서, 결과는 ?kakao=... 한 낱말로 싣고 화면이 문장을 고른다.
 *
 * 토큰은 이 함수 안에서만 산다. 0023 kakao_token_save()로 넘기고 나면 변수도 응답도
 * 그 값을 들고 있지 않다 — 리다이렉트 URL에도, 로그에도 싣지 않는다.
 */
export const dynamic = 'force-dynamic'

function back(reason: string): NextResponse {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000'
  const res = NextResponse.redirect(new URL(`/settings/chairman?kakao=${reason}`, base))
  // 한 번 쓴 state는 결과가 무엇이든 버린다.
  res.cookies.set(KAKAO_STATE_COOKIE, '', { path: '/api/kakao', maxAge: 0 })
  return res
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function GET(request: NextRequest) {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '카카오 연결은 Chairman만 할 수 있습니다.' }, { status: 403 })
  }

  const params = request.nextUrl.searchParams
  // 회장이 카카오 화면에서 '취소'를 눌렀을 때도 여기로 온다(error=access_denied).
  if (params.get('error')) return back('cancelled')

  const code = params.get('code')
  const state = params.get('state')
  const cookie = request.cookies.get(KAKAO_STATE_COOKIE)?.value
  if (!code || !state || !cookie || !sameState(state, cookie)) return back('state')

  try {
    requireKakaoConfig()
    const tokens = await exchangeCode(code)

    const sb = await createSupabaseServerClient()
    const { data, error } = await sb.rpc('kakao_token_save', {
      p_access: tokens.accessToken,
      p_refresh: tokens.refreshToken,
      p_expires: tokens.expiresAt,
      p_refresh_expires: tokens.refreshExpiresAt,
      p_scopes: tokens.scopes,
    })
    if (error) {
      console.error('[kakao] save', error.code, error.message)
      return back('save')
    }
    // 0023의 함수는 권한이 없으면 예외 대신 false를 준다.
    if (data !== true) return back('forbidden')

    // 저장은 했다. 다만 '카카오톡 메시지 전송'이 선택 동의라 회장이 체크를 풀고 넘어갈 수 있다 —
    // 그 상태로 두면 아침 07:00에 -402로 조용히 실패한다. 지금 화면에서 말한다.
    return back(canSendMessage(tokens.scopes) ? 'connected' : 'noscope')
  } catch (e) {
    console.error('[kakao] callback', e instanceof Error ? e.message : String(e))
    return back('failed')
  }
}
```

- [ ] **Step 3: 테스트 발송**

`src/app/api/kakao/test/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { sendKakaoBrief } from '@/lib/kakao/send-brief'
import { kstToday, orderProjects, projectClock } from '@/lib/chairman-project'
import { getRepository } from '@/lib/repository'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * /api/kakao/test — '테스트 발송' (Phase 3-C).
 *
 * 야간 Job과 **같은 sendKakaoBrief()**를 부른다. 다른 경로로 보내면 여기서 성공해도
 * 아침에 성공한다는 보장이 없다 — 수동 실행이 Cron과 같은 route를 지나게 한 것과 같은 이유다.
 *
 * 다른 것은 세 가지다. 회장 세션으로 돌고(야간 Job은 AIAgent), summary가 오늘 브리핑이 아니라
 * 고정 문장이며, 감사 기록의 trigger가 'test'다.
 */
export const dynamic = 'force-dynamic'

const SAMPLE =
  '테스트 발송입니다. 실제 아침 알림은 이 자리에 야간 브리핑의 앞 두세 문장이 들어갑니다. ' +
  '버튼을 눌러 전문이 열리는지 확인하세요.'

export async function POST() {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '테스트 발송은 Chairman만 할 수 있습니다.' }, { status: 403 })
  }

  const today = kstToday()
  // 머리글이 실제와 같아야 테스트가 의미가 있다 — 야간 Job과 같은 고르기를 쓴다.
  const repo = await getRepository()
  const active = orderProjects(await repo.listChairmanProjects()).filter((p) => p.status === 'Active')
  const lead = active[0] ?? null

  const sb = await createSupabaseServerClient()
  const result = await sendKakaoBrief({
    sb,
    actorUserId: user.user_id,
    actorRole: 'Chairman',
    runDate: today,
    summary: SAMPLE,
    dDay: lead ? projectClock(lead, today).label : null,
    projectTitle: lead?.title ?? null,
    trigger: 'test',
  })

  return NextResponse.json(result, { status: result.sent ? 200 : 502 })
}
```

`user.user_id`의 실제 필드명을 `src/lib/auth/session.ts`에서 확인하고 맞춘다 — `currentUser()`가 돌려주는 타입에 `role`과 함께 있는 식별자 칸이다(`name`도 쓰고 있으므로 같은 객체다).

- [ ] **Step 4: 빌드로 라우트 타입을 만든다**

Run: `npm run build`

Expected: 성공. 새 route를 만든 직후에는 build가 라우트 타입을 다시 생성해야 `tsc`가 통과한다(OPERATIONS 1절).

- [ ] **Step 5: 타입과 린트**

Run: `npm run typecheck && npm run lint`

Expected: 둘 다 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/kakao
git commit -m "feat(kakao): OAuth 라우트 셋 — 연결 · 콜백 · 테스트 발송

state를 httpOnly 쿠키와 대조한다. 남이 회장 브라우저로 자기 카카오 계정을
연결시키는 길을 막는다.

'카카오톡 메시지 전송'이 선택 동의라 회장이 체크를 풀고 넘어갈 수 있다. 그대로 두면
아침 07:00에 -402로 조용히 실패하므로 연결 직후 화면에서 말한다.

테스트 발송은 야간 Job과 같은 sendKakaoBrief()를 부른다 — 다른 경로로 보내면
여기서 성공해도 아침에 성공한다는 보장이 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 야간 Job에 붙이고 cron을 07시로 옮긴다

**Files:**
- Modify: `vercel.json`
- Modify: `src/lib/ai/night-brief.ts`
- Modify: `src/lib/ai/adapter.ts`
- Modify: `src/lib/ai/prompts/daily-brief.md`
- Modify: `src/lib/repository/types.ts`, `src/lib/repository/supabase.ts`, `src/lib/repository/dummy.ts`
- Modify: `src/app/api/cron/night-brief/route.ts` (주석만)

**Interfaces:**
- Consumes: `sendKakaoBrief`(Task 4), 0023 `chairman_recent_condition()`(Task 1)
- Produces: `ChairmanRepository.getRecentCondition(): Promise<{ condition: ChairmanCondition; checkin_date: IsoDate } | null>` (`getTodayCondition`을 대체), `ChairmanContext['checkin']`에 `as_of: IsoDate` 추가

- [ ] **Step 1: cron 시각을 옮긴다**

`vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/night-brief",
      "schedule": "0 22 * * *"
    }
  ]
}
```

22:00 UTC = 07:00 KST. Vercel Hobby는 cron 슬롯이 하나라 생성과 발송을 한 번에 한다 —
23시에 만들고 07시에 보내는 두 슬롯을 쓸 수 없다.

- [ ] **Step 2: 컨디션 읽기를 오늘-또는-어제로 바꾼다**

`src/lib/repository/types.ts`에서 `getTodayCondition()` 선언과 그 위 주석을 통째로 갈아 끼운다:

```ts
  /**
   * P5-5d에서 만든 keyhole을 Phase 3-C에서 하루 넓힌 것(0023 chairman_recent_condition()).
   * 표를 직접 읽지 않고 RPC를 부른다 — Chairman·AIAgent 세션 양쪽에서 통과한다(RLS가 아니라
   * 함수 안의 역할 판정이라서다).
   *
   * '오늘'이 아니라 '오늘 아니면 어제'인 이유: 야간 Job이 23:00 KST에서 07:00 KST로 옮겨 가,
   * 회장의 아침 체크인보다 **먼저** 도는 것이 기본이 됐다. 오늘 것만 보면 거의 매일 null이라
   * 브리핑에서 컨디션 문장이 통째로 사라진다. 대신 어느 날 값인지(checkin_date) 같이 주고,
   * 모델이 "어제 컨디션 기준"이라고 말하게 한다.
   *
   * 다른 역할이거나 이틀 안에 기록이 없으면 null — 없는 것과 못 읽는 것을 여기서도
   * 구분하지 않는다. 화면의 '오늘 체크인' 칸은 Chairman 세션으로 표를 그대로 읽는
   * getCheckin을 쓴다(src/app/(morning)/ai/page.tsx).
   */
  getRecentCondition(): Promise<{ condition: ChairmanCondition; checkin_date: IsoDate } | null>
```

`src/lib/repository/supabase.ts`의 `getTodayCondition` 구현을 갈아 끼운다:

```ts
    /**
     * Phase 3-C. 0023 chairman_recent_condition() RPC. 오늘(KST) 행이 없으면 어제 것을 준다 —
     * 야간 Job이 07:00 KST로 옮겨 가 체크인보다 먼저 도는 것이 기본이 됐기 때문이다.
     * 어느 날 값인지 같이 받아 모델이 "어제 기준"이라고 말할 수 있게 한다.
     */
    async getRecentCondition(): Promise<{ condition: ChairmanCondition; checkin_date: IsoDate } | null> {
      const { data, error } = await sb.rpc('chairman_recent_condition')
      if (error) throw new Error(`Supabase chairman_recent_condition ${error.code ?? '?'}: ${error.message}`)
      const row = (data as { condition: number; checkin_date: string }[] | null)?.[0]
      return row ? { condition: row.condition as ChairmanCondition, checkin_date: row.checkin_date } : null
    },
```

`src/lib/repository/dummy.ts`의 `getTodayCondition` 구현을 갈아 끼운다:

```ts
  /** Phase 3-C. dummy는 역할별 RLS를 흉내 내지 않는다 — 오늘 것이 있으면 오늘, 없으면 어제. */
  async getRecentCondition() {
    const today = kstToday()
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    for (const d of [today, yesterday]) {
      const found = memoryCheckins.get(d)
      if (found) return { condition: found.condition, checkin_date: d }
    }
    return null
  },
```

`getTodayCondition`을 부르던 자리가 더 있는지 확인한다:

Run: `grep -rn "getTodayCondition\|chairman_today_condition" src scripts`

Expected: 아무것도 안 나온다. 나오면 전부 고친다.

- [ ] **Step 3: 어댑터 계약에 as_of를 더한다**

`src/lib/ai/adapter.ts`의 `ChairmanContext` 안 `checkin` 칸을 찾아 갈아 끼운다:

```ts
  /**
   * 0023 chairman_recent_condition()이 준 값. condition 하나와 그것이 **어느 날** 값인가.
   * as_of가 오늘이 아니면 회장이 아직 아침 체크인을 하기 전이라는 뜻이다 —
   * 야간 Job이 07:00 KST로 옮겨 간 뒤로는 그쪽이 기본이다.
   */
  checkin: { condition: ChairmanCondition; as_of: IsoDate } | null
```

- [ ] **Step 4: 프롬프트가 어제 값임을 말하게 한다**

`src/lib/ai/prompts/daily-brief.md`에서 컨디션을 다루는 문단을 찾아, 아래 지시를 그 문단 끝에 더한다:

```markdown
`chairman.checkin.as_of`가 오늘 날짜가 아니면 그것은 **어제 기록**이다. 컨디션을 근거로
무언가를 권할 때 "어제 컨디션 기준"이라고 밝혀 쓴다. 오늘 값인 척 쓰지 않는다.
`chairman.checkin`이 null이면 컨디션을 아예 언급하지 않는다 — 기록이 없는 것을
"보통이었다"로 메우지 않는다.
```

- [ ] **Step 5: 야간 Job의 마지막 단계로 발송을 붙인다**

`src/lib/ai/night-brief.ts`를 네 군데 고친다.

**(a) import 추가** — 기존 import 블록에 맞춰 넣는다:

```ts
import { sendKakaoBrief } from '@/lib/kakao/send-brief'
```

**(b) 파일 머리 주석 ③ 아래에 ④를 더하고, 시각을 정정한다.** 머리 주석의 첫 줄

```
 * 야간 브리핑 Job (Phase 3-A, CH-019 / CH-045~048).
```

아래 파이프라인 설명 끝에 `→ 카카오 발송(Phase 3-C)`을 더하고, 세 항목 뒤에 넷째를 붙인다:

```
 * ④ 카카오 발송은 맨 마지막이고, 실패해도 Job은 성공이다 (Phase 3-C). 카톡이 안 갔다고
 *   브리핑 행까지 Failed가 되면 아침에 /ai를 열어도 '어젯밤 실패'만 보인다 —
 *   발송은 브리핑의 배달 수단이지 브리핑 자체가 아니다. 성패는 audit_log에 남는다.
 *   cron으로 돌 때만 보낸다. 수동 실행은 하루에 몇 번이고 누를 수 있는 버튼이라
 *   누를 때마다 카톡이 가면 알림이 아니라 소음이 된다 — 테스트 발송 버튼이 따로 있다.
```

**(c) `kstDate()`의 주석을 고친다.** 23:00을 전제한 문장이 남아 있으면 거짓말이 된다:

```ts
/**
 * 07:00 KST에 돌아 '오늘'을 요약한다(Phase 3-C 이전에는 23:00에 돌아 그날을 요약했다).
 * UTC 날짜를 쓰면 09:00 KST 전에 도는 이 Job이 늘 어제로 찍힌다 — 07:00은 그 구간 안이라
 * 옮긴 뒤로 이 함수가 더 중요해졌다.
 */
export function kstDate(now = new Date()): IsoDate {
```

**(d) 그룹 브리핑 블록과 audit_log 사이를 고친다.** 현재 구조는 이렇다:

```ts
    // 그룹 1건. ...
    try {
      ...
      const chairman = await readChairmanContext(repo, run_date)
      ...
      const brief = await opts.adapter.generateDailyBrief({ ... })
      await write({ business_id: null, job_type: 'Daily Brief', status: 'Done', brief })
    } catch (e) { ... }

    report.ok = report.failed === 0 && report.inserted > 0
    const { error: auditError } = await sb.from('audit_log').insert({ ... })
```

`chairman`과 `brief`를 try 밖으로 끌어올려 카카오 단계가 쓸 수 있게 하고, audit_log **뒤에** 발송을 붙인다:

```ts
    // 그룹 1건. 회사 요약이 하나도 없으면 모델을 부르지 않는다 — 빈 입력으로 쓴 브리핑은 지어낸 글이다.
    // chairman·groupBrief를 try 밖에 두는 것은 Phase 3-C 때문이다. 카카오 발송이 이 둘을
    // 다시 읽지 않고 그대로 쓴다 — 같은 브리핑을 두 번 읽으면 화면과 카톡이 다른 말을 할 수 있다.
    let chairman: ChairmanContext | null = null
    let groupBrief: AiBrief | null = null
    try {
      if (readError) throw new Error(readError)
      if (!opts.adapter) throw new Error(opts.adapterError ?? 'AI 어댑터 없음')
      if (briefs.length === 0) throw new Error('요약에 성공한 회사가 없다.')
      const order = new Map(businesses.map((b, i) => [b.business_id, i]))
      briefs.sort((a, b) => (order.get(a.business_id) ?? 0) - (order.get(b.business_id) ?? 0))
      chairman = await readChairmanContext(repo, run_date)
      const finance = snapshot?.ledger
        ? financeBriefContext(snapshot.ledger, businesses.map((b) => b.business_id))
        : null
      groupBrief = await opts.adapter.generateDailyBrief({ date: run_date, companies: briefs, failed, chairman, finance })
      await write({ business_id: null, job_type: 'Daily Brief', status: 'Done', brief: groupBrief })
    } catch (e) {
      const msg = errorText(e)
      console.error('[night-brief] group', msg)
      await write({ business_id: null, job_type: 'Daily Brief', status: 'Failed', brief: null, error: msg })
    }

    report.ok = report.failed === 0 && report.inserted > 0

    const { error: auditError } = await sb.from('audit_log').insert({
      /* ... 기존 그대로 ... */
    })
    if (auditError) {
      console.error('[night-brief] audit', auditError.code, auditError.message)
      report.ok = false
      report.error = `audit_log 기록 실패: ${auditError.message}`
    }

    /**
     * Phase 3-C — 마지막 단계. audit_log 뒤에 두는 것은 순서에 뜻이 있다.
     * 'Job이 끝났다'가 먼저 기록되고, 그 배달 결과가 뒤따른다. 발송을 앞에 두면
     * 카톡은 갔는데 Job 완료 기록이 없는 상태가 생길 수 있다.
     *
     * report에 싣지 않는 이유: report는 브리핑이 몇 건 남았나를 말하는 값이다.
     * 카톡 성패는 audit_log(kakao_sent / kakao_failed)에서 본다.
     */
    if (opts.trigger === 'cron' && groupBrief) {
      // 화면과 같은 고르기다 — orderProjects가 목표일이 가까운 Active를 맨 앞에 둔다.
      const lead = chairman?.projects[0] ?? null
      await sendKakaoBrief({
        sb,
        actorUserId: agentId,
        actorRole: 'AIAgent',
        runDate: run_date,
        summary: groupBrief.summary,
        dDay: lead?.d_day ?? null,
        projectTitle: lead?.title ?? null,
        trigger: 'cron',
      })
    }
```

`ChairmanContext`와 `AiBrief`가 이미 이 파일의 import에 있는지 확인한다 — 파일 상단에 `import type { AiAdapter, AiBrief, ChairmanContext, CompanyContext } from './adapter'`로 들어와 있다.

**(e) `readChairmanContext()`의 checkin 블록을 고친다:**

```ts
  // 체크인(0023 chairman_recent_condition())도 이니셔티브와 같은 이유로 따로 감싼다 —
  // 못 읽었다고 나머지 chairman 칸까지 null로 떨구지 않는다. 오늘 행이 없으면 어제 것이
  // 오고, 어느 날 값인지 as_of로 같이 온다. 07:00 KST에 도는 이 Job은 회장의 아침 체크인보다
  // 먼저 도는 것이 기본이라, 여기서 오는 값은 대개 어제 것이다.
  // sleep_hours·weight_kg·meal_note는 그 함수의 반환값에 아예 없어서 여기서도 고를 것이 없다.
  let checkin: ChairmanContext['checkin'] = null
  try {
    const recent = await repo.getRecentCondition()
    checkin = recent ? { condition: recent.condition, as_of: recent.checkin_date } : null
  } catch (e) {
    console.error('[night-brief] checkin', errorText(e))
    checkin = null
  }
```

- [ ] **Step 6: cron route의 주석을 정정한다**

`src/app/api/cron/night-brief/route.ts` 머리 주석에서:

```
 *   GET   Vercel Cron. vercel.json이 매일 22:00 UTC(07:00 KST)에 부른다.
```

그리고 같은 주석 블록 끝에 한 줄 더한다:

```
 * Phase 3-C에서 23:00 KST → 07:00 KST로 옮겼다. Vercel Hobby는 cron 슬롯이 하나라
 * '밤에 만들고 아침에 보낸다'를 두 슬롯으로 나눌 수 없다 — 아침에 만들어 바로 보낸다.
```

- [ ] **Step 7: 전부 돌린다**

Run: `npm run check:migrations && npm run check:kakao && npm run typecheck && npm run lint && npm run build`

Expected: 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add vercel.json src/lib/ai src/lib/repository src/app/api/cron/night-brief/route.ts
git commit -m "feat(kakao): 야간 Job 마지막 단계로 발송, cron을 07:00 KST로

Vercel Hobby는 cron 슬롯이 하나라 '밤에 만들고 아침에 보낸다'를 두 슬롯으로
나눌 수 없다. 아침에 만들어 바로 보낸다.

그 결과 Job이 회장의 아침 체크인보다 먼저 도는 것이 기본이 됐다. 컨디션 keyhole을
'오늘 아니면 어제'로 넓히고(0023), 어느 날 값인지 모델에 같이 넘겨 '어제 기준'이라고
밝혀 쓰게 한다. 오늘 것만 보면 거의 매일 null이라 컨디션 문장이 통째로 사라진다.

발송은 cron일 때만 한다 — 수동 실행은 하루에 몇 번이고 누르는 버튼이라
누를 때마다 카톡이 가면 알림이 아니라 소음이 된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: /settings/chairman의 카카오 알림 절

**Files:**
- Create: `src/components/settings/kakao-connect.tsx`
- Modify: `src/lib/repository/types.ts`, `src/lib/repository/supabase.ts`, `src/lib/repository/dummy.ts`
- Modify: `src/app/(dashboard)/settings/chairman/page.tsx`

**Interfaces:**
- Consumes: `KakaoConnection`(Task 2), 0023 `kakao_token_status()`(Task 1), `POST /api/kakao/test`·`GET /api/kakao/auth`(Task 5)
- Produces: `ChairmanRepository.getKakaoConnection(): Promise<KakaoConnection | null>`, `<KakaoConnect connection={...} notice={...} />`

- [ ] **Step 1: repository에 상태 읽기를 더한다**

`src/lib/repository/types.ts`에서 `getRecentCondition()` 선언 바로 아래에 넣는다:

```ts
  /**
   * Phase 3-C 카카오 연결 상태(0023 kakao_token_status()). Chairman이 아니면 null이다.
   *
   * 토큰 값은 이 경로로 오지 않는다 — 0023의 함수가 반환 목록에서 아예 뺐다.
   * 화면이 필요한 것은 '연결됐나 · 언제까지 · 메시지 동의가 있나' 셋뿐이고,
   * 그 셋만 오면 access_token이 실수로 HTML에 실리는 경로 자체가 없다.
   */
  getKakaoConnection(): Promise<KakaoConnection | null>
```

`src/lib/repository/types.ts` 상단의 `@/types` import에 `KakaoConnection`을 더한다.

`src/lib/repository/supabase.ts`의 `getRecentCondition` 구현 바로 아래:

```ts
    async getKakaoConnection(): Promise<KakaoConnection | null> {
      const { data, error } = await sb.rpc('kakao_token_status')
      if (error) throw new Error(`Supabase kakao_token_status ${error.code ?? '?'}: ${error.message}`)
      const row = (data as Omit<KakaoConnection, 'connected'>[] | null)?.[0]
      return row ? { connected: true, ...row } : null
    },
```

`src/lib/repository/dummy.ts`의 `getRecentCondition` 구현 바로 아래:

```ts
  /**
   * dummy에는 카카오 연결이 없다. '아직 연결 안 됨'이 dummy에서 볼 수 있는 유일한 상태이고,
   * 그 상태의 화면(= "카카오 연결" 버튼 하나)이 실제로 맞는지가 dummy에서 잴 수 있는 전부다.
   * 연결과 발송은 카카오 계정이 있어야 하므로 여기서 흉내 내지 않는다 — 흉내 낸 성공은
   * 검증이 아니라 위안이다.
   */
  async getKakaoConnection() {
    return null
  },
```

`dummy.ts`와 `supabase.ts` 상단 import에 `KakaoConnection` 타입을 더한다.

- [ ] **Step 2: 클라이언트 컴포넌트를 만든다**

`src/components/settings/kakao-connect.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Icon } from '@/components/ui/icon'
import type { KakaoConnection } from '@/types'

/**
 * 카카오 알림 연결 · 테스트 발송 (Phase 3-C). Chairman에게만 그려진다.
 *
 * 연결은 server action이 아니라 링크다 — 카카오 로그인 화면으로 **브라우저가 통째로**
 * 넘어갔다 돌아와야 하는 흐름이라 fetch로는 할 수 없다.
 *
 * 화면이 고르는 상태는 넷이다.
 *   연결 없음        "카카오 연결"
 *   동의 없음        "다시 연결" — 로그인은 됐는데 '카카오톡 메시지 전송' 체크를 풀고 넘어갔다.
 *                    선택 동의라 일어난다. 그대로 두면 아침 07:00에 -402로 조용히 실패한다.
 *   refresh 만료     "다시 연결" — 60일 동안 한 번도 안 갱신되면 여기로 온다.
 *   정상             "연결됨" + 테스트 발송
 *
 * access_token은 이 컴포넌트의 props에 없다. 0023 kakao_token_status()가 반환 목록에서
 * 뺐기 때문에 실수로 넘길 방법 자체가 없다.
 */

const NOTICE: Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  connected: { tone: 'ok', text: '카카오에 연결했습니다. 내일 아침 07시부터 브리핑이 카톡으로 옵니다.' },
  noscope: {
    tone: 'warn',
    text: '연결은 됐지만 “카카오톡 메시지 전송” 동의가 없습니다. 다시 연결하면서 그 항목을 체크해 주세요.',
  },
  cancelled: { tone: 'warn', text: '카카오 화면에서 취소했습니다. 연결되지 않았습니다.' },
  state: { tone: 'error', text: '연결 요청이 만료됐거나 확인되지 않았습니다. 다시 눌러 주세요.' },
  save: { tone: 'error', text: '토큰을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' },
  forbidden: { tone: 'error', text: '카카오 연결은 회장 계정만 할 수 있습니다.' },
  failed: { tone: 'error', text: '카카오와 토큰을 교환하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' },
  config: { tone: 'error', text: '카카오 환경변수가 설정되지 않았습니다. 배포 설정을 확인해 주세요.' },
}

function hasTalkMessage(scopes: string): boolean {
  return scopes.split(/[\s,]+/).includes('talk_message')
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(iso))
}

export function KakaoConnect({
  connection,
  notice,
}: {
  connection: KakaoConnection | null
  notice?: string
}) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [, startTransition] = useTransition()
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const banner = notice ? NOTICE[notice] : undefined
  const expired = connection ? Date.parse(connection.refresh_expires_at) <= Date.now() : false
  const scopeMissing = connection ? !hasTalkMessage(connection.scopes) : false
  const healthy = connection !== null && !expired && !scopeMissing

  async function test() {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/kakao/test', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { sent?: boolean; skipped?: string; error?: string }
      setResult(
        body.sent
          ? { tone: 'ok', text: '보냈습니다. 카카오톡을 확인해 주세요.' }
          : { tone: 'error', text: body.skipped ?? body.error ?? `발송 실패 (HTTP ${res.status})` },
      )
      startTransition(() => router.refresh())
    } catch (e) {
      setResult({ tone: 'error', text: e instanceof Error ? e.message : '발송 요청 실패' })
    } finally {
      setSending(false)
    }
  }

  const tone = (t: 'ok' | 'warn' | 'error') =>
    t === 'ok' ? 'text-ok' : t === 'warn' ? 'text-warning' : 'text-critical'

  return (
    <div>
      {banner ? (
        <p role="status" className={`mb-2 text-[11.5px] ${tone(banner.tone)}`}>
          {banner.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {healthy ? (
          <>
            <span className="flex items-center gap-1.5 text-[12px] text-ok">
              <Icon name="check" className="size-3.5" />
              연결됨
            </span>
            <span className="text-[11px] text-ink-muted tnum">
              {formatDay(connection!.refresh_expires_at)}까지
            </span>
            <button
              type="button"
              onClick={test}
              disabled={sending}
              className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:cursor-wait disabled:opacity-60"
            >
              {sending ? '보내는 중…' : '테스트 발송'}
            </button>
            <a
              href="/api/kakao/auth"
              className="text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              다시 연결
            </a>
          </>
        ) : (
          <>
            {connection ? (
              <span className={`text-[12px] ${tone('warn')}`}>
                {expired ? '연결이 만료됐습니다.' : '메시지 전송 동의가 없습니다.'}
              </span>
            ) : null}
            <a
              href="/api/kakao/auth"
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-app transition-opacity hover:opacity-90"
            >
              {connection ? '다시 연결' : '카카오 연결'}
            </a>
          </>
        )}

        {result ? (
          <span role="status" className={`text-[11.5px] ${tone(result.tone)}`}>
            {result.text}
          </span>
        ) : null}
      </div>
    </div>
  )
}
```

`Icon`의 `check`·`crown` 같은 이름이 실제로 있는지 `src/components/ui/icon.tsx`에서 확인하고, 없으면 있는 이름(예: `sparkles`)으로 바꾼다.

- [ ] **Step 3: 설정 페이지에 절을 더한다**

`src/app/(dashboard)/settings/chairman/page.tsx`:

import에 더한다:

```ts
import { KakaoConnect } from '@/components/settings/kakao-connect'
import { firstParam } from '@/lib/query'
```

함수 시그니처와 데이터 읽기를 고친다 (`?kakao=...`를 읽어야 하므로 searchParams가 필요하다):

```tsx
export default async function ChairmanSettingsPage(props: PageProps<'/settings/chairman'>) {
  const user = await currentUser()
  if (!canEditChairmanRoutine(user)) notFound()

  const params = await props.searchParams
  const repo = await getRepository()
  const [projects, manifesto, kakao] = await Promise.all([
    repo.listChairmanProjects(),
    repo.getChairmanManifesto(),
    repo.getKakaoConnection(),
  ])
  const today = kstToday()
```

선언문 절(`<section className="mt-3.5 mb-6 ...">`) **바로 위**에 새 절을 넣고, 선언문 절의 `mb-6`는 그대로 둔다:

```tsx
      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="bell" className="size-4 text-ink-dim" />
          카카오 아침 알림
        </h2>
        <p className="mt-1 mb-2 text-[10.5px] text-ink-muted">
          매일 아침 07시에 그룹 브리핑 앞부분과 전문 링크가 회장님 카카오톡으로 갑니다.
          토큰은 서버에만 저장되고 이 화면으로 내려오지 않습니다.
        </p>
        <KakaoConnect connection={kakao} notice={firstParam(params.kakao)} />
      </section>
```

`firstParam`의 실제 시그니처를 `src/lib/query.ts`에서 확인하고 맞춘다.

- [ ] **Step 4: 빌드로 라우트 타입을 만든다**

Run: `npm run build`

Expected: 성공. `/settings/chairman`이 이제 `searchParams`를 받으므로 `PageProps` 타입이 다시 생성돼야 한다.

- [ ] **Step 5: dummy 모드로 실제 화면을 본다**

Run: `npm run dev` (별도 터미널)

`.env.local`이 `NEXT_PUBLIC_DATA_MODE=dummy`인 상태에서 `http://localhost:3000/settings/chairman`을 연다.

Expected:
- "카카오 아침 알림" 절이 보이고, **"카카오 연결" 버튼 하나**만 있다(dummy는 늘 연결 없음).
- 콘솔에 에러가 없다.
- 다른 두 절(장기 프로젝트·선언문)이 그대로 동작한다.

- [ ] **Step 6: 타입·린트·검사**

Run: `npm run typecheck && npm run lint && npm run check:kakao && npm run check:migrations`

Expected: 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add src/components/settings/kakao-connect.tsx src/lib/repository "src/app/(dashboard)/settings/chairman/page.tsx"
git commit -m "feat(kakao): /settings/chairman에 카카오 알림 절

화면이 고르는 상태는 넷이다 — 연결 없음 · 동의 없음 · refresh 만료 · 정상.
'동의 없음'을 따로 두는 이유: 카카오톡 메시지 전송이 선택 동의라 로그인은 되고
발송만 -402로 거절되는 상태가 실제로 생긴다. 그대로 두면 아침 07시에 조용히 실패한다.

access_token은 이 컴포넌트의 props에 없다. 0023 kakao_token_status()가 반환 목록에서
뺐기 때문에 실수로 넘길 방법 자체가 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 문서와 실제 검증

**Files:**
- Modify: `docs/OPERATIONS.md`
- Modify: `DEFERRED.md`

**Interfaces:**
- Consumes: Task 1~7 전부

- [ ] **Step 1: OPERATIONS의 Preview 환경변수 표에 카카오를 더한다**

`docs/OPERATIONS.md` 1절 "Vercel Preview를 staging Supabase에 붙인다"의 표 맨 아래에 세 줄을 더한다:

```markdown
| `KAKAO_REST_API_KEY` · `KAKAO_REDIRECT_URI` · `APP_BASE_URL` | **넣지 않는다** (아래 참고) |
```

그 표 아래 "알아 둘 것:" 목록에 한 줄을 더한다:

```markdown
- **Preview에서 카카오 연결은 시험하지 않는다.** 카카오 콘솔에 등록된 Redirect URI는 고정된 둘
  (production, localhost)뿐인데 Preview는 배포마다 호스트가 바뀐다. Preview에 카카오 변수를
  넣으면 연결 버튼이 KOE006으로 떨어지므로 아예 넣지 않는다 — Preview에서 정상은
  '연결 없음'이고, 야간 Job은 그때 `skipped: 카카오가 연결되어 있지 않다`로 조용히 지나간다.
  카카오까지 보려면 별도 카카오 앱과 고정 Preview URL이 필요하다(DEFERRED).
```

같은 1절의 Cron 관련 줄에서 시각을 고친다:

```markdown
- **Vercel Cron은 Production 배포에서만 돈다.** Preview에서 아침 브리핑은 저절로 돌지 않는다.
```

(기존 "야간 브리핑" 표현을 "아침 브리핑"으로 바꾸고 curl 예시는 그대로 둔다.)

그리고 production 환경변수를 다루는 자리에 카카오 4종을 더한다 — 1절 "환경변수를 넣을 때" 아래:

```markdown
Phase 3-C부터 Production에 카카오 4종이 더 필요하다. 전부 서버 전용이라 빌드에 박히지 않는다 —
값을 바꿨을 때 재빌드가 필요한 것은 `NEXT_PUBLIC_*` 셋뿐이다.

| 변수 | Production 값 |
|---|---|
| `KAKAO_REST_API_KEY` | 카카오 앱의 REST API 키 |
| `KAKAO_REDIRECT_URI` | `https://chairman-os-eosin.vercel.app/api/kakao/callback` |
| `APP_BASE_URL` | `https://chairman-os-eosin.vercel.app` |
| `KAKAO_CLIENT_SECRET` | 카카오 콘솔에서 Client Secret을 켰을 때만 |

`KAKAO_REDIRECT_URI`는 카카오 콘솔에 등록된 값과 **한 글자도 달라서는 안 된다.** 다르면 KOE006이다.
```

- [ ] **Step 2: DEFERRED.md에 이번에 고른 것과 버린 것을 남긴다**

`DEFERRED.md` 끝에 한 절을 더한다 (파일의 기존 형식을 따른다):

```markdown
## Phase 3-C — 카톡 아침 알림 (2026-09-20)

- **토큰 표를 Chairman에게도 열지 않았다.** 0019 chairman_checkins는 표를 Chairman에게 열고
  AIAgent에게만 keyhole을 줬다. 여기서는 아무에게도 안 열고 security definer 함수 넷만 문으로 뒀다.
  버린 선택지: 0019와 같은 모양(Chairman은 표 직접 읽기). 담긴 것이 건강 기록이 아니라 외부 계정의
  bearer 자격증명이라 — 새 나가면 남이 회장 이름으로 카톡을 보낸다 — 값을 읽는 코드 경로를 하나라도
  더 만들지 않았다.
- **cron을 23:00 KST에서 07:00 KST로 옮겼다.** Vercel Hobby는 cron 슬롯이 하나다. 버린 선택지:
  유료 플랜으로 슬롯 둘(밤에 생성, 아침에 발송). 돈이 드는 것은 회장에게 묻는 넷 중 하나이고,
  아침에 만들어 바로 보내는 것으로 충분하다.
- **그 결과 컨디션 keyhole을 '오늘 아니면 어제'로 넓혔다**(0023 `chairman_recent_condition()`,
  0019 `chairman_today_condition()`은 지웠다). 버린 선택지: 오늘 것만 보고 없으면 컨디션을 생략.
  07시는 회장의 아침 체크인보다 이르므로 거의 매일 생략이 돼서, 있는 정보를 버리는 쪽이 됐다.
  사흘 전 값까지 가지 않는 이유는 그것으로 "큰 결정을 미루라"고 말하는 것이 근거가 아니라 추측이라서다.
- **발송은 cron일 때만 한다.** 버린 선택지: 수동 실행에서도 발송. 수동 실행은 하루에 몇 번이고 누르는
  테스트 버튼이라 누를 때마다 카톡이 가면 알림이 아니라 소음이 된다. 대신 /settings/chairman에
  '테스트 발송'을 따로 뒀고, 그 버튼은 야간 Job과 **같은** `sendKakaoBrief()`를 부른다.
- **`KAKAO_REDIRECT_URI`를 요청 호스트에서 유도하지 않는다.** 버린 선택지: `request.nextUrl.origin` 사용.
  카카오에 등록된 URI는 고정된 둘뿐인데 Vercel Preview는 배포마다 호스트가 바뀌어 매번 KOE006이 난다.
- **Preview(staging)에서 카카오 연결은 시험하지 않는다.** 하려면 별도 카카오 앱과 고정 Preview URL이
  필요하다. **미뤘다** — Preview에서 정상은 '연결 없음'이고, 야간 Job이 그 상태를 조용히 지나가는지가
  오히려 이번에 검증할 경로다.
- **`kakao_token_clear()`는 우리 토큰만 버린다.** 카카오 쪽 연결 해제(`/v1/user/unlink`)는 부르지 않는다.
  **미뤘다** — 회장이 카카오 계정 설정에서 직접 끊을 수 있고, unlink는 되돌리는 데 재로그인이 필요하다.
- **발송 실패를 회장에게 알리지 않는다.** 감사 기록(kakao_failed)에만 남는다. **미뤘다** —
  카톡이 안 왔다는 사실을 카톡으로 알릴 수는 없고, /ai를 열면 브리핑은 거기 있다.
```

- [ ] **Step 3: 전체 검사를 돌린다**

Run:
```bash
npm run check:migrations && npm run check:kakao && npm run check:db-safety && npm run check:boundaries && npm run check:finance && npm run typecheck && npm run lint && npm run build
```

Expected: 전부 통과. 하나라도 실패하면 여기서 멈추고 고친다.

- [ ] **Step 4: 커밋**

```bash
git add docs/OPERATIONS.md DEFERRED.md
git commit -m "docs(kakao): Phase 3-C 운영 절차와 고른 이유

Preview에는 카카오 변수를 넣지 않는다 — 등록된 Redirect URI는 고정된 둘뿐인데
Preview는 배포마다 호스트가 바뀐다. Preview에서 정상은 '연결 없음'이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: 사람이 하는 검증 — 여기서 회장에게 넘긴다**

이 아래는 자동화하지 않는다. 카카오 계정 로그인은 사람이 브라우저에서 해야 하고
(CLAUDE.md 판단 원칙 3: 비밀값·자격증명·외부 계정), 원격 DB 적용은 승인이 필요하다(1번).

**5-1. 로컬에서 연결과 발송을 확인한다.**

회장이 직접 한다:
1. `.env.local`에 `KAKAO_REDIRECT_URI=http://localhost:3000/api/kakao/callback`,
   `APP_BASE_URL=http://localhost:3000`을 채운다. (`KAKAO_REST_API_KEY`는 이미 있다.)
2. `.env.local`을 잠시 `NEXT_PUBLIC_DATA_MODE=live`로 두고 `npm run dev`. — **주의:** 이때 앱은
   production Supabase를 본다. 카카오 연결은 `chairman_kakao_token`에만 쓰므로 회계 데이터는
   건드리지 않지만, 5-2에서 production에 0023을 먼저 넣어야 이 표가 존재한다.
   그래서 **순서는 5-2 → 5-1이다.**
3. `/settings/chairman` → "카카오 연결" → 카카오 로그인 →
   **"카카오톡 메시지 전송"에 체크**하고 동의 → 돌아와서 "연결됨"이 뜨는가.
4. "테스트 발송" → 카카오톡에 메시지가 오는가. 버튼을 눌러 `/ai`가 열리는가.
5. `.env.local`을 `dummy`로 되돌린다.

**5-2. staging → production 순서로 DB를 넣는다**(`docs/OPERATIONS.md` 9절).

```bash
npm run check:migrations          # 0023까지 통과하는가
npm run db:push:staging           # staging 먼저. 가드가 ref를 대조한다
```

staging Preview에서 `/settings/chairman`이 열리고 "카카오 연결" 버튼이 보이는지,
`/api/health`의 익명 `rows: 0` · `rls_closed: true`가 그대로인지 확인한다.

**여기서 실패하면 production으로 넘어가지 않는다.**

그 다음 production은 **손으로**, 승인을 받고:

```bash
supabase link --project-ref nndvspgnljivkvihxlzj
supabase db push --linked --dry-run    # 무엇이 밀려 있는지 먼저 본다
supabase db push
npm run db:push:staging                # 끝나면 link를 staging으로 되돌린다
```

**5-3. Vercel 환경변수를 넣고 배포한다.**

Production 환경에 `KAKAO_REST_API_KEY`, `KAKAO_REDIRECT_URI`, `APP_BASE_URL`,
(켰다면) `KAKAO_CLIENT_SECRET`. 전부 서버 전용이라 재빌드 없이도 적용되지만,
이번에는 코드가 바뀌었으니 어차피 새로 배포된다.

배포 후 확인 4단계(OPERATIONS 1절)를 돌린 뒤:
1. production `/settings/chairman`에서 "카카오 연결" → 로그인 → "연결됨".
2. "테스트 발송" → 카톡 수신 → 버튼으로 `/ai` 열림.
3. `vercel.json`의 cron이 `0 22 * * *`로 Vercel 대시보드에 반영됐는가.
4. 다음 날 07:00 KST에 카톡이 오는가. 안 왔으면 `audit_log`에서
   `action = 'kakao_failed'`인 행의 `note`를 본다.

---

## Task 9: 월요일 첫 줄 — "지난주 행동 리뷰 하세요 ▶"

2026-09-20 회장 추가 지시. Phase 4-C(주간 행동 리뷰)가 들어올 자리를 미리 연다.

4-C가 아직 없으므로 **이 줄은 링크가 아니라 글이다.** 카카오 텍스트 템플릿의 버튼은 하나뿐이고
그 하나는 이미 '전문 보기'가 쓰고 있다 — 4-C가 들어오면 그 버튼이 여는 `/ai`가 월요일에
주간 리뷰 카드를 먼저 보여 주게 되고(4-C 4번), 이 줄은 그때 그 화면을 가리키는 말이 된다.
지금은 "월요일 아침에 이 말이 눈에 들어오는가"만 맞으면 된다.

**Files:**
- Modify: `src/lib/kakao/message.ts`
- Modify: `src/lib/kakao/send-brief.ts`
- Modify: `scripts/check-kakao.ts`

**Interfaces:**
- Consumes: Task 2 `buildKakaoBriefText()` · `BriefTextInput`, Task 4 `sendKakaoBrief()`가 이미 들고 있는 `runDate`
- Produces: `BriefTextInput.runDate`, `MONDAY_REVIEW_LINE`, `isMonday()`

- [ ] **Step 1: `message.ts`에 요일 판정과 그 줄을 더한다**

`KAKAO_TEXT_LIMIT` 아래 상수 자리에 더한다:

```ts
/** 월요일 아침에만 맨 앞에 붙는 줄. Phase 4-C 주간 행동 리뷰가 들어올 자리다. */
export const MONDAY_REVIEW_LINE = '지난주 행동 리뷰 하세요 ▶'
```

`len()`·`cut()` 옆에, 같은 '순수 도구' 무리로 더한다:

```ts
/**
 * runDate가 월요일인가.
 *
 * runDate는 이미 KST 기준 날짜다(night-brief.ts의
 * `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })` 산출). 그래서 여기서 시간대를
 * 다시 계산하지 않는다 — 날짜 세 토막을 그대로 읽어 요일만 본다.
 *
 * Date.UTC로 직접 만드는 이유: `new Date('2026-09-21')`은 UTC로 읽히지만
 * `new Date('2026/09/21')`은 실행 환경의 시간대로 읽혀 요일이 하루 어긋난다. Vercel은 UTC,
 * 개발 기계는 KST라 그 차이가 로컬에서만 맞고 production에서 틀리는 모양으로 나온다.
 * 형식이 맞지 않으면 false — 월요일이 아닌 쪽이 안전한 기본값이다(줄이 빠질 뿐 발송은 간다).
 */
export function isMonday(runDate: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(runDate)
  if (!m) return false
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() === 1
}
```

`BriefTextInput`에 칸을 하나 더한다(`summary` 아래):

```ts
  /** 'YYYY-MM-DD', KST 기준. 월요일이면 맨 앞에 MONDAY_REVIEW_LINE이 붙는다. */
  runDate: string
```

`IsoDate`(`@/types`)를 쓰지 않고 `string`으로 두는 이유: 이 파일은 지금 import가 하나도 없다.
그래서 `scripts/check-kakao.ts`가 경로 별칭 해석 없이 tsx로 바로 이 파일을 잰다. 칸 하나 때문에
그 성질을 잃지 않는다 — 실제 값은 `send-brief.ts`에서 `IsoDate`로 좁혀져 들어온다.

- [ ] **Step 2: `buildKakaoBriefText()`가 월요일에 그 줄을 먼저 세운다**

머리글·꼬리와 **같은 등급**으로 확보한다. 본문이 밀려나도 이 줄은 남는다 — 월요일 메시지의
용건이 그 줄이기 때문이다. 200자 보장은 그대로다: 붙는 글자를 SCAFFOLD에 먼저 넣고
본문 예산을 그만큼 줄인다.

`head` 계산 바로 아래에 더하고, SCAFFOLD·return 두 줄을 고친다:

```ts
  // 월요일이면 리뷰 줄이 맨 앞에 선다. 본문보다 먼저 자리를 잡는다 —
  // 그 줄이 밀려나면 월요일 메시지는 평일 메시지와 구별되지 않는다.
  const prefix = isMonday(input.runDate) ? `${MONDAY_REVIEW_LINE}\n\n` : ''

  // 머리글과 꼬리를 먼저 확보한다. 본문이 밀려나더라도 '무슨 날이고 어디를 열면 되는가'는 남는다.
  // 긴 제목 하나로 200자를 다 먹는 경우가 있어 머리글도 자른다.
  // SCAFFOLD는 줄바꿈 넷('\n\n' 두 번)과 꼬리, 그리고 월요일이면 리뷰 줄이 차지하는 고정 비용이다.
  const SCAFFOLD = len(`${prefix}\n\n\n\n${TAIL}`)
```

```ts
  return body ? `${prefix}${safeHead}\n\n${body}\n\n${TAIL}` : `${prefix}${safeHead}\n\n${TAIL}`
}
```

`safeHead`·`budget` 두 줄은 손대지 않는다 — 이미 `SCAFFOLD`에서 값을 받는다.

- [ ] **Step 3: `send-brief.ts`가 `runDate`를 넘긴다**

`buildKakaoBriefText` 호출(한 자리뿐이다)에 칸 하나를 더한다:

```ts
  const text = buildKakaoBriefText({
    dDay: opts.dDay,
    projectTitle: opts.projectTitle,
    summary,
    runDate: opts.runDate,
  })
```

`opts.runDate`는 이미 이 함수의 인자다(`linkUrl`이 같은 값을 쓴다). 야간 Job은 KST 날짜를,
테스트 발송(`/api/kakao/test`)은 그날의 KST 날짜를 넣는다 — 월요일에 테스트 발송을 하면
월요일 메시지가 그대로 온다. 그것이 맞다. 미리 보는 것이 테스트 발송의 목적이다.

- [ ] **Step 4: `scripts/check-kakao.ts`가 이 줄을 잰다**

먼저 **기존 단언 여덟 자리 전부**에 `runDate`를 더한다. 없으면 타입 오류가 난다.
기존 단언이 재는 것은 월요일과 무관하므로 전부 화요일을 넣는다 — 파일 위쪽에 상수로:

```ts
const TUE = '2026-09-22' // 화요일. 리뷰 줄이 없는 평범한 날.
const MON = '2026-09-21' // 월요일.
```

기존 여덟 자리는 전부 `TUE`다. 하나도 `MON`으로 바꾸지 않는다 — 그 단언들은 머리글이
맨 앞에 온다고 단언하고 있어서, 월요일로 바꾸면 이 Task와 무관한 이유로 깨진다.
월요일의 자르기는 아래 단언 11이 따로 잰다.

그리고 끝의 `console.log` 앞에 단언 넷을 더한다:

```ts
// 9. 월요일이면 리뷰 줄이 맨 앞에 온다. 4-C 주간 리뷰가 들어올 자리다.
{
  const text = buildKakaoBriefText({
    dDay: 'D-780', projectTitle: '회장직 승계', summary: '오늘은 조용하다.', runDate: MON,
  })
  assert.ok(
    text.startsWith(`${MONDAY_REVIEW_LINE}\n\n☀️ D-780 · 회장직 승계\n\n`),
    `월요일 첫 줄이 다르다: ${JSON.stringify(text)}`,
  )
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '월요일에 꼬리를 잃었다')
}

// 10. 다른 요일에는 그 줄이 없다. 일요일·화요일 둘 다 본다 — 경계가 월요일 하루인지 확인한다.
{
  for (const day of ['2026-09-20', TUE, '2026-09-26']) {
    const text = buildKakaoBriefText({
      dDay: 'D-780', projectTitle: '회장직 승계', summary: '오늘은 조용하다.', runDate: day,
    })
    assert.ok(!text.includes(MONDAY_REVIEW_LINE), `${day}에 리뷰 줄이 붙었다`)
    assert.ok(text.startsWith('☀️ D-780'), `${day} 머리글이 다르다: ${JSON.stringify(text)}`)
  }
}

// 11. 월요일에도 200자를 넘지 않는다. 리뷰 줄은 본문보다 먼저 자리를 잡는다 —
//     긴 요약에 밀려 사라지지 않고, 대신 본문이 그만큼 줄어든다.
//     한 문장으로 예산을 넘겨 '문장 단위'가 아니라 '글자 단위'로 잘리게 만든다 —
//     그래야 줄어든 양을 정확히 잴 수 있다(문장 단위로 자르면 경계가 들쭉날쭉하다).
{
  const flood = '가'.repeat(300) + '.'
  const mon = buildKakaoBriefText({
    dDay: 'D-780', projectTitle: '회장직 승계', summary: flood, runDate: MON,
  })
  const tue = buildKakaoBriefText({
    dDay: 'D-780', projectTitle: '회장직 승계', summary: flood, runDate: TUE,
  })

  assert.ok(len(mon) <= KAKAO_TEXT_LIMIT, `월요일 ${len(mon)}자 — 200자를 넘었다`)
  assert.ok(mon.startsWith(`${MONDAY_REVIEW_LINE}

`), '자르다가 월요일 줄을 잃었다')
  assert.ok(mon.endsWith('

▶ 전문 보기'), '자르다가 꼬리를 잃었다')

  const monBody = mon.split('

')[2]
  const tueBody = tue.split('

')[1]
  assert.equal(
    len(tueBody) - len(monBody),
    len(MONDAY_REVIEW_LINE) + 2,
    '리뷰 줄이 차지한 만큼 본문이 줄지 않았다',
  )
}

// 12. 날짜 형식이 아니면 월요일로 보지 않는다 — 줄이 빠질 뿐 발송은 간다.
//     그리고 실행 환경의 시간대가 요일을 흔들지 못한다(Date.UTC로 읽는다).
{
  assert.equal(isMonday('2026-09-21'), true)
  assert.equal(isMonday('2026/09/21'), false)
  assert.equal(isMonday(''), false)
  assert.equal(isMonday('2026-09-21T07:00:00+09:00'), false)
}
```

import 줄에 `MONDAY_REVIEW_LINE`과 `isMonday`를 더한다.
마지막 `console.log` 문구에 `· 월요일 리뷰 줄`을 덧붙인다.

- [ ] **Step 5: Self-Review**

```bash
npm run check:kakao     # 단언 전부 통과
npm run typecheck
npm run lint
```

`npm run check:kakao`를 **TZ를 바꿔서 한 번 더** 돌린다 — 요일 계산이 실행 환경에 흔들리지 않는 것이
이 Task에서 유일하게 조용히 틀릴 수 있는 자리다:

```bash
TZ=UTC npm run check:kakao
TZ=Pacific/Kiritimati npm run check:kakao   # UTC+14
TZ=Pacific/Midway npm run check:kakao       # UTC-11
```

세 번 다 같은 결과여야 한다.

---

## Self-Review

**1. 스펙 대조**

| 스펙 | 어디서 |
|---|---|
| 0023 `chairman_kakao_token` (user_id, access_token, refresh_token, expires_at, refresh_expires_at) | Task 1 Step 1 |
| Chairman만 · 서버에서만 읽기 | Task 1 — `revoke all` + RLS + 함수 넷. `kakao_token_status()`는 토큰을 반환하지 않는다 |
| `/settings/chairman`에 "카카오 연결" 버튼 | Task 7 Step 2·3 |
| `/api/kakao/auth` → scope `talk_message` | Task 5 Step 1, Task 3 `authorizeUrl()` |
| `/api/kakao/callback`에서 토큰 저장 | Task 5 Step 2 |
| refresh_token으로 자동 갱신 | Task 4 `tryRefresh()` — 만료 5분 전 선제 갱신 + -401 재시도 |
| 만료·해제 시 "다시 연결" 표시 | Task 7 Step 2 — `expired` / `scopeMissing` 두 갈래 |
| `sendKakaoBrief()`가 야간 Job 마지막 단계 | Task 6 Step 5(d) |
| 메시지 형식 `☀️ D-{n} · {제목}` + 2~3문장 + `▶ 전문 보기` | Task 2 `buildKakaoBriefText()` |
| `/ai` 링크 버튼 | Task 4 `sendKakaoMemo()` — `button_title: '전문 보기'` |
| 텍스트 템플릿(object_type text), 200자 자르기 | Task 2 `KAKAO_TEXT_LIMIT`, Task 4 `templateObject` |
| 실패해도 Job은 성공 | Task 4 — 모든 경로가 결과를 돌려준다. Task 6 — `report`를 건드리지 않는다 |
| `audit_log` kakao_sent / kakao_failed | Task 1 Step 1(1절), Task 4 `done()` |
| cron을 07:00 KST로, `vercel.json` 수정 | Task 6 Step 1 |
| 체크인 없으면 전날 값 또는 미입력 | Task 1 Step 1(5절), Task 6 Step 2·3·4·5(e) |
| "테스트 발송" 버튼 | Task 5 Step 3, Task 7 Step 2 |
| 월요일 첫 줄 "지난주 행동 리뷰 하세요 ▶" (4-C 주간 리뷰 연동 자리) | Task 9 Step 1·2 |
| 검증: 연결 → 테스트 발송 → 수신 → 커밋 → staging → production 승인 요청 | Task 8 Step 5 |
| Vercel 환경변수 이름 출력 | Global Constraints의 표, Task 8 Step 1 |

빠진 스펙 항목 없음.

**2. 플레이스홀더**

"TBD"·"적절히 처리"·"Task N과 비슷하게" 없음. 코드 단계는 전부 실제 코드를 싣는다.
Task 5 Step 3, Task 7 Step 2·3에 "실제 필드명/아이콘 이름을 확인하고 맞춘다"가 있는데,
이것은 미완성 지시가 아니라 **확인 단계**다 — 이 계획을 쓰는 시점에 `currentUser()`의 반환 타입과
`Icon`의 이름 목록을 열어 보지 않았고, 틀린 이름을 단정해 싣는 것보다 확인하라고 적는 쪽이 정확하다.

**3. 타입 일관성**

- `getRecentCondition()`은 Task 1(SQL: `(condition, checkin_date)`), Task 6 Step 2(interface·supabase·dummy),
  Task 6 Step 5(e)(호출부)에서 같은 모양이다.
- `ChairmanContext['checkin']`은 `{ condition, as_of }` — Task 6 Step 3에서 정의하고 Step 5(e)에서 그대로 만든다.
- `sendKakaoBrief()`의 인자 이름은 Task 4에서 정의하고 Task 5 Step 3·Task 6 Step 5(d)에서 같게 쓴다.
- `kakao_token_refreshed`의 인자 이름(`p_access`, `p_expires`, `p_refresh`, `p_refresh_expires`)은
  Task 1 SQL과 Task 4 `tryRefresh()`에서 같다. `kakao_token_save`의 다섯 개도 Task 1과 Task 5 Step 2에서 같다.
- `KakaoConnection`은 Task 2에서 정의하고 Task 7의 repository·컴포넌트에서 같은 칸을 쓴다.
- `buildKakaoBriefText`의 인자는 `{ dDay, projectTitle, summary }` — Task 2 정의, Task 4 호출에서 같다.

---

## 부록 A — 원문 스펙

> [Phase 3-C — 카톡 아침 알림]
>
> 카카오 "나에게 보내기" API. REST 키는 KAKAO_REST_API_KEY (.env.local에 있음).
> 카카오 앱 리다이렉트 URI 등록됨: https://chairman-os-eosin.vercel.app/api/kakao/callback, http://localhost:3000/api/kakao/callback
> 동의항목 "카카오톡 메시지 전송" 선택동의 설정됨.
>
> 1) 0023: chairman_kakao_token (user_id, access_token, refresh_token, expires_at, refresh_expires_at). Chairman만. 서버에서만 읽기.
> 2) /settings/chairman에 "카카오 연결" 버튼 → /api/kakao/auth → 카카오 로그인(scope: talk_message)
>    → /api/kakao/callback에서 토큰 저장. refresh_token으로 자동 갱신. 만료·해제 시 "다시 연결" 표시.
> 3) sendKakaoBrief(): 야간 Job 마지막 단계.
>    메시지: "☀️ D-{n} · {프로젝트 제목}\n\n{그룹 브리핑 summary 첫 2~3문장}\n\n▶ 전문 보기" + /ai 링크 버튼.
>    카카오 텍스트 템플릿(default template, object_type text). 200자 제한 고려해 자르기.
>    실패해도 Job은 성공. audit_log kakao_sent / kakao_failed.
> 4) cron 시각: Vercel Hobby는 cron 1개 → 기존 23시 Job을 07:00 KST(22:00 UTC)로 옮겨 생성+발송 한 번에. vercel.json 수정.
>    회장 체크인이 07시 이전에 없으면 컨디션은 전날 값 또는 "미입력"으로.
> 5) /settings/chairman에 "테스트 발송" 버튼.
>
> 검증: 카카오 연결(내가 브라우저에서 로그인) → 테스트 발송 → 수신 확인 → 커밋 → staging → production 승인 요청.
> Vercel에 넣을 환경변수 이름 출력.

**2026-09-20 추가 지시** (Task 9):

> 계획에 한 줄 추가: 월요일 카톡 메시지는 "지난주 행동 리뷰 하세요 ▶" 를 첫 줄에 (4-C 주간 리뷰 연동 자리).
> 끝나면 master 병합 → staging → production 승인 요청. 카카오 로그인은 내가 한다.
