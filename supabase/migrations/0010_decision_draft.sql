-- =====================================================================
-- Chairman OS — 0010_decision_draft
-- 출처: 02_기능명세 CH-041 전자결재(기안) / DEFERRED D-10 선택지 A
-- 작성: Phase 1-D (2026-09-07)
--
-- 무엇이 없어서 만드나
--   0006이 decisions.attachment_url을 만들었지만 값을 넣는 화면이 없었다(D-10).
--   첨부는 결재를 '올릴 때' 거는 값이라 기안 화면이 먼저다. 그 화면을 만들면서 걸린 것이
--   decision_id다 — 0001의 decisions.decision_id는 text PK인데 default가 없다.
--
--   앱이 max+1을 계산하면 동시에 두 사람이 올릴 때 같은 번호가 난다.
--   0007이 documents에서 이미 같은 문제를 시퀀스로 풀었다. 같은 문제를 두 가지 방법으로
--   풀면 다음 사람이 '이 프로젝트는 id를 어떻게 발급하나'에 두 번 답해야 한다.
--
-- 왜 5부터인가
--   0003_seed가 dec_001~dec_004를 넣었다. 시퀀스가 1부터 시작하면 첫 기안이
--   dec_001로 나가 중복 키로 죽는다. setval로 시드 뒤에 세운다.
--   setval을 하드코딩하지 않고 현재 최대값에서 뽑는다 — 시드가 늘어난 DB에서도 맞아야 한다.
--
-- RLS는 손대지 않는다. decisions_create(0002)가 이미 있다:
--   has_business(business_id) and can_module('/chairman/decisions', true)
--   Chairman은 can_module이 무조건 참이라 통과하고, 나머지는 user_module_access에
--   /chairman/decisions 쓰기 권한이 있어야 기안할 수 있다.
-- =====================================================================

create sequence decisions_dec_seq owned by decisions.decision_id;

-- 시드가 쓴 만큼 건너뛴다. dec_004까지 있으면 다음 nextval이 5다.
-- coalesce의 0은 시드가 하나도 없는 DB(신규 환경)를 위한 것이다. is_called=false라 첫 값이 1이 된다.
select setval(
  'decisions_dec_seq',
  coalesce((select max(substring(decision_id from 'dec_(\d+)$')::int) from decisions), 0),
  (select exists (select 1 from decisions where decision_id ~ '^dec_\d+$'))
);

alter table decisions
  alter column decision_id set default 'dec_' || to_char(nextval('decisions_dec_seq'), 'FM000');

-- default 안에서만 쓰인다. 값을 직접 읽는 경로는 없다(0007과 같다).
grant usage on sequence decisions_dec_seq to authenticated;

comment on column decisions.decision_id is
  'dec_001 형태. 0010부터 시퀀스가 발급한다 — 앱이 max+1을 계산하면 동시 기안에서 번호가 겹친다.';

-- 확인:
--   select last_value, is_called from decisions_dec_seq;
--   select decision_id from decisions order by decision_id desc limit 3;
