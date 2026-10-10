-- =====================================================================
-- Chairman OS — 0060_approval_read_authenticated (0059 읽기 정책을 로그인한 사람에게만)
-- 작성: 2026-10-10 (긴급 수정 — 0059 production 반영 뒤 /api/health(anon)가 ok:false)
--
-- ■ 무엇이 고장났나 ■
--   0059 6절의 읽기 정책 넷(decisions_chain_read · decisions_ledger_read · decisions_lead_read · approval_steps_read)에
--   `to` 절이 없다 → 대상이 public, 곧 anon도 포함이다. 정책 식이 부르는 함수 둘
--   (in_approval_chain · approval_ledger_grant)은 0059가 anon에게서 execute를 걷었다.
--   Postgres는 함수 execute 권한을 **행을 읽기 전, 식을 준비할 때** 잰다 — is_active()가 false여서 결과가 0행이
--   되더라도 판정 전에 «42501 permission denied for function approval_ledger_grant»로 멈춘다.
--   그래서 anon의 `select … from decisions`(/api/health)는 0행이 아니라 오류다. 로그인한 직원 · 대표는 두 함수 모두
--   execute가 있어 영향이 없다(check:migrations anonHealth — BYPASSRLS 없는 소유자로 Member · TeamLead · BusinessCEO ·
--   대장 열람자 경로를 잰다).
--
-- ■ 0059 정책 × 함수 × 권한 전수 ■
--   정책                                   표               대상(0059)  부르는 함수(anon execute)
--   decisions_chain_read                   decisions        public      is_active ✓ · has_business ✓ · in_approval_chain ✗
--   decisions_ledger_read                  decisions        public      is_active ✓ · has_business ✓ · auth_role ✓ · approval_ledger_grant ✗
--   decisions_lead_read                    decisions        public      is_active ✓ · has_business ✓
--   approval_steps_read                    approval_steps   public      is_active ✓ (+ decisions RLS) — anon은 표 권한부터 없다
--   attachments_approval_insert/delete     attachments      public      approval_attachment_ok ✗ — restrictive, anon은 표 권한부터 없다(0045)
--   attachments_objects_approval_*         storage.objects  public      approval_object_ok ✓(일부러 — storage 요청은 anon일 수 있다)
--   authenticated는 위 함수 전부 execute ✓.
--
-- ■ 고치는 방식 — (가) 정책을 `to authenticated`로 좁힌다 ■
--   (나) «함수가 anon이면 false + anon에 execute»보다 닫힌 쪽이다:
--     · anon에게는 decisions · approval_steps의 읽기 정책이 **하나도 걸리지 않는다** → 기본 거부, 함수는 불리지도 않는다.
--     · (나)는 결재선 · 대장 판정 함수를 anon RPC(/rest/v1/rpc/…)로 연다. 값이 false여도 «이 함수가 있다 · 무엇을 받는다»가
--       밖에 열리고, 다음 사람이 함수 본문을 고치다 anon 분기를 놓치면 그대로 샌다.
--   restrictive 첨부 정책 · storage 정책은 그대로 둔다(anon은 표 권한에서 이미 막히고, storage 쪽은 anon execute가 있다).
--
-- ■ 지키는 것 ■ 정책 식은 0059와 한 글자도 다르지 않다 — 대상만 바뀐다. 0001~0059를 고치지 않는다(정책은 drop/create).
--   force를 새로 걸지 않는다(0035). 0061~(원가 엔진)의 객체를 건드리지 않는다.
--   «결산 잠정» 제안 번호였던 0060은 이 파일이 쓴다 — 그 제안은 0068 이후로 옮겼다.
-- =====================================================================

begin;

drop policy if exists decisions_chain_read on decisions;
create policy decisions_chain_read on decisions for select to authenticated
  using (is_active() and step_chain and has_business(business_id) and in_approval_chain(decision_id));

drop policy if exists decisions_ledger_read on decisions;
create policy decisions_ledger_read on decisions for select to authenticated
  using (is_active() and template_key is not null and has_business(business_id)
         and (auth_role()::text = 'Chairman' or approval_ledger_grant(business_id)));

drop policy if exists decisions_lead_read on decisions;
create policy decisions_lead_read on decisions for select to authenticated
  using (is_active() and has_business(business_id) and approval_line->0->>'user_id' = auth.uid()::text);

drop policy if exists approval_steps_read on approval_steps;
create policy approval_steps_read on approval_steps for select to authenticated
  using (is_active() and exists (select 1 from decisions d where d.decision_id = approval_steps.decision_id));

commit;
