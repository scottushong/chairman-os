-- =====================================================================
-- Chairman OS — 0019_chairman_checkins
-- 출처: Phase 5 글래스 리디자인 (P5-5a), 상단 3칸 중 '오늘 체크인' 칸(P5-5c)
-- 작성: Phase 5 (2026-09-19)
--
-- 무엇이 없어서 만드나
--   회장이 아침에 몸 상태를 기록할 자리가 없다. 컨디션이 나쁜 날에도 대시보드는 어제와
--   똑같이 '오늘 회장이 먼저 봐야 할 것'을 들이민다. 컨디션·수면·체중·식사를 하루 한 행으로
--   받아 두면, 나중에(P5-5d) 야간 브리핑이 "오늘은 큰 결정을 미루라"고 권할 근거가 생긴다.
--   checkin_date를 기본키로 둔 것은 하루 한 번이면 충분하기 때문이다 — 몇 번을 고쳐도 그날의
--   행은 하나다(chairman_manifesto가 id=1 한 행인 것과 같은 절제다).
--
-- 권한 — 0014/0017의 다른 표와 다르다. AIAgent에게도 표 자체는 주지 않는다
--   Chairman   읽기 · 쓰기 (표 자체)
--   그 외 전부  없음. GroupCFO도, **AIAgent도** 표에는 SELECT 문 한 줄도 못 던진다.
--
--   0014 chairman_manifesto/chairman_projects는 AIAgent에게 읽기를 준다 — 야간 브리핑이 선언문의
--   원칙과 장기 프로젝트를 직접 읽어 우선순위를 매겨야 하기 때문이다. 0017 initiatives도 같은
--   이유로 AIAgent가 읽는다. 이 표는 그 전례를 따르지 않는다 — 야간 브리핑이 컨디션 값을
--   못 쓰는 게 아니라(P5-5d에서 쓴다), **표를 직접 읽지 않고 keyhole 하나로 받는다**는 뜻이다.
--
--   (P5-5d 1라운드 수정 — 처음엔 "night-brief.ts가 Chairman 세션으로 listRecentCheckins(1)을
--   부른다"고 적었는데 틀렸다. 야간 Job은 매일 23:00 KST에 사람 없이 cron으로 도는 게
--   기본 경로다 — 빌려 올 회장 세션 자체가 없다. 그래서 세션을 바꾸는 대신 3절의
--   chairman_today_condition()을 표의 유일한 문으로 둔다: 오늘 condition 정수 하나만,
--   Chairman과 AIAgent에게만 내준다. sleep_hours·weight_kg·meal_note는 그 함수의 반환값에
--   아예 없다 — 반환하지 않은 값은 모델 프롬프트로도 새어 나갈 수 없다.) AIAgent라는 역할
--   자체는 여전히 표에 SELECT 문 한 줄도 못 던진다 — 그 사람이 아니라 그 사람이 쓴 코드에게
--   상시로 열린 테이블 접근권을 주지 않겠다는 판단이다. 그래서 이 비대칭은 실수로 빠뜨린 게
--   아니라 의도한 경계다.
--
-- 왜 이 표는 회사 데이터가 아닌가 — Vault 성격
--   체중과 수면은 회장 개인의 건강 기록이다. GroupCFO가 어느 회사의 이번 달 실적을 몰라서는
--   안 되지만, 회장이 어젯밤 몇 시간을 잤는지 어느 임원도 알 이유가 없다. 0017이
--   initiative_notes(회장의 판단)를 initiatives 밖으로 뺀 것과 같은 절제이고, 그 표의
--   note 칸에 붙인 [Vault 성격] 태그를 여기 sleep_hours·weight_kg에도 그대로 붙인다.
--   시드가 없는 이유도 같다 — 회장의 몸 상태가 git에 들어가면 저장소를 읽는 모든 사람이 읽는다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 표
--    condition은 DB에서도 1~5로 가둔다 — TypeScript 리터럴 유니온(1|2|3|4|5)만 믿으면
--    직접 SQL을 만지는 순간(백필·수기 보정) 6이나 0이 그대로 들어간다.
-- ---------------------------------------------------------------------
create table chairman_checkins (
  checkin_date date primary key,                                   -- [일반] 하루 한 행
  condition    smallint not null,                                  -- [제한] 1(나쁨)~5(좋음) 자기 평가
  sleep_hours  numeric(3,1),                                       -- [Vault 성격] 회장 개인 건강 기록이다. null = 기록 없음
  weight_kg    numeric(4,1),                                       -- [Vault 성격] 회장 개인 건강 기록이다. null = 기록 없음
  meal_note    text not null default '',                           -- [제한] 자유 메모
  updated_at   timestamptz not null default now(),                 -- [일반]
  constraint chairman_checkins_condition check (condition between 1 and 5)
);

comment on table chairman_checkins is
  'Phase 5 P5-5a. 회장의 아침 체크인(컨디션·수면·체중·식사). 회사 데이터가 아니라 회장 개인의 건강 기록이라 Chairman 전용이다 — GroupCFO도, AIAgent도 이 표를 직접 읽지 못한다. 야간 브리핑은 앱이 읽어 넘겨 준 값만 쓴다(P5-5d).';
comment on column chairman_checkins.sleep_hours is
  '[Vault 성격] 회장 개인 건강 기록이다. 0017 initiative_notes.note와 같은 등급 — 회사 데이터가 아니라 회장 개인의 기록이다.';
comment on column chairman_checkins.weight_kg is
  '[Vault 성격] 회장 개인 건강 기록이다. 0017 initiative_notes.note와 같은 등급 — 회사 데이터가 아니라 회장 개인의 기록이다.';

create trigger chairman_checkins_updated_at before update on chairman_checkins
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 2. RLS — Chairman 전용. 0017 initiative_notes_all과 같은 모양이다.
-- ---------------------------------------------------------------------
alter table chairman_checkins enable row level security;
alter table chairman_checkins force  row level security;

create policy chairman_checkins_all on chairman_checkins for all
  using (is_active() and auth_role() = 'Chairman')
  with check (is_active() and auth_role() = 'Chairman');

-- Integration 쓰기 차단을 restrictive로 한 번 더 건다(0017 initiative_notes와 같은 방식).
-- 위의 permissive 정책만으로도 이미 막히지만(Integration은 Chairman이 아니므로), 나중에 누가
-- permissive 정책을 느슨하게 고쳐도 이 방어선은 남는다.
do $$
begin
  execute format(
    'create policy integration_no_insert on public.%I as restrictive for insert
       with check (not is_integration())', 'chairman_checkins');
  execute format(
    'create policy integration_no_update on public.%I as restrictive for update
       using (not is_integration()) with check (not is_integration())', 'chairman_checkins');
  execute format(
    'create policy integration_no_delete on public.%I as restrictive for delete
       using (not is_integration())', 'chairman_checkins');
end
$$;

-- ---------------------------------------------------------------------
-- 3. 야간 브리핑용 keyhole (P5-5d 1라운드 수정)
--    표는 여전히 Chairman 전용이다. 이 함수는 그 예외를 표 전체가 아니라 값 하나로 좁힌다 —
--    security definer로 표의 RLS를 우회하되, 0017 can_read_initiatives()와 같은 모양으로
--    함수 몸통 안에서 스스로 같은 만큼만(누가/무엇을) 판정한다.
--
--    반환값은 오늘 condition 하나, 그 외는 전부 null이다 — 역할이 Chairman/AIAgent가 아니거나,
--    맞는 역할이라도 오늘 행이 없으면 함수는 조용히 null을 준다(예외를 던지지 않는다). 표가
--    처음부터 지켜 온 "없는 것과 못 읽는 것을 구분하지 않는다"는 계약을 함수도 그대로 물려받는다.
--
--    current_date를 안 쓰는 이유 — Postgres의 current_date는 서버 세션 시간대(보통 UTC) 기준이다.
--    KST 00:00~09:00 사이에는 UTC로 아직 어제라서, current_date를 쓰면 23:00 KST에 도는 야간
--    Job이 그 시간대에도 어제 체크인을 "오늘 것"으로 잘못 읽는다. 이 앱의 '오늘'은 늘 KST다
--    (src/lib/chairman-project.ts kstToday(), 0016 v_today_period와 같은 계산) — SQL에서는
--    그 계산을 (now() at time zone 'Asia/Seoul')::date로 그대로 옮긴다.
-- ---------------------------------------------------------------------
create or replace function chairman_today_condition() returns smallint
language sql stable security definer set search_path = public as $fn$
  select condition
    from chairman_checkins
   where checkin_date = (now() at time zone 'Asia/Seoul')::date
     and is_active()
     and auth_role() in ('Chairman', 'AIAgent');
$fn$;

comment on function chairman_today_condition() is
  'P5-5d 1라운드 수정. chairman_checkins의 유일한 keyhole. 오늘(KST) condition 정수 하나만, Chairman과 AIAgent에게만 내준다 — 그 외 역할이거나 오늘 기록이 없으면 null. sleep_hours·weight_kg·meal_note는 반환값에 아예 없다.';

-- Postgres는 새 함수의 execute 권한을 public에 기본으로 준다. security definer 함수에서는
-- 그 기본값이 곧 "anon도 RPC로 부를 수 있다"는 뜻이다. 이 함수 본문이 auth_role()로 걸러
-- anon에게는 null만 돌려주므로 새는 값은 없지만, 건강 기록을 지키는 유일한 keyhole에
-- 기본 권한을 남겨 두지 않는다 — 나중에 본문이 한 줄 바뀌는 날 그 기본값이 구멍이 된다.
-- 먼저 걷어내고 필요한 역할에만 다시 준다(revoke는 public 기본값만 걷는다 — 아래 grant와
-- 서로 지우지 않는다). 이 저장소에서 revoke를 쓰는 첫 함수다.
revoke all on function chairman_today_condition() from public;
grant execute on function chairman_today_condition() to authenticated;

commit;
