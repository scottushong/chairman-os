-- Synthetic, disposable fixtures. Never a production migration or automatic CLI seed.
begin;
do $$ begin
  if current_setting('chairman.validation_environment', true) is distinct from 'local' then
    raise exception 'Refused: guarded local runner required';
  end if;
end $$;

-- Remove bundled historical demo rows only inside the dedicated disposable database.
-- TRUNCATE here is fixture setup, not an application audit deletion capability.
truncate public.businesses, public.user_profiles, public.user_settings,
  public.user_business_access, public.user_module_access, public.user_invitations,
  public.audit_log restart identity cascade;

insert into public.businesses (business_id, name, industry, status)
values ('test_a', 'Synthetic A', 'Test', 'Active'), ('test_b', 'Synthetic B', 'Test', 'Active');

-- JWT-only synthetic actors; no usable password or customer identity is installed.
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'actor' || n || '@example.invalid',
  '{}'::jsonb, '{}'::jsonb, now(), now()
from generate_series(1, 5) n on conflict (id) do nothing;

insert into public.user_profiles (user_id, role, display_name, max_security_class)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case when n = 1 then 'Chairman' else 'Executive' end)::app_role,
  'Synthetic actor ' || n,
  (case n when 2 then 'Normal' when 3 then 'Restricted' else 'Vault' end)::security_class
from generate_series(1, 5) n;

insert into public.user_business_access (user_id, business_id)
select user_id, 'test_a' from public.user_profiles where display_name in
  ('Synthetic actor 2', 'Synthetic actor 3', 'Synthetic actor 4');
-- A low-classification writer is essential to reproduce the former FOR ALL bypass.
insert into public.user_module_access (user_id, module, can_write)
select user_id, '/core/search', true from public.user_profiles;

insert into public.projects (project_id, business_id, name, deadline)
select 'test_project_' || lpad(n::text, 4, '0'), 'test_a', 'Synthetic project ' || n,
  case when n % 2 = 0 then null else date '2030-01-31' end
from generate_series(1, 1203) n;
insert into public.projects (project_id, business_id, name, deadline)
values ('test_project_other', 'test_b', 'Synthetic other scope', null);

insert into public.tasks (task_id, project_id, title, deadline, blocked_since, chairman_needed)
select 'test_task_' || lpad(n::text, 4, '0'), 'test_project_0001', 'Synthetic task ' || n,
  case when n % 2 = 0 then null else date '2030-01-31' end, date '2030-01-01', true
from generate_series(1, 1203) n;
insert into public.tasks (task_id, project_id, title, deadline)
values ('test_task_other', 'test_project_other', 'Synthetic other scope', null);

insert into public.documents (document_id, business_id, title, doc_type, security_class, storage_url)
select 'test_doc_' || b || '_' || lower(c), 'test_' || b,
  'Synthetic ' || c || ' document', 'Test', c::security_class, 'https://example.invalid/fixture'
from unnest(array['a','b']) b cross join unnest(array['Normal','Restricted','Vault']) c;

insert into public.decisions (decision_id, business_id, title, options, deadline, status)
values ('test_decision_open', 'test_a', 'Synthetic open decision', array['A','B'], '2030-01-31', 'Open'),
  ('test_decision_terminal', 'test_a', 'Synthetic terminal decision', array['A','B'], '2030-01-31', 'Approved');
insert into public.audit_log (actor_user_id, actor_role, action, entity_table, entity_id, business_id, note)
values ('00000000-0000-4000-8000-000000000001', 'Chairman', 'approve', 'decisions',
  'test_decision_terminal', 'test_a', 'Synthetic terminal fixture; not an actual approval.');
commit;
