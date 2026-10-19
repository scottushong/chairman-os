-- =====================================================================
-- 0087 staging 검사(전자결재) — 쓰지 않는다.
-- build-staging-dryrun.mjs --tests가 0087과 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
-- 사람(이 시험 안에서만): A = rehearsal.member@example.com(기안) · B = rehearsal.staff@example.com(검토 · 후속) · 대표(역할 단계).
-- 기대: ERROR  0087 STAGING PASS a(스위치) b(상신 검증) c(내 차례만) d(권한 · 사유) e(중간 승인 · 재시도 · 두 탭) f(반려 · 재상신 · 승인 · 후속) g(첨부 권한) h(회수) i(건수 = 목록) j(anon 0)
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_a     uuid;
  v_b     uuid;
  v_out   text := '';
  d1      uuid;
  v2      uuid;
  w       uuid;
  n       int;
  t       text;
  j       jsonb;
  biz     text := 'biz_dy';
  ln      jsonb;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_a from auth.users u join public.user_profiles p on p.user_id = u.id where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  select u.id into v_b from auth.users u join public.user_profiles p on p.user_id = u.id where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  if v_chair is null or v_a is null or v_b is null then raise exception 'FAIL 준비: 대표(%) · A(%) · B(%)', v_chair, v_a, v_b; end if;
  insert into public.user_business_access (user_id, business_id) values (v_a, biz), (v_b, biz) on conflict do nothing;
  ln := jsonb_build_array(jsonb_build_object('user_id', v_b, 'kind', 'approve'), jsonb_build_object('role', 'Chairman', 'kind', 'approve'));

  -- ── a. 기본은 대표만 — A는 못 쓴다 → 대표가 회사 줄을 켠다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  begin
    perform public.ea_save_draft(null, biz, 'general', 't', 'b', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, null, null);
    raise exception 'FAIL a: 스위치 꺼진 회사에서 직원이 작성';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('approvals', biz, true, 'all', 'staging 시험(되돌림)');
  reset role;
  v_out := v_out || 'a(스위치) ';

  -- ── b. 상신 검증 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  d1 := public.ea_save_draft(null, biz, 'purchase', '시험 구매품의', '내용', '{"item":"소모품","qty":"10","vendor":"가","purpose":"정비","supply":"320000","vat":"32000","total":"350000"}'::jsonb,
                             ln, '[]'::jsonb, '2000-01-01', null, v_b, null);
  begin
    perform public.ea_submit(d1, 'stg-sub-0001');
    raise exception 'FAIL b: 합계가 틀린데 상신';
  exception when others then if sqlerrm <> 'ea_total' then raise; end if;
  end;
  perform public.ea_save_draft(d1, biz, 'purchase', '시험 구매품의', '내용', '{"item":"소모품","qty":"10","vendor":"가","purpose":"정비","supply":"320000","vat":"32000","total":"352000"}'::jsonb,
                               ln, '[]'::jsonb, '2000-01-01', null, v_b, null);
  begin
    perform public.ea_submit(d1, 'stg-sub-0002');
    raise exception 'FAIL b: 첨부 없이 상신';
  exception when others then if sqlerrm <> 'ea_attachment' then raise; end if;
  end;
  insert into storage.objects (bucket_id, name, owner) values ('ea-files', d1::text || '/q.pdf', v_a);
  perform public.ea_file_add(d1, d1::text || '/q.pdf', '견적서.pdf', 1000, 'application/pdf');
  t := public.ea_submit(d1, 'stg-sub-0003');
  if t !~ '^GW-[0-9]{4}-[0-9]{4,}$' then raise exception 'FAIL b: 문서번호 %', t; end if;
  reset role;
  v_out := v_out || 'b(상신 검증) ';

  -- ── c. 결재할 문서 = 지금 내 차례만 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  select count(*) into n from public.ea_list('todo') where doc_id = d1;
  if n <> 1 then raise exception 'FAIL c: B의 결재할 문서'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from public.ea_list('todo') where doc_id = d1;
  if n <> 0 then raise exception 'FAIL c: 대표(예정)에게 결재할 문서로 보인다'; end if;
  select count(*) into n from public.ea_list('planned') where doc_id = d1;
  if n <> 1 then raise exception 'FAIL c: 대표 결재 예정'; end if;
  reset role;
  v_out := v_out || 'c(내 차례만) ';

  -- ── d. 예정 결재자 · 사유 없는 반려 ──
  set local role authenticated;
  begin
    perform public.ea_act(d1, 2, 'approve', null, 'stg-act-0001');
    raise exception 'FAIL d: 예정 결재자가 앞질러 승인';
  exception when others then if sqlerrm <> 'ea_step_not_waiting' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  begin
    perform public.ea_act(d1, 1, 'reject', '', 'stg-act-0002');
    raise exception 'FAIL d: 사유 없이 반려';
  exception when others then if sqlerrm <> 'ea_reason' then raise; end if;
  end;
  v_out := v_out || 'd(권한 · 사유) ';

  -- ── e. 중간 승인 · 같은 요청 두 번 · 두 번째 탭 ──
  t := public.ea_act(d1, 1, 'approve', '확인', 'stg-act-0010');
  if t <> 'in_progress' then raise exception 'FAIL e: 중간 승인 뒤 %', t; end if;
  t := public.ea_act(d1, 1, 'approve', '확인', 'stg-act-0010');
  begin
    perform public.ea_act(d1, 1, 'approve', null, 'stg-act-0011');
    raise exception 'FAIL e: 두 번째 탭 승인';
  exception when others then if sqlerrm <> 'ea_step_not_waiting' then raise; end if;
  end;
  reset role;
  select count(*) into n from public.ea_events where doc_id = d1 and action = 'approve';
  if n <> 1 then raise exception 'FAIL e: 승인 이력 %줄', n; end if;
  select count(*) into n from public.notifications where user_id = v_chair and link like '%' || d1::text || '%';
  if n <> 1 then raise exception 'FAIL e: 대표 알림 %건', n; end if;
  v_out := v_out || 'e(중간 승인 · 재시도 · 두 탭) ';

  -- ── f. 대표 반려 → A 재상신 → B · 대표 승인 → 후속 한 번 → B 완료(문서 상태 그대로) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  t := public.ea_act(d1, 2, 'reject', '견적 두 곳 비교', 'stg-act-0020');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  v2 := public.ea_resubmit(d1);
  perform public.ea_submit(v2, 'stg-sub-0010');
  reset role;
  select count(*) into n from public.ea_steps where doc_id = v2 and status = 'waiting' and seq = 1;
  if n <> 1 then raise exception 'FAIL f: 재상신이 처음부터가 아니다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  perform public.ea_act(v2, 1, 'approve', null, 'stg-act-0030');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  t := public.ea_act(v2, 2, 'approve', null, 'stg-act-0031');
  if t <> 'approved' then raise exception 'FAIL f: 최종 승인 %', t; end if;
  reset role;
  select count(*) into n from public.ea_followups where doc_id = v2;
  if n <> 1 then raise exception 'FAIL f: 후속 %건', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  perform public.ea_followup_update(v2, 'done', '발주 완료', '20261019-1', 'stg-fu-0001');
  reset role;
  select status into t from public.ea_docs where doc_id = v2;
  if t <> 'approved' then raise exception 'FAIL f: 후속 완료가 문서 상태를 바꿨다 %', t; end if;
  select status into t from public.ea_docs where doc_id = d1;
  if t <> 'rejected' then raise exception 'FAIL f: 원문서 %', t; end if;
  v_out := v_out || 'f(반려 · 재상신 · 승인 · 후속) ';

  -- ── g. 첨부 — 문서를 못 읽는 사람(대표는 원문서 결재선에 있음 → 읽음 · 결재선 밖 문서는 못 읽음) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  w := public.ea_save_draft(null, biz, 'general', '회수 시험', '내용입니다', '{}'::jsonb, jsonb_build_array(jsonb_build_object('user_id', v_b, 'kind', 'approve')), '[]'::jsonb, null, null, null, null);
  insert into storage.objects (bucket_id, name, owner) values ('ea-files', w::text || '/x.txt', v_a);
  perform public.ea_file_add(w, w::text || '/x.txt', 'x.txt', 10, 'text/plain');
  perform public.ea_submit(w, 'stg-sub-0020');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'ea-files' and name = w::text || '/x.txt';
  if n <> 0 then raise exception 'FAIL g: 결재선 밖 대표가 첨부를 본다'; end if;
  j := public.ea_doc(w);
  if j is not null then raise exception 'FAIL g: 결재선 밖 대표가 상세를 본다'; end if;
  select count(*) into n from storage.objects where bucket_id = 'ea-files' and name = d1::text || '/q.pdf';
  if n <> 1 then raise exception 'FAIL g: 결재선의 대표가 첨부를 못 본다'; end if;
  reset role;
  v_out := v_out || 'g(첨부 권한) ';

  -- ── h. 회수 — 처리 전 · 기안자만 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  begin
    perform public.ea_withdraw(w, 'stg-wd-0001');
    raise exception 'FAIL h: 기안자 아닌 사람이 회수';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  perform public.ea_withdraw(w, 'stg-wd-0002');
  reset role;
  select status into t from public.ea_docs where doc_id = w;
  if t <> 'withdrawn' then raise exception 'FAIL h: 회수 %', t; end if;
  v_out := v_out || 'h(회수) ';

  -- ── i. 건수 = 목록 ──
  set local role authenticated;
  j := public.ea_counts();
  select count(*) into n from public.ea_list('mine') l where l.status = 'in_progress';
  if (j ->> 'mine')::int <> n then raise exception 'FAIL i: 건수 %', j; end if;
  reset role;
  v_out := v_out || 'i(건수 = 목록) ';

  -- ── j. anon ──
  set local role anon;
  begin
    perform * from public.ea_list('todo');
    raise exception 'FAIL j: anon이 목록';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.ea_docs limit 1;
    raise exception 'FAIL j: anon이 표';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'j(anon 0)';

  raise exception '0087 STAGING PASS %', v_out;
end
$t$;
