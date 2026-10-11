-- =====================================================================
-- ECOUNT 업로드 릴리스 전 확인 (0050 · 0051 · 0052 · 0056) — **읽기 전용 · select만 · 아무것도 바꾸지 않는다**
--
-- 어디서: Supabase 대시보드 → production(nndvspgnljivkvihxlzj · Tokyo) → SQL Editor → + New query →
--         아래 블록을 **하나씩** 붙여 넣고 Run(블록마다 결과 표가 하나). 전체를 한 번에 돌려도 되지만
--         SQL Editor는 마지막 결과만 보여 준다.
-- 언제: release-production.sh로 0050~0052 · 0056을 올리기 **전**. 결과를 컨트롤러에게 붙여 준다.
-- 이 파일의 모든 문장은 select다(insert · update · delete · create · alter · grant · do 블록 없음).
-- 아직 없는 표(0050 전 production이면 finance_imports 등)는 to_regclass로 먼저 보고, 있을 때만
-- query_to_xml로 그 자리에서 읽는다 — 표가 없어도 오류 없이 null이 나온다.
-- 기대값은 블록마다 «기대»로 적었다. 기대와 다르면 올리지 말고 결과를 보낸다.
-- =====================================================================


-- [1] 지금 production에 적용된 마이그레이션(마지막 열 개)
-- 기대: 0049_staff_terms까지(또는 0054 · 0055가 결재 브랜치로 먼저 갔을 수 있다). 0050 · 0051 · 0052 · 0056은 아직 없다.
--       0054가 이미 있으면 0050~0052는 번호가 낮아 `--include-all`로만 올라간다(release-order-2026-10.md B-2).
select version, name
  from supabase_migrations.schema_migrations
 order by version desc
 limit 10;


-- [2] 이번 릴리스가 만드는 것 · 전제로 삼는 것이 지금 있는가
-- 기대(0050 전): finance_imports · finance_import_slips · ecount_monthly_import · finance_books_lock_key = false,
--                attachments(0045) · can_read_books(0047) · close_period · post_correction · journal_slip_seq = true
select to_regclass('public.finance_imports')        is not null as has_finance_imports,         -- 0050
       to_regclass('public.finance_import_slips')   is not null as has_finance_import_slips,    -- 0050
       to_regprocedure('public.ecount_monthly_import(uuid,text,text,text,jsonb)') is not null as has_monthly_rpc, -- 0052
       to_regprocedure('public.finance_books_lock_key(text)')                    is not null as has_lock_key,    -- 0056
       to_regclass('public.attachments')            is not null as has_attachments,             -- 0045
       to_regprocedure('public.can_read_books(text)')                            is not null as has_can_read_books, -- 0047
       to_regprocedure('public.close_period(text,text)')                         is not null as has_close_period,   -- 0016/0047
       to_regprocedure('public.post_correction(text,text,date,text,text,jsonb)') is not null as has_post_correction, -- 0016
       to_regclass('public.journal_slip_seq')       is not null as has_slip_seq,                -- 0016
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'official_statements' and column_name = 'basis') as has_basis_column; -- 0050


-- [3] DY 회사 줄 · 첨부 버킷(0045 전제: 비공개) · 소유자가 Storage 객체를 읽을 수 있는가(0052 원본 확인 — 못 읽으면 등록이 멈춘다)
-- 기대: biz_dy 한 줄(Archived 아님) · attachments 버킷 public = false · postgres_reads_storage = true
select (select count(*) from businesses where business_id = 'biz_dy')                       as dy_rows,
       (select status::text from businesses where business_id = 'biz_dy')                  as dy_status,
       (select public from storage.buckets where id = 'attachments')                       as attachments_bucket_public,
       has_table_privilege('postgres', 'storage.objects', 'select')                         as postgres_reads_storage;


-- [4] DY 계정과목 — ECOUNT 계정 업로드가 코드로 맞춘다. 같은 코드가 이미 있으면 **분류는 안 바꾸고** 이름만(체크한 것만) 바꾼다.
-- 기대: ECOUNT-PL(0052 대응 계정)은 아직 없다(있으면 equity · 활성이어야 한다). 숫자가 아닌 코드 · source='manual' 줄은
--       ECOUNT 내려받기의 같은 코드와 부딪히는지 눈으로 대조한다.
select account_code, name, section::text as section, category::text as category, cash_flow::text as cash_flow,
       active, source::text as source,
       (account_code = 'ECOUNT-PL')            as is_ecount_counter,
       (account_code !~ '^[0-9]+$')            as non_numeric_code
  from accounts
 where business_id = 'biz_dy'
 order by account_code;


-- [5] DY 계정 요약 — 출처별 · 구분별 개수
select source::text as source, section::text as section, count(*) as n, count(*) filter (where not active) as inactive
  from accounts
 where business_id = 'biz_dy'
 group by 1, 2
 order by 1, 2;


-- [6] DY 장부 — 달마다 전표 줄 수 · 자체 전표 장 수 · 마감 여부. 월별 업로드가 만질 해(2025 · 2026)의 기존 줄.
-- 기대: 업로드할 달에 수기 전표가 있으면 미리보기가 «두 번 셀 수 있음» 경고를 낸다 — 그 달을 미리 안다.
--       마감된 달(closed_period)은 월별 업로드가 거부한다.
select to_char(l.entry_date, 'YYYY-MM') as month,
       count(*)                          as lines,
       count(distinct l.slip_no)         as slips,
       count(distinct e.slip_no)         as own_slips,      -- journal_entries 헤더가 있는 자체 장부 전표
       count(*) filter (where e.memo like '[ECOUNT 엑셀]%' or e.memo like '[역분개] [ECOUNT 엑셀]%') as ecount_excel_lines, -- 기대 0
       bool_or(l.closed)                 as any_closed,
       sum(case when l.side = 'debit' then l.amount else 0 end) as debit,
       sum(case when l.side = 'credit' then l.amount else 0 end) as credit
  from journal_lines l
  left join journal_entries e on e.business_id = l.business_id and e.slip_no = l.slip_no
 where l.business_id = 'biz_dy'
   and l.entry_date >= date '2025-01-01'
 group by 1
 order by 1;


-- [7] DY 마감(closings) — 월별 업로드는 «마지막 마감 달과 그 앞»을 받지 않는다.
-- 기대: 마지막 마감 달을 적어 둔다. 그 달 이후만 업로드할 수 있다.
select period, count(*) as accounts, min(closed_on) as closed_on, bool_and(closed) as all_closed
  from closings
 where business_id = 'biz_dy'
 group by period
 order by period desc
 limit 24;


-- [8] DY 공식 재무제표(0020) — 0050 전에는 전부 «세무사 확정»이다. 활성 확정이 덮은 해 · 분기는
--     ECOUNT 연간 업로드(그 해)와 월별 업로드(그 달)가 거부한다(official_month_locked).
-- 기대: 덮인 해/분기를 적어 둔다.
select id, period_kind, period_key, superseded_at is null as active, left(memo, 40) as memo,
       (evidence_url is not null) as has_evidence, created_at
  from official_statements
 where business_id = 'biz_dy'
 order by period_key desc, id desc;


-- [9] 0051 복합 FK 전제 — 공식 재무제표 줄의 회사가 헤더와 다른 줄. **기대: 0행**(아니면 0051이 실패한다).
select l.statement_id, l.business_id as line_business, s.business_id as header_business
  from official_statement_lines l
  join official_statements s on s.id = l.statement_id
 where l.business_id <> s.business_id;


-- [10] DY 재무 권한 — 누가 업로드(쓰기) · 마감할 수 있나('/finance/biz_dy' 줄, 0047). 역할로 되는 사람(Chairman · GroupCFO ·
--      DY BusinessCEO)은 줄 없이도 된다. 기대: 업로드할 사람이 can_write = true · 회수 안 됨.
select p.display_name, p.role::text as role, m.can_write, m.can_approve, p.revoked_at is not null as revoked
  from user_module_access m
  join user_profiles p on p.user_id = m.user_id
 where m.module = '/finance/biz_dy'
 order by p.role, p.display_name;


-- [11] 진행 중인 것 — 0050이 이미 있으면 남은 업로드 draft · 업로드 전표 줄(0050 전이면 null). 기대: draft 0 · 줄 0(첫 릴리스).
select case when to_regclass('public.finance_imports') is null then null
            else (xpath('/row/n/text()', query_to_xml(
                   'select count(*) as n from public.finance_imports where business_id = ''biz_dy'' and status = ''draft''',
                   false, true, '')))[1]::text::int end as finance_import_drafts,
       case when to_regclass('public.finance_import_slips') is null then null
            else (xpath('/row/n/text()', query_to_xml(
                   'select count(*) as n from public.finance_import_slips where business_id = ''biz_dy''',
                   false, true, '')))[1]::text::int end as finance_import_slip_rows;


-- [12] 같은 시각 다른 작업 — 지금 잡힌 advisory 잠금(0052 · 0056 회사 잠금과 같은 종류). 기대: 0행(또는 이 릴리스와 무관한 것).
select pid, classid, objid, granted
  from pg_locks
 where locktype = 'advisory';
