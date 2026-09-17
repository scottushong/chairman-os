-- =====================================================================
-- Chairman OS — 0016_books
-- 출처: Phase 2-B 자체 장부 입력 경로 / CH-052 / DEFERRED D-19 해소
-- 작성: Phase 2-B (2026-09-17)
--
-- 회계 원천은 자체 장부다. ECOUNT 공개 OAPI에 원장 조회가 없다(D-19) — 기다리지 않고 장부를 여기서 쓴다.
-- ECOUNT는 DY 엑셀 업로드로만 들어온다(별도 블록).
--
-- 원칙 셋
--   ① 모든 쓰기는 audit_log에 남는다.
--   ② 마감된 달은 고치지 않는다. 바꿀 것이 있으면 당월에 정정 전표를 넣는다.
--   ③ 차변 합 = 대변 합이 아니면 전표가 저장되지 않는다.
--
-- 권한 (04_권한 확장)
--   계정과목·전표 입력  Chairman · GroupCFO · BusinessCEO(자기 회사만)   can_keep_books(business_id)
--   월 마감             Chairman · GroupCFO                              can_close_books()
--
-- 이 파일이 만드는 것
--   1. 계정과목 관리    accounts.active, 코드 불변, 표준 계정과목표 시드
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 판정 함수 — 0002의 판정 함수들과 같은 모양(security definer, 활성 사용자 먼저)
-- ---------------------------------------------------------------------

/** 이 회사의 장부(계정과목·전표)를 쓸 수 있는가. BusinessCEO는 자기 회사만. */
create or replace function can_keep_books(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and target is not null and case
    when auth_role() in ('Chairman', 'GroupCFO') then true
    when auth_role() = 'BusinessCEO' then has_business(target)
    else false
  end;
$fn$;

/** 월 마감을 할 수 있는가. 회사 범위는 부르는 쪽이 has_business()로 같이 본다. */
create or replace function can_close_books() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() in ('Chairman', 'GroupCFO');
$fn$;

-- ---------------------------------------------------------------------
-- 1. 계정과목 관리
--    계정은 지우지 않는다(전표·결산이 FK로 문다). 대신 비활성화한다.
--    코드는 바뀌지 않는다 — 코드가 바뀌면 과거 전표가 다른 계정을 가리킨다. 이름·분류만 고친다.
--    화면에서 만든 계정은 source='manual'. 분류를 고친 ECOUNT 계정은 source를 그대로 둔다.
-- ---------------------------------------------------------------------
alter table accounts add column if not exists active boolean not null default true; -- [일반]
comment on column accounts.active is '0016. false = 비활성. 새 전표를 받지 않는다. 과거 숫자는 그대로 선다.';

create or replace function accounts_guard() returns trigger
language plpgsql as $fn$
begin
  if new.business_id is distinct from old.business_id or new.account_code is distinct from old.account_code then
    raise exception using errcode = 'P0001', message = 'account_code_immutable',
      detail = '계정코드는 바꿀 수 없다. 새 계정을 만들고 옛 계정을 비활성화한다.';
  end if;
  if new.source is distinct from old.source then
    raise exception using errcode = 'P0001', message = 'account_source_immutable';
  end if;
  return new;
end;
$fn$;

create trigger accounts_guard before update on accounts
  for each row execute function accounts_guard();

-- 0015의 Integration 정책과 나란히 선다(permissive끼리는 OR).
create policy accounts_books_insert on accounts
  for insert with check (can_keep_books(business_id) and source = 'manual');
create policy accounts_books_update on accounts
  for update using (can_keep_books(business_id))
  with check (can_keep_books(business_id));

-- 표준 계정과목표 — 한국 중소기업. 스타트업 네 곳에 같은 표.
-- src/lib/ledger/standard-chart.ts와 같다(scripts/check-migrations.ts가 한 줄씩 비교한다).
-- DY는 받지 않는다 — ECOUNT 코드 체계를 업로드 때 그대로 싣는다.
-- 없는 회사는 건너뛴다. 이미 있는 코드는 건드리지 않는다.
insert into accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at)
select b.business_id, v.code, v.name, v.category::account_category, v.section::account_section,
       v.cash_flow::cash_flow_class, 'manual', now()
  from businesses b
 cross join (values
    ('1010', '현금및현금성자산', 'asset', 'cash', null),
    ('1030', '보통예금', 'asset', 'cash', null),
    ('1080', '외상매출금', 'asset', 'receivable', 'operating'),
    ('1100', '받을어음', 'asset', 'receivable', 'operating'),
    ('1200', '미수금', 'asset', 'other_asset', 'operating'),
    ('1310', '선급금', 'asset', 'other_asset', 'operating'),
    ('1330', '선급비용', 'asset', 'other_asset', 'operating'),
    ('1350', '부가세대급금', 'asset', 'other_asset', 'operating'),
    ('1360', '가지급금', 'asset', 'other_asset', 'operating'),
    ('1400', '유형자산', 'asset', 'other_asset', 'investing'),
    ('1410', '감가상각누계액', 'asset', 'other_asset', null),
    ('1460', '상품', 'asset', 'other_asset', 'operating'),
    ('1500', '제품', 'asset', 'other_asset', 'operating'),
    ('1530', '원재료', 'asset', 'other_asset', 'operating'),
    ('1700', '무형자산', 'asset', 'other_asset', 'investing'),
    ('1960', '임차보증금', 'asset', 'other_asset', 'investing'),
    ('2010', '외상매입금', 'liability', 'payable', 'operating'),
    ('2520', '지급어음', 'liability', 'payable', 'operating'),
    ('2530', '미지급금', 'liability', 'other_liability', 'operating'),
    ('2540', '예수금', 'liability', 'other_liability', 'operating'),
    ('2550', '부가세예수금', 'liability', 'other_liability', 'operating'),
    ('2590', '선수금', 'liability', 'other_liability', 'operating'),
    ('2600', '차입금', 'liability', 'other_liability', 'financing'),
    ('2620', '미지급비용', 'liability', 'other_liability', 'operating'),
    ('2930', '장기차입금', 'liability', 'other_liability', 'financing'),
    ('2950', '퇴직급여충당부채', 'liability', 'other_liability', 'operating'),
    ('3310', '자본금', 'equity', 'equity', 'financing'),
    ('3410', '주식발행초과금', 'equity', 'equity', 'financing'),
    ('3750', '이월이익잉여금', 'equity', 'equity', 'financing'),
    ('4010', '제품매출', 'revenue', 'revenue', null),
    ('4020', '상품매출', 'revenue', 'revenue', null),
    ('4030', '용역매출', 'revenue', 'revenue', null),
    ('4510', '원재료비', 'raw_material', 'cogs', null),
    ('4520', '제조인건비', 'labor', 'cogs', null),
    ('4530', '전력비', 'electricity', 'cogs', null),
    ('4540', '운반비', 'freight', 'cogs', null),
    ('4550', '라이선스료', 'license', 'cogs', null),
    ('4590', '기타제조경비', 'other', 'cogs', null),
    ('4600', '외주가공비', 'other', 'cogs', null),
    ('4610', '상품매출원가', 'raw_material', 'cogs', null),
    ('8010', '급여(판관)', 'labor', 'sga', null),
    ('8030', '상여금', 'labor', 'sga', null),
    ('8050', '퇴직급여', 'labor', 'sga', null),
    ('8110', '복리후생비', 'labor', 'sga', null),
    ('8120', '여비교통비', 'other', 'sga', null),
    ('8130', '접대비', 'other', 'sga', null),
    ('8140', '통신비', 'other', 'sga', null),
    ('8150', '수도광열비', 'electricity', 'sga', null),
    ('8170', '세금과공과', 'other', 'sga', null),
    ('8190', '지급수수료', 'other', 'sga', null),
    ('8220', '지급임차료', 'other', 'sga', null),
    ('8230', '보험료', 'other', 'sga', null),
    ('8240', '차량유지비', 'other', 'sga', null),
    ('8250', '운반비(판관)', 'freight', 'sga', null),
    ('8260', '도서인쇄비', 'other', 'sga', null),
    ('8300', '소모품비', 'other', 'sga', null),
    ('8330', '광고선전비', 'other', 'sga', null),
    ('8340', '소프트웨어사용료', 'license', 'sga', null),
    ('8350', '연구개발비', 'other', 'sga', null),
    ('8210', '감가상각비', 'other', 'd_and_a', null),
    ('8280', '무형자산상각비', 'other', 'd_and_a', null),
    ('9010', '영업외수익', 'other', 'non_operating', null),
    ('9020', '이자수익', 'other', 'non_operating', null),
    ('9310', '이자비용', 'other', 'non_operating', null),
    ('9320', '외환차손', 'other', 'non_operating', null),
    ('9330', '잡손실', 'other', 'non_operating', null),
    ('9980', '법인세비용', 'other', 'tax', null)
 ) as v(code, name, category, section, cash_flow)
 where b.business_id in ('biz_vana', 'biz_sticky', 'biz_hof', 'biz_boram')
on conflict (business_id, account_code) do nothing;
