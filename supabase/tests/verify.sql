-- Executed as postgres only to establish session identities; assertions run as authenticated/anon.
begin;
do $$ begin
  if current_setting('chairman.validation_environment', true) is distinct from 'local' then
    raise exception 'Refused: guarded local runner required';
  end if;
end $$;
create function pg_temp.check_true(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'D-17 assertion failed: %', label; end if;
end $$;

select pg_temp.check_true(not exists (select 1 from pg_policies where schemaname = 'public'
  and tablename = 'documents' and (cmd = 'ALL' or policyname = 'documents_write')), 'no documents FOR ALL policy');
select pg_temp.check_true((select count(*) = 4 from pg_policies where schemaname = 'public'
  and tablename = 'documents' and policyname in
  ('documents_read','documents_insert','documents_update','documents_delete')), 'command-specific document policies');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select pg_temp.check_true(can_module('/core/search', true), 'Normal actor is a writer');
select pg_temp.check_true((select count(*) = 1 from documents), 'Normal writer cannot read Restricted/Vault');
select pg_temp.check_true((select count(*) = 1203 from tasks), 'task scope');
select pg_temp.check_true((select count(*) = 1203 from projects), 'project scope');
select pg_temp.check_true((select count(*) = 601 from tasks where deadline is null), 'nullable tasks');
select pg_temp.check_true((select count(*) = 601 from projects where deadline is null), 'nullable projects');
select pg_temp.check_true((select count(*) = 0 from businesses where business_id = 'test_b'), 'other business hidden');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select pg_temp.check_true((select count(*) = 2 from documents), 'Restricted actor sees two classes');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select pg_temp.check_true((select count(*) = 3 from documents), 'Vault actor remains scoped');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';
select pg_temp.check_true((select count(*) = 0 from documents), 'Vault without business scope sees nothing');
select pg_temp.check_true((select count(*) = 0 from tasks), 'no business scope tasks');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select pg_temp.check_true((select count(*) = 6 from documents), 'Chairman sees all fixture classes/scopes');
select pg_temp.check_true((select count(*) = 1 from decisions where status = 'Open'), 'Open decision fixture');
select pg_temp.check_true((select count(*) = 1 from decisions where status = 'Approved'), 'terminal fixture');
select pg_temp.check_true((select count(*) = 1 from audit_log), 'synthetic audit fixture');

reset role;
set local request.jwt.claim.sub = '';
set local role anon;
select pg_temp.check_true((select count(*) = 0 from documents), 'anonymous documents closed');
select pg_temp.check_true((select count(*) = 0 from tasks), 'anonymous tasks closed');
rollback;
