/**
 * docs/onboarding/staging-tests/0061_0065_staging_test.sql을 PGlite에서 미리 돌린다 — staging과 비슷한 조건:
 *   · 사람: 회장 · rehearsal.staff@example.com · rehearsal.member@example.com(이메일로 찾는다 — 파일과 같다).
 *   · Vault 키 cost_bom_key가 있다(staging에 있음 — 2026-10-10 회장 확인).
 *   · (가) 0시 기준은 진짜 정의 그대로(PIN_SALES_IMMEDIATE를 걸지 않는다) — staging 2차 FAIL d가 바로 이것이었다.
 *   · biz_dy에 이 시험 밖의 원료 · 시세 · LOT · BOM이 이틀 전부터 있다(«기존 원료가 섞인 회사»).
 * 파일이 «0061-0065 STAGING PASS»로 끝나는지, 아무것도 남기지 않는지 본다. staging에는 쓰지 않는다.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

import { applyOne, MIGRATIONS, SUPABASE_STUBS } from './pglite'

async function main() {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } })
  await db.exec(SUPABASE_STUBS + '\n alter default privileges in schema public grant all on functions to anon, authenticated;')
  await db.exec(`
    create extension if not exists pgcrypto with schema extensions;
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text not null, created_at timestamptz not null default now());
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, created_at from vault.secrets;
    revoke all on schema vault from public;
    insert into vault.secrets (name, secret) values ('cost_bom_key', encode(extensions.gen_random_bytes(32), 'base64'));
  `)
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) await applyOne(db, f)

  const chair = '00000000-0000-0000-0000-00000061c001'
  const staff = '00000000-0000-0000-0000-00000061c002'
  const member = '00000000-0000-0000-0000-00000061c003'
  const buyer = '00000000-0000-0000-0000-00000061c004'
  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values ('${chair}', 'chair@x'), ('${staff}', 'rehearsal.staff@example.com'),
      ('${member}', 'Rehearsal.Member@example.com'), ('${buyer}', 'buyer@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${chair}', 'Chairman', '회장', 'Vault'), ('${staff}', 'Member', '리허설 직원', 'Normal'),
      ('${member}', 'Member', '리허설 사원', 'Normal'), ('${buyer}', 'Member', '기존 구매', 'Normal');
    insert into user_business_access values ('${staff}', 'biz_dy'), ('${member}', 'biz_dy'), ('${buyer}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values ('${buyer}', '/purchasing/biz_dy', true, false);
    -- staging 0059 전제: 리허설 사원의 상사 = 대표.
    update user_profiles set reports_to = '${chair}' where user_id in ('${member}', '${staff}');
  `)
  const as = async (uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const rows = (await db.query<Record<string, string>>(sql)).rows
      await db.exec('commit')
      return rows
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  // 기존 원료 둘 · 시세 · LOT · 제품 BOM(완전) — 이틀 전에 들어온 것으로 돌린다.
  const [{ o1 }] = await as(buyer, `insert into cost_materials (business_id, name) values ('biz_dy', '기존 가짜 원료 1') returning material_id as o1`)
  const [{ o2 }] = await as(buyer, `insert into cost_materials (business_id, name) values ('biz_dy', '기존 가짜 원료 2') returning material_id as o2`)
  const [{ s }] = await as(buyer, `insert into cost_suppliers (business_id, name) values ('biz_dy', '기존 공급처') returning supplier_id as s`)
  await as(buyer, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name)
    values ('biz_dy', '${o1}', cost_today() - 5, 500, '기존'), ('biz_dy', '${o2}', cost_today() - 5, 700, '기존')`)
  await as(buyer, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price)
    values ('biz_dy', '${o1}', '${s}', cost_today() - 5, 1000, 480), ('biz_dy', '${o2}', '${s}', cost_today() - 5, 1000, 690)`)
  const [{ p }] = await as(chair, `insert into cost_products (business_id, name) values ('biz_dy', '기존 가짜 제품') returning product_id as p`)
  await as(chair, `select cost_bom_save('${p}', cost_today() - 30, 100,
    jsonb_build_array(jsonb_build_object('material_id', '${o1}', 'kg_per_kg', 0.5), jsonb_build_object('material_id', '${o2}', 'kg_per_kg', 0.5)), '기존')`)
  await db.exec(`set session_replication_role = replica;
    update cost_materials set created_at = now() - interval '2 days';
    update cost_market_prices set created_at = now() - interval '2 days';
    update cost_purchase_lots set created_at = now() - interval '2 days';
    update cost_secret.bom_versions set created_at = now() - interval '2 days';
    set session_replication_role = origin;
    delete from cost_secret.cost_reads;`)
  const before = (await db.query<{ n: number }>(`select (select count(*) from cost_materials) + (select count(*) from cost_products)
    + (select count(*) from cost_secret.bom_versions) + (select count(*) from cost_purchase_lots) + (select count(*) from user_module_access) as n`)).rows[0].n

  const runFile = async (name: string) => {
    const sql = readFileSync(join(__dirname, '..', 'docs', 'onboarding', 'staging-tests', name), 'utf8')
    let msg = ''
    try {
      await db.exec(sql)
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    try {
      await db.exec('rollback')
    } catch {
      // 이미 끝난 트랜잭션
    }
    console.log(`${name}: ${msg}`)
    return msg
  }
  const message = await runFile('0061_0065_staging_test.sql')
  assert.match(message, /^0061-0065 STAGING PASS /, 'staging 시험 SQL이 PASS로 끝나지 않는다')
  assert.match(message, /d\(오늘 넣은 값 영업 NULL · 대표 즉시 · «내일» 영업 1원/, '(가) 두 단계(d1 · d2)를 돌지 않았다')
  const after = (await db.query<{ n: number }>(`select (select count(*) from cost_materials) + (select count(*) from cost_products)
    + (select count(*) from cost_secret.bom_versions) + (select count(*) from cost_purchase_lots) + (select count(*) from user_module_access) as n`)).rows[0].n
  assert.equal(Number(after), Number(before), 'staging 시험 SQL이 줄을 남겼다')
  // 트리거가 다시 켜져 있다(파일이 끄고 켠다 — 되돌림과 별개로 확인).
  const off = (await db.query<{ n: number }>(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname in ('cost_materials', 'cost_market_prices', 'cost_purchase_lots') and not t.tgisinternal and t.tgenabled = 'D'`)).rows[0].n
  assert.equal(off, 0, '트리거가 꺼진 채 남았다')

  // 0066이 있는 브랜치(feat/cost-engine)에서만 — 견적 · 가격 예외 결재.
  if (files.includes('0066_quotes.sql')) {
    const m66 = await runFile('0066_staging_test.sql')
    assert.match(m66, /^0066 STAGING PASS a\(.*b\(Red .*사슬 1칸 → 대표 승인 → 확정\) c\(.*d\(.*e\(anon 거부\)$/, '0066 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from quotes) + (select count(*) from decisions where template_key = 'price_exception') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0066 staging 시험 SQL이 견적 · 결재를 남겼다')
  }
  // 0068(엑셀 넣기)이 있는 브랜치에서만.
  if (files.includes('0068_cost_import.sql')) {
    const m68 = await runFile('0068_staging_test.sql')
    assert.match(m68, /^0068 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(anon 거부\)$/, '0068 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from cost_imports) + (select count(*) from cost_materials where name like '스테이징 엑셀%') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0068 staging 시험 SQL이 엑셀 기록 · 원료를 남겼다')
  }
  // 0069(AI 어시스턴트 — 권한 조회 · 보완 의견)가 있는 브랜치에서만.
  if (files.includes('0069_ai_feedback.sql')) {
    const m69 = await runFile('0069_staging_test.sql')
    assert.match(m69, /^0069 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(anon 거부\)$/, '0069 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from ai_feedback) + (select count(*) from ai_feedback_bundles)
      + (select count(*) from ai_chats where title = '0069 시험') + (select count(*) from user_module_access where module = '/users/biz_dy') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0069 staging 시험 SQL이 의견 · 대화 · 권한 줄을 남겼다')
  }
  // 0070(회계 · 재무 자료 올리기 v2)이 있는 브랜치에서만.
  if (files.includes('0070_finance_upload.sql')) {
    const m70 = await runFile('0070_staging_test.sql')
    assert.match(m70, /^0070 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(anon 거부\)$/, '0070 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from fin_uploads) + (select count(*) from fin_sales_lines)
      + (select count(*) from closings where period = '2099-02') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0070 staging 시험 SQL이 올리기 · 줄 · 마감 줄을 남겼다')
  }
  // 0072(회계 · 재무 자료 올리기 v2.1 차이분 · 시드 정리 A안)가 있는 브랜치에서만. 0071보다 먼저(0071이 소유자를 바꾼다).
  if (files.includes('0072_finance_v21.sql')) {
    const m72 = await runFile('0072_staging_test.sql')
    assert.match(m72, /^0072 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(.*g\(anon 거부\)$/, '0072 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from fin_uploads) + (select count(*) from fin_inventory_valuations)
      + (select count(*) from fin_inventory_openings) + (select count(*) from fin_material_issues) + (select count(*) from fin_tx_groups)
      + (select count(*) from fin_reclose_flags) + (select count(*) from closings where period = '2099-09')
      + (select count(*) from user_module_access where module = '/finance/biz_dy') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0072 staging 시험 SQL이 평가금액 · 출고 줄 · 묶음 · 재마감 대상 · 마감 줄 · 권한 줄을 남겼다')
  }
  // 0073(기능 스위치)이 있는 브랜치에서만. 0071보다 먼저(0071이 소유자를 바꾼다).
  if (files.includes('0073_feature_switches.sql')) {
    const before73 = (await db.query<{ n: string }>(`select md5(string_agg(feature_key || coalesce(business_id, '') || enabled || audience || reason, ',' order by feature_key, business_id)) as n from feature_switches`)).rows[0].n
    const m73 = await runFile('0073_staging_test.sql')
    assert.match(m73, /^0073 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(anon 거부\)$/, '0073 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from feature_switches where business_id is not null)
      + (select count(*) from audit_log where entity_table = 'feature_switches') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0073 staging 시험 SQL이 회사 스위치 줄 · 감사를 남겼다')
    const after73 = (await db.query<{ n: string }>(`select md5(string_agg(feature_key || coalesce(business_id, '') || enabled || audience || reason, ',' order by feature_key, business_id)) as n from feature_switches`)).rows[0].n
    assert.equal(after73, before73, '0073 staging 시험 SQL이 그룹 기본 줄을 바꾼 채 남겼다')
  }
  // 0074(원료 출고 · 재고 바꾸기 대표 · CFO만)가 있는 브랜치에서만. 0071보다 먼저.
  if (files.includes('0074_finance_replace_guard.sql')) {
    const m74 = await runFile('0074_staging_test.sql')
    assert.match(m74, /^0074 STAGING PASS a\(직원 바꾸기 거부\) d\(직원 되돌리기 거부\) b\(대표 바꾸기\) c\(다른 종류는 그대로\) e\(대표 되돌리기\)$/, `0074 staging 시험 SQL이 PASS로 끝나지 않는다 (${m74})`)
    const left = (await db.query<{ n: number }>(`select count(*) as n from fin_uploads where period in ('2099-10', '2099-11')`)).rows[0].n
    assert.equal(Number(left), 0, '0074 staging 시험 SQL이 올리기를 남겼다')
  }
  // 0075(월별 손익 — 재고 반영 · 마감)가 있는 브랜치에서만. 0071보다 먼저.
  if (files.includes('0075_monthly_pl.sql')) {
    const switches = async () => (await db.query<{ s: string }>(`select string_agg(feature_key || ':' || coalesce(business_id, '-') || ':' || enabled || ':' || audience, ',' order by feature_key, business_id) as s from feature_switches`)).rows[0].s
    const before75 = await switches()
    const m75 = await runFile('0075_staging_test.sql')
    assert.match(m75, /^0075 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(.*g\(.*h\(.*i\(.*j\(.*k\(anon 거부\)$/, `0075 staging 시험 SQL이 PASS로 끝나지 않는다 (${m75})`)
    const left = (await db.query<{ n: number }>(`select (select count(*) from fin_pl_closes) + (select count(*) from fin_pl_adjustments) + (select count(*) from fin_pl_settings)
      + (select count(*) from fin_uploads where period in ('2098-12', '2099-01', '2099-02', '2099-03')) + (select count(*) from journal_entries where entry_date >= '2099-01-01')
      + (select count(*) from fin_reclose_flags where cause = 'pl_reopen') + (select count(*) from fin_inventory_valuations where period like '2099-0%') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0075 staging 시험 SQL이 저장본 · 조정 · 설정 · 올리기 · 전표 · 재마감 대상 · 평가금액을 남겼다')
    assert.equal(await switches(), before75, '0075 staging 시험 SQL이 기능 스위치 줄을 바꾼 채 남겼다')
  }
  // 0076(첫 달 기초 확인 · 일부 미입력 · 시드 정의자 거름)이 있는 브랜치에서만. 0071보다 먼저.
  if (files.includes('0076_b_rest.sql')) {
    const m76 = await runFile('0076_staging_test.sql')
    assert.match(m76, /^0076 STAGING PASS a\(입력자 확인 거부\) b\(다른 사람 확인\) c\(두 번째 확인 false\) d\(미입력 확인 거부\) e\(일부 미입력\) f\(정의자 거름\) g\(anon 거부\)$/, `0076 staging 시험 SQL이 PASS로 끝나지 않는다 (${m76})`)
    const left = (await db.query<{ n: number }>(`select (select count(*) from fin_inventory_openings where period like '2099-0%') + (select count(*) from fin_uploads where period in ('2099-07', '2099-08'))
      + (select count(*) from fin_reclose_flags where period in ('2099-07', '2099-08')) + (select count(*) from audit_log where entity_table = 'fin_inventory_openings') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0076 staging 시험 SQL이 첫 달 기초 · 올리기 · 재마감 대상 · 감사를 남겼다')
  }
  // 0077(판매 실적 · 마진 스위치 문)이 있는 브랜치에서만. 0071보다 먼저.
  if (files.includes('0077_sales_margins.sql')) {
    const switches77 = async () => (await db.query<{ s: string }>(`select string_agg(feature_key || ':' || coalesce(business_id, '-') || ':' || enabled || ':' || audience, ',' order by feature_key, business_id) as s from feature_switches`)).rows[0].s
    const before77 = await switches77()
    const m77 = await runFile('0077_staging_test.sql')
    assert.match(m77, /^0077 STAGING PASS a\(직원 스위치 꺼짐\) b\(대표 마진 · 칸 모양\) c\(직원 마진 거부\) d\(끄면 대표도 꺼짐\) e\(anon 거부\)$/, `0077 staging 시험 SQL이 PASS로 끝나지 않는다 (${m77})`)
    assert.equal(await switches77(), before77, '0077 staging 시험 SQL이 기능 스위치 줄을 바꾼 채 남겼다')
    const left = (await db.query<{ n: number }>(`select count(*) as n from audit_log where entity_id = 'margins:biz_dy'`)).rows[0].n
    assert.equal(Number(left), 0, '0077 staging 시험 SQL이 마진 감사 줄을 남겼다')
  }
  // 0071은 맨 뒤 — 끝에서 표 · 함수 소유자를 바꾼다(아래 주석).
  // 0071(프로세스 차트 동기화)이 있는 브랜치에서만. staging처럼 AI Agent 계정이 하나 있다.
  if (files.includes('0071_process_chart_sync.sql')) {
    const agent = '00000000-0000-0000-0000-00000061c005'
    await db.exec(`insert into auth.users (id, email) values ('${agent}', 'agent@x');
      insert into user_profiles (user_id, role, display_name, max_security_class) values ('${agent}', 'AIAgent', 'AI Agent', 'Restricted');`)
    const m71 = await runFile('0071_staging_test.sql')
    assert.match(m71, /^0071 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(.*h\(.*i\(.*j\(.*k\(.*g\(anon 거부\)$/, '0071 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from process_chart_items) + (select count(*) from process_chart_syncs)
      + (select count(*) from tasks where source_label is not null) + (select count(*) from teams where team_id like 'team_dy_stg71%') + (select count(*) from projects where project_id like 'pc_%') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0071 staging 시험 SQL이 시트 줄 · 기록 · 업무 · 팀을 남겼다')

    // 0071 FORCE(2026-10-12 고침): 같은 시험을 **BYPASSRLS 아닌 소유자**로 한 번 더. PGlite의 postgres는 superuser라
    // FORCE를 우회한다 — 위 통과는 «FORCE 아래에서도 동기화가 된다»를 재지 못한다. Supabase처럼 소유자가
    // authenticated에 속하게 두고(staging 2026-10-12: pg_has_role('postgres','authenticated') = true) public의 표 · 뷰 ·
    // 함수를 전부 넘긴다. 이 뒤로는 이 DB에서 다른 시험을 돌리지 않는다(소유자가 바뀌었다).
    const forced = (await db.query<{ relname: string; f: boolean }>(`select relname, relforcerowsecurity as f from pg_class
      where relname in ('tasks', 'process_charts', 'teams') and relnamespace = 'public'::regnamespace order by 1`)).rows
    assert.deepEqual(forced.map((r) => `${r.relname}:${r.f}`), ['process_charts:true', 'tasks:true', 'teams:true'],
      '0071: tasks · process_charts · teams 중 FORCE가 꺼진 표가 있다(대표 지시 2026-10-12 — 0071은 FORCE를 내리지 않는다)')
    await db.exec(`
      create role app_owner nosuperuser nobypassrls nologin;
      grant authenticated to app_owner;
      grant usage on schema public, auth to app_owner;
      grant select on auth.users to app_owner;  -- Supabase의 postgres도 auth.users를 읽는다(담당자 이메일 찾기)
      do $o$
      declare r record;
      begin
        for r in select c.oid::regclass::text as n, c.relkind from pg_class c
                  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm')
                    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
          execute format('alter %s %s owner to app_owner',
            case r.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, r.n);
        end loop;
        for r in select p.oid::regprocedure::text as n from pg_proc p
                  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
                    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
          execute format('alter function %s owner to app_owner', r.n);
        end loop;
      end $o$;
    `)
    const ow = (await db.query<{ b: boolean; s: boolean; o: string }>(`select rolbypassrls as b, rolsuper as s,
      (select relowner::regrole::text from pg_class where oid = 'public.tasks'::regclass) as o from pg_roles where rolname = 'app_owner'`)).rows[0]
    assert.deepEqual([ow.b, ow.s, ow.o], [false, false, 'app_owner'], '실험 설정이 깨졌다 — app_owner가 bypassrls · superuser이거나 tasks 소유자가 아니다')
    const m71b = await runFile('0071_staging_test.sql')
    assert.match(m71b, /^0071 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(.*h\(.*i\(.*j\(.*k\(.*g\(anon 거부\)$/,
      `0071: BYPASSRLS 아닌 소유자 + FORCE에서 동기화 시험이 깨진다 — 통로(process_chart_sync_ctx)가 모자라다 (${m71b})`)
    // 통로는 PostgREST 세션에서 켤 수 없다 — 값을 켜도 거짓이고, 시트 업무를 넣지 못한다.
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${member}', true); set local role authenticated;
      select set_config('chairman.process_chart_sync', 'on', true);`)
    try {
      const ctx = (await db.query<{ c: boolean }>(`select process_chart_sync_ctx() as c`)).rows[0].c
      assert.equal(ctx, false, '0071: 사람 세션이 설정값을 켜서 동기화 통로를 연다')
      await assert.rejects(db.query(`insert into tasks (task_id, project_id, title, source_label) values ('tsk_fake71', 'prj_001', '가짜', '프로세스 차트 · 가짜')`),
        /row-level security|permission denied/, '0071: 사람 세션이 설정값을 켜고 시트 업무를 넣었다')
    } finally {
      await db.exec('rollback')
    }
  }
  await db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
