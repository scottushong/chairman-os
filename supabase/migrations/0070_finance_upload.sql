-- =====================================================================
-- Chairman OS — 0070_finance_upload («회계 · 재무 자료 올리기» v2 — 14가지 자료 · 자동 넣기 · 되돌리기 · 분류 학습)
-- 작성: 2026-10-12 (대표 결정 «회계 · 재무 자료 올리기 v2» — 앞의 «ECOUNT 쉬운 올리기» · «재무 PDF» 블록을 대신한다)
--
-- ■ 무엇이 없어서 만드나 ■
--   0050/0051의 ECOUNT 업로드는 계정과목 · 연간 · 월별 셋뿐이다. 경영지원이 매달 올리는 자료 14가지(판매현황 · 입고 · 재고 ·
--   제조지시 · 계정별 원장 · 급여 · 수입 · 자금 · 카드 · 해외법인 · 해외판촉 · 대출 · 차입 · 절감목표)는 넣을 표가 없다.
--
-- ■ 모양 ■
--   1절 fin_uploads — 올리기 기록(누가 · 언제 · 파일 · 종류 · 기간 · AI 믿음 · 자동/수동 · 줄 수 · 겹침 선택 · 되돌림).
--        같은 파일 두 번 → 늘지 않는다: (회사 · 종류 · 기간 · 파일 해시) 유일, 살아 있는 기록(applied · needs_review)만.
--        미리보기 대기(needs_review)의 줄은 pending(jsonb)에 둔다 — 이름 · 주민 · 계좌 · 카드번호 · 원료 투입 줄은 앱이 이미 버린 뒤다.
--   2절 자료 표 14 + 급여 개인 줄. 모두 회사 · 기간 · 출처 줄 번호 · 올리기 id. 쓰기 grant 없음 — fin_upload_apply만 넣는다.
--        읽기: 지금 회계 표 기준(can_read_books — 회사 범위 AND [제한] 열람 역할 또는 재무 모듈 줄).
--        급여 개인 줄(fin_payroll_people)만 대표 · 그룹 CFO. 개인 줄에도 이름 · 주민번호 · 계좌는 칸이 없다(사번 · 줄 번호만).
--   3절 fin_upload_shapes — 분류 학습: 사람이 종류 · 칸을 고치면 시트 모양(시트명 · 제목 줄 서명)과 칸 대응을 둔다. 숫자는 없다.
--   4절 RPC(definer · to authenticated, 판정은 can_keep_books):
--        fin_upload_record  — 미리보기 대기 · 실패 기록(진행 중에 남지 않게 실패는 바로 failed).
--        fin_upload_apply   — 넣기. 마감 달(closings.closed)은 대표 · CFO가 이유를 적어야만. 겹침(같은 회사 · 종류 · 기간의 살아 있는
--                             올리기)은 선택 필수: replace(기존 줄 무효 · 새 줄) · keep_old(새 것 버림). 자동(p_auto)은 겹침 · 마감이면 거부.
--                             자동이면 올린 사람에게 알림(«되돌리기 7일»).
--        fin_upload_revert  — 7일 안 되돌리기 = 그 올리기의 줄 전부 voided_at(지우지 않는다).
--        fin_upload_cancel  — 미리보기 대기를 취소.
--        fin_upload_shape_save — 학습 저장.
--
-- ■ 원가 엔진과의 경계 ■ ①판매 · ②입고 · ⑦수입은 원가 엔진의 «후보»다 — 이 표까지만 넣고 cost_* 표에는 한 줄도 쓰지 않는다
--   (원가 관리가 원가 엔진 화면에서 승인해야 LOT · 판매가 된다 — 이 파일은 그 함수를 부르지 않는다).
--   ④ 제조지시는 제품별 생산수량만 칸이 있다 — 원료 투입 줄 · 원료별 수량을 담을 칸 자체가 없다(구성표가 드러나는 길을 닫는다).
--
-- ■ AI ■ 이 파일은 AI를 모른다. AI 믿음(ai_confidence) · 호출 수(ai_used)는 앱이 적는 기록이다. AI는 DB에 쓰지 못한다 —
--   앱 서버가 사람 세션으로 이 RPC를 부른다(분류 결과는 JSON으로만 받고 코드가 읽는다).
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0069를 고치지 않는다. 새 정책은 늘 to authenticated(0060 교훈).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 올리기 기록
-- =====================================================================
create table fin_uploads (
  upload_id     uuid primary key default gen_random_uuid(),
  business_id   text not null references businesses(business_id) on delete restrict,         -- [일반]
  kind          text not null,                                                                -- [일반] 14가지 중 하나
  period        text check (period is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),         -- [일반] 실패 기록은 null일 수 있다
  file_name     text not null check (length(btrim(file_name)) between 1 and 255),            -- [제한]
  file_sha256   text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),                         -- [일반]
  sheet_name    text check (sheet_name is null or length(sheet_name) <= 120),                 -- [일반]
  ai_confidence text not null default 'none' check (ai_confidence in ('high', 'medium', 'low', 'none')),  -- [일반]
  ai_used       int not null default 0 check (ai_used between 0 and 50),                      -- [일반] 이 파일의 AI 호출 수
  auto          boolean not null default false,                                               -- [일반] 자동 넣기였나
  status        text not null check (status in ('needs_review', 'applied', 'failed', 'reverted', 'cancelled', 'replaced', 'skipped')),
  row_count     int not null default 0 check (row_count >= 0),                                -- [일반]
  overlap       text not null default 'none' check (overlap in ('none', 'replace', 'keep_old')),  -- [일반]
  reason        text check (reason is null or length(reason) <= 500),                         -- [일반] 마감 달 · 겹침 · 손으로 고침의 이유
  pending       jsonb check (pending is null or jsonb_typeof(pending) = 'object'),            -- [제한] 미리보기 대기 줄(버리기 뒤)
  error         text check (error is null or length(error) <= 500),                           -- [일반] 실패 이유 문구
  created_by    uuid not null default auth.uid(),                                             -- [제한]
  created_at    timestamptz not null default now(),
  applied_at    timestamptz,
  applied_by    uuid,
  reverted_at   timestamptz,
  reverted_by   uuid,
  replaced_by   uuid references fin_uploads(upload_id),                                        -- [일반] 이 올리기를 바꾼 새 올리기(되돌리면 되살린다)
  constraint fin_uploads_kind_known check (kind in ('sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll', 'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings', 'unknown'))
);
create unique index fin_uploads_same_file on fin_uploads (business_id, kind, coalesce(period, ''), file_sha256)
  where status in ('needs_review', 'applied');
create index fin_uploads_by_business on fin_uploads (business_id, created_at desc);

comment on table fin_uploads is
  '0070. 회계 · 재무 자료 올리기 기록. 같은 파일(회사 · 종류 · 기간 · 해시) 두 번은 살아 있는 동안 늘지 않는다. 쓰기는 fin_upload_* RPC만.';

alter table fin_uploads enable row level security;
revoke all on table fin_uploads from public, anon, authenticated;
-- 리뷰 I-1: pending(미리보기 대기 줄 — 급여 개인 줄이 들 수 있다)은 열 grant에서 뺀다. 읽기는 fin_upload_pending()만
-- (급여 개인 줄은 대표 · CFO에게만 싣는다).
grant select (upload_id, business_id, kind, period, file_name, file_sha256, sheet_name, ai_confidence, ai_used, auto, status,
              row_count, overlap, reason, error, created_by, created_at, applied_at, applied_by, reverted_at, reverted_by, replaced_by)
  on table fin_uploads to authenticated;
-- 기록은 그 회사 장부를 쓰는 사람(올리는 사람)과 읽는 사람이 본다. pending의 급여는 부서 합계 · 사번뿐이다(앱이 버린 뒤).
create policy fin_uploads_read on fin_uploads for select to authenticated
  using (can_keep_books(business_id) or can_read_books(business_id));

-- =====================================================================
-- 3절(먼저 — 2절이 1절을 문다). 분류 학습
-- =====================================================================
create table fin_upload_shapes (
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  header_sig  text not null check (header_sig ~ '^[0-9a-f]{16,64}$'),               -- [일반] 시트명 · 제목 줄 · 회사로 만든 서명
  sheet_name  text check (sheet_name is null or length(sheet_name) <= 120),          -- [일반]
  kind        text not null,                                                         -- [일반]
  column_map  jsonb not null check (jsonb_typeof(column_map) = 'object'),            -- [일반] 칸 이름 → 열 번호(숫자 없음)
  updated_by  uuid not null default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (business_id, header_sig),
  constraint fin_upload_shapes_kind_known check (kind in ('sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll', 'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings'))
);
comment on table fin_upload_shapes is '0070. 분류 학습 — 사람이 고친 종류 · 칸 대응을 시트 모양으로 기억한다. 숫자는 두지 않는다.';
alter table fin_upload_shapes enable row level security;
revoke all on table fin_upload_shapes from public, anon, authenticated;
grant select on table fin_upload_shapes to authenticated;
create policy fin_upload_shapes_read on fin_upload_shapes for select to authenticated using (can_keep_books(business_id));

-- =====================================================================
-- 2절. 자료 표 — 종류마다 하나(+ 급여 개인 줄). 쓰기 grant 없음 · 넣기는 fin_upload_apply(definer)만
-- =====================================================================

create table fin_sales_lines (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  customer       text,  -- [일반] 거래처
  product        text,  -- [일반] 제품
  qty            numeric(20,4),  -- [제한] 수량
  unit_price     numeric(20,4),  -- [제한] 단가
  amount         numeric(20,2),  -- [제한] 금액
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_sales_lines_by_period on fin_sales_lines (business_id, period) where voided_at is null;
comment on table fin_sales_lines is '0070. ① 매출 · 판매현황. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_sales_lines enable row level security;
revoke all on table fin_sales_lines from public, anon, authenticated;
grant select on table fin_sales_lines to authenticated;
create policy fin_sales_lines_read on fin_sales_lines for select to authenticated using (can_read_books(business_id));

create table fin_purchase_in_lines (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  material       text,  -- [일반] 원재료 · 부재료 이름
  supplier       text,  -- [일반] 공급처
  material_kind  text,  -- [일반] 원재료/부재료
  qty            numeric(20,4),  -- [제한] 매입수량
  amount         numeric(20,2),  -- [제한] 매입금액
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_purchase_in_lines_by_period on fin_purchase_in_lines (business_id, period) where voided_at is null;
comment on table fin_purchase_in_lines is '0070. ② 원재료 · 입고명세서. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_purchase_in_lines enable row level security;
revoke all on table fin_purchase_in_lines from public, anon, authenticated;
grant select on table fin_purchase_in_lines to authenticated;
create policy fin_purchase_in_lines_read on fin_purchase_in_lines for select to authenticated using (can_read_books(business_id));

create table fin_inventory_lines (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  item           text,  -- [일반] 품목
  used_qty       numeric(20,4),  -- [제한] 사용수량
  stock_qty      numeric(20,4),  -- [제한] 재고수량
  amount         numeric(20,2),  -- [제한] 재고금액
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_inventory_lines_by_period on fin_inventory_lines (business_id, period) where voided_at is null;
comment on table fin_inventory_lines is '0070. ③ 재고 · 재고금액명세서. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_inventory_lines enable row level security;
revoke all on table fin_inventory_lines from public, anon, authenticated;
grant select on table fin_inventory_lines to authenticated;
create policy fin_inventory_lines_read on fin_inventory_lines for select to authenticated using (can_read_books(business_id));

create table fin_production_lines (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  product        text,  -- [일반] 제품
  qty            numeric(20,4),  -- [제한] 실제 생산수량
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_production_lines_by_period on fin_production_lines (business_id, period) where voided_at is null;
comment on table fin_production_lines is '0070. ④ 생산 · 제조지시명세서(제품별 생산수량만). 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_production_lines enable row level security;
revoke all on table fin_production_lines from public, anon, authenticated;
grant select on table fin_production_lines to authenticated;
create policy fin_production_lines_read on fin_production_lines for select to authenticated using (can_read_books(business_id));

create table fin_ledger_sums (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  account_code   text,  -- [일반] 계정코드
  account_name   text,  -- [일반] 계정명
  debit          numeric(20,2),  -- [제한] 차변 합
  credit         numeric(20,2),  -- [제한] 대변 합
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_ledger_sums_by_period on fin_ledger_sums (business_id, period) where voided_at is null;
comment on table fin_ledger_sums is '0070. ⑤ 회계 · 계정별 원장(월 합계). 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_ledger_sums enable row level security;
revoke all on table fin_ledger_sums from public, anon, authenticated;
grant select on table fin_ledger_sums to authenticated;
create policy fin_ledger_sums_read on fin_ledger_sums for select to authenticated using (can_read_books(business_id));

create table fin_payroll_depts (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  dept           text,  -- [일반] 부서
  salary         numeric(20,2),  -- [제한] 급여
  bonus          numeric(20,2),  -- [제한] 상여
  severance      numeric(20,2),  -- [제한] 퇴직급여
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_payroll_depts_by_period on fin_payroll_depts (business_id, period) where voided_at is null;
comment on table fin_payroll_depts is '0070. ⑥ 인건비 · 급여대장(부서 합계). 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_payroll_depts enable row level security;
revoke all on table fin_payroll_depts from public, anon, authenticated;
grant select on table fin_payroll_depts to authenticated;
create policy fin_payroll_depts_read on fin_payroll_depts for select to authenticated using (can_read_books(business_id));

create table fin_import_lines (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  ref_no         text,  -- [일반] OFFER · 거래 번호
  material       text,  -- [일반] 원재료
  supplier       text,  -- [일반] 공급처
  currency       text,  -- [일반] 통화
  amount         numeric(20,2),  -- [제한] 대금(원 통화)
  fx_rate        numeric(20,6),  -- [제한] 환율
  amount_krw     numeric(20,2),  -- [제한] 원화 대금
  extra_cost     numeric(20,2),  -- [제한] 부대비용
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_import_lines_by_period on fin_import_lines (business_id, period) where voided_at is null;
comment on table fin_import_lines is '0070. ⑦ 수입 · OFFER SHEET. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_import_lines enable row level security;
revoke all on table fin_import_lines from public, anon, authenticated;
grant select on table fin_import_lines to authenticated;
create policy fin_import_lines_read on fin_import_lines for select to authenticated using (can_read_books(business_id));

create table fin_cash_flows (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  flow_date      date,  -- [일반] 일자
  category       text,  -- [일반] 항목
  inflow         numeric(20,2),  -- [제한] 입금
  outflow        numeric(20,2),  -- [제한] 출금
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_cash_flows_by_period on fin_cash_flows (business_id, period) where voided_at is null;
comment on table fin_cash_flows is '0070. ⑧ 자금 · 월별 자금흐름표. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_cash_flows enable row level security;
revoke all on table fin_cash_flows from public, anon, authenticated;
grant select on table fin_cash_flows to authenticated;
create policy fin_cash_flows_read on fin_cash_flows for select to authenticated using (can_read_books(business_id));

create table fin_card_lines (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  used_on        date,  -- [일반] 사용일
  merchant       text,  -- [일반] 가맹점
  dept           text,  -- [일반] 사용 부서
  card_last4     text,  -- [일반] 카드 뒤 4자리
  amount         numeric(20,2),  -- [제한] 금액
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_card_lines_by_period on fin_card_lines (business_id, period) where voided_at is null;
comment on table fin_card_lines is '0070. ⑨ 카드 · 법인카드 사용내역. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_card_lines enable row level security;
revoke all on table fin_card_lines from public, anon, authenticated;
grant select on table fin_card_lines to authenticated;
create policy fin_card_lines_read on fin_card_lines for select to authenticated using (can_read_books(business_id));

create table fin_overseas_costs (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  entity         text,  -- [일반] 법인
  item           text,  -- [일반] 항목
  currency       text,  -- [일반] 통화
  amount         numeric(20,2),  -- [제한] 금액(원 통화)
  fx_rate        numeric(20,6),  -- [제한] 환율
  amount_krw     numeric(20,2),  -- [제한] 원화 금액
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_overseas_costs_by_period on fin_overseas_costs (business_id, period) where voided_at is null;
comment on table fin_overseas_costs is '0070. ⑩ 해외법인 · 운영비. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_overseas_costs enable row level security;
revoke all on table fin_overseas_costs from public, anon, authenticated;
grant select on table fin_overseas_costs to authenticated;
create policy fin_overseas_costs_read on fin_overseas_costs for select to authenticated using (can_read_books(business_id));

create table fin_promo_costs (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  person         text,  -- [일반] 담당자
  item           text,  -- [일반] 항목
  currency       text,  -- [일반] 통화
  amount         numeric(20,2),  -- [제한] 금액
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_promo_costs_by_period on fin_promo_costs (business_id, period) where voided_at is null;
comment on table fin_promo_costs is '0070. ⑪ 해외판촉비. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_promo_costs enable row level security;
revoke all on table fin_promo_costs from public, anon, authenticated;
grant select on table fin_promo_costs to authenticated;
create policy fin_promo_costs_read on fin_promo_costs for select to authenticated using (can_read_books(business_id));

create table fin_loans (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  lender         text,  -- [일반] 금융기관
  principal      numeric(20,2),  -- [제한] 대출금액
  rate           numeric(10,4),  -- [제한] 금리(%)
  maturity       date,  -- [일반] 만기
  terms          text,  -- [일반] 상환조건
  principal_paid numeric(20,2),  -- [제한] 원금 상환
  interest_paid  numeric(20,2),  -- [제한] 이자
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_loans_by_period on fin_loans (business_id, period) where voided_at is null;
comment on table fin_loans is '0070. ⑫ 대출현황(기준일마다 한 벌). 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_loans enable row level security;
revoke all on table fin_loans from public, anon, authenticated;
grant select on table fin_loans to authenticated;
create policy fin_loans_read on fin_loans for select to authenticated using (can_read_books(business_id));

create table fin_borrowings (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  tx_date        date,  -- [일반] 일자
  lender         text,  -- [일반] 차입처
  direction      text,  -- [일반] 차입/상환
  amount         numeric(20,2),  -- [제한] 금액
  method         text,  -- [일반] 직접 입금/대납
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_borrowings_by_period on fin_borrowings (business_id, period) where voided_at is null;
comment on table fin_borrowings is '0070. ⑬ 연도별 차입금. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_borrowings enable row level security;
revoke all on table fin_borrowings from public, anon, authenticated;
grant select on table fin_borrowings to authenticated;
create policy fin_borrowings_read on fin_borrowings for select to authenticated using (can_read_books(business_id));

create table fin_savings_lines (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  item           text,  -- [일반] 항목
  labor_cost     numeric(20,2),  -- [제한] 기존 인건비
  target         numeric(20,2),  -- [제한] 절감 목표
  actual         numeric(20,2),  -- [제한] 실적
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_savings_lines_by_period on fin_savings_lines (business_id, period) where voided_at is null;
comment on table fin_savings_lines is '0070. ⑭ 절감목표 · 진행현황. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_savings_lines enable row level security;
revoke all on table fin_savings_lines from public, anon, authenticated;
grant select on table fin_savings_lines to authenticated;
create policy fin_savings_lines_read on fin_savings_lines for select to authenticated using (can_read_books(business_id));

create table fin_payroll_people (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  dept           text,  -- [제한] 부서
  person_ref     text,  -- [제한] 사번 · 줄 번호(이름 · 주민번호 · 계좌는 저장하지 않는다)
  salary         numeric(20,2),  -- [제한] 급여
  bonus          numeric(20,2),  -- [제한] 상여
  severance      numeric(20,2),  -- [제한] 퇴직급여
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_payroll_people_by_period on fin_payroll_people (business_id, period) where voided_at is null;
comment on table fin_payroll_people is '0070. ⑥ 급여 개인 줄(대표 · CFO만 읽는다). 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_payroll_people enable row level security;
revoke all on table fin_payroll_people from public, anon, authenticated;
grant select on table fin_payroll_people to authenticated;
create policy fin_payroll_people_read on fin_payroll_people for select to authenticated
  using (coalesce(is_active(), false) and auth_role()::text in ('Chairman', 'GroupCFO'));

-- =====================================================================
-- 4절. RPC — 판정은 can_keep_books(그 회사 장부를 쓰는 사람). AIAgent · Integration은 can_keep_books가 false다.
-- =====================================================================

/** 그 회사 · 그 달이 마감됐나(0015 closings.closed). */
create or replace function fin_month_closed(p_business text, p_period text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from closings c where c.business_id = p_business and c.period = p_period and c.closed);
$fn$;

create or replace function fin_upload_audit(p_action audit_action, p_id uuid, p_biz text, p_before jsonb, p_after jsonb, p_note text)
returns void
language sql security definer set search_path = public, pg_temp as $fn$
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (p_action, 'fin_uploads', p_id::text, p_biz, auth.uid(), auth_role()::text, p_before, p_after, p_note);
$fn$;

/** 미리보기 대기 · 실패 기록. 같은 파일이 이미 살아 있으면 fin_upload_duplicate. */
create or replace function fin_upload_record(
  p_business text, p_kind text, p_period text, p_file_name text, p_sha text, p_sheet text,
  p_confidence text, p_ai_used int, p_status text, p_pending jsonb, p_error text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id uuid;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_status not in ('needs_review', 'failed') then
    raise exception 'fin_upload_status' using errcode = '22023';
  end if;
  -- 리뷰 I-1: 실패 기록은 줄을 두지 않는다 · 대기 줄은 5MB까지.
  if p_status = 'failed' then
    p_pending := null;
  end if;
  if p_pending is not null and pg_column_size(p_pending) > 5 * 1024 * 1024 then
    raise exception 'fin_upload_rows' using errcode = '22023';
  end if;
  if p_status = 'needs_review' and exists (
    select 1 from fin_uploads u where u.business_id = p_business and u.kind = coalesce(p_kind, 'unknown')
       and coalesce(u.period, '') = coalesce(p_period, '') and u.file_sha256 = p_sha and u.status in ('needs_review', 'applied')
  ) then
    raise exception 'fin_upload_duplicate' using errcode = '23505';
  end if;
  insert into fin_uploads (business_id, kind, period, file_name, file_sha256, sheet_name, ai_confidence, ai_used, status, pending, error,
                           row_count)
  values (p_business, coalesce(p_kind, 'unknown'), p_period, p_file_name, p_sha, p_sheet, coalesce(p_confidence, 'none'),
          coalesce(p_ai_used, 0), p_status, p_pending, left(p_error, 500),
          coalesce(jsonb_array_length(case when jsonb_typeof(p_pending -> 'rows') = 'array' then p_pending -> 'rows' end), 0))
  returning upload_id into v_id;
  perform fin_upload_audit('create', v_id, p_business, null,
    jsonb_build_object('kind', p_kind, 'period', p_period, 'status', p_status, 'sha256', p_sha), '회계 · 재무 자료 올리기 기록(0070)');
  return v_id;
end;
$fn$;

/**
 * 넣기. p_upload가 있으면 그 미리보기 대기를 넣고(종류 · 기간은 사람이 고친 값), 없으면 새 기록으로 바로 넣는다(자동 넣기).
 * p_rows = 줄 배열(row_no + 그 종류의 칸). 급여는 p_people(개인 줄 — 사번 · 줄 번호만)도.
 * 겹침: 같은 회사 · 종류 · 기간의 applied가 있으면 p_overlap 필수 — replace(기존 무효 · 'replaced') · keep_old(새 것 'skipped').
 * 마감 달: 대표 · 그룹 CFO + 이유만. 자동(p_auto)은 겹침 · 마감이면 거부(fin_upload_auto_blocked) — 미리보기로 돌린다.
 */
create or replace function fin_upload_apply(
  p_business text, p_kind text, p_period text, p_file_name text, p_sha text, p_sheet text,
  p_confidence text, p_ai_used int, p_auto boolean, p_rows jsonb, p_people jsonb,
  p_overlap text, p_reason text, p_upload uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id      uuid;
  v_old     uuid[];
  v_closed  boolean;
  v_n       int;
  v_status  text := 'applied';
  v_row     fin_uploads;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll', 'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings') then
    raise exception 'fin_upload_kind' using errcode = '22023';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fin_upload_period' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 20000 then
    raise exception 'fin_upload_rows' using errcode = '22023';
  end if;
  if p_overlap is null or p_overlap not in ('none', 'replace', 'keep_old') then
    raise exception 'fin_upload_overlap_choice' using errcode = '22023';
  end if;
  -- 같은 회사 · 종류 · 기간의 살아 있는 올리기 — 동시에 두 사람이 넣지 못하게 잠근다.
  perform pg_advisory_xact_lock(hashtext('fin_upload:' || p_business || ':' || p_kind || ':' || p_period));
  -- 리뷰 I-2: 옛 올리기를 잠그고 읽는다(되돌리기와 엇갈리지 않게 — 되돌리기도 같은 자문 잠금을 잡는다).
  select array_agg(x.upload_id) into v_old
    from (select u.upload_id from fin_uploads u
           where u.business_id = p_business and u.kind = p_kind and u.period = p_period and u.status = 'applied'
             and u.upload_id is distinct from p_upload
           for update) x;
  v_closed := fin_month_closed(p_business, p_period);

  if coalesce(p_auto, false) and (v_old is not null or v_closed) then
    raise exception 'fin_upload_auto_blocked' using errcode = '22023';
  end if;
  if v_closed and not (coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') and length(btrim(coalesce(p_reason, ''))) >= 2) then
    raise exception 'fin_upload_closed' using errcode = '42501';
  end if;
  if v_old is not null and p_overlap = 'none' then
    raise exception 'fin_upload_overlap' using errcode = '23505';
  end if;
  if v_old is null and p_overlap <> 'none' then
    -- 겹침이 없는데 고른 값이 오면 그냥 넣는다(기록은 none으로).
    p_overlap := 'none';
  end if;
  if p_overlap = 'keep_old' then
    v_status := 'skipped';
  end if;

  if p_upload is not null then
    select * into v_row from fin_uploads where upload_id = p_upload and business_id = p_business for update;
    if v_row.upload_id is null or v_row.status <> 'needs_review' then
      raise exception 'fin_upload_not_pending' using errcode = '22023';
    end if;
    if exists (select 1 from fin_uploads u where u.business_id = p_business and u.kind = p_kind and u.period = p_period
                  and u.file_sha256 = v_row.file_sha256 and u.status in ('needs_review', 'applied') and u.upload_id <> p_upload) then
      raise exception 'fin_upload_duplicate' using errcode = '23505';
    end if;
    update fin_uploads
       set kind = p_kind, period = p_period, sheet_name = coalesce(p_sheet, sheet_name), status = v_status,
           auto = coalesce(p_auto, false), overlap = p_overlap, reason = nullif(btrim(coalesce(p_reason, '')), ''), pending = null,
           row_count = jsonb_array_length(p_rows), applied_at = now(), applied_by = auth.uid()
     where upload_id = p_upload;
    v_id := p_upload;
  else
    if exists (select 1 from fin_uploads u where u.business_id = p_business and u.kind = p_kind and u.period = p_period
                  and u.file_sha256 = p_sha and u.status in ('needs_review', 'applied')) then
      raise exception 'fin_upload_duplicate' using errcode = '23505';
    end if;
    insert into fin_uploads (business_id, kind, period, file_name, file_sha256, sheet_name, ai_confidence, ai_used, auto, status,
                             row_count, overlap, reason, applied_at, applied_by)
    values (p_business, p_kind, p_period, p_file_name, p_sha, p_sheet, coalesce(p_confidence, 'none'), coalesce(p_ai_used, 0),
            coalesce(p_auto, false), v_status, jsonb_array_length(p_rows), p_overlap, nullif(btrim(coalesce(p_reason, '')), ''),
            now(), auth.uid())
    returning upload_id into v_id;
  end if;

  if v_status = 'applied' then
    if p_overlap = 'replace' then
      perform fin_upload_void(v_old);
      update fin_uploads set status = 'replaced', replaced_by = v_id where upload_id = any (v_old) and status = 'applied';
    end if;
  if false then null;
  elsif p_kind = 'sales' then
    insert into fin_sales_lines (upload_id, business_id, period, row_no, customer, product, qty, unit_price, amount)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.customer, x.product, x.qty, x.unit_price, x.amount
      from jsonb_to_recordset(p_rows) as x(row_no int, customer text, product text, qty numeric, unit_price numeric, amount numeric);
  elsif p_kind = 'purchase_in' then
    insert into fin_purchase_in_lines (upload_id, business_id, period, row_no, material, supplier, material_kind, qty, amount)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.material, x.supplier, x.material_kind, x.qty, x.amount
      from jsonb_to_recordset(p_rows) as x(row_no int, material text, supplier text, material_kind text, qty numeric, amount numeric);
  elsif p_kind = 'inventory' then
    insert into fin_inventory_lines (upload_id, business_id, period, row_no, item, used_qty, stock_qty, amount)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.item, x.used_qty, x.stock_qty, x.amount
      from jsonb_to_recordset(p_rows) as x(row_no int, item text, used_qty numeric, stock_qty numeric, amount numeric);
  elsif p_kind = 'production' then
    insert into fin_production_lines (upload_id, business_id, period, row_no, product, qty)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.product, x.qty
      from jsonb_to_recordset(p_rows) as x(row_no int, product text, qty numeric);
  elsif p_kind = 'ledger' then
    insert into fin_ledger_sums (upload_id, business_id, period, row_no, account_code, account_name, debit, credit)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.account_code, x.account_name, x.debit, x.credit
      from jsonb_to_recordset(p_rows) as x(row_no int, account_code text, account_name text, debit numeric, credit numeric);
  elsif p_kind = 'payroll' then
    insert into fin_payroll_depts (upload_id, business_id, period, row_no, dept, salary, bonus, severance)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.dept, x.salary, x.bonus, x.severance
      from jsonb_to_recordset(p_rows) as x(row_no int, dept text, salary numeric, bonus numeric, severance numeric);
    insert into fin_payroll_people (upload_id, business_id, period, row_no, dept, person_ref, salary, bonus, severance)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.dept, x.person_ref, x.salary, x.bonus, x.severance
      from jsonb_to_recordset(coalesce(p_people, '[]'::jsonb)) as x(row_no int, dept text, person_ref text, salary numeric, bonus numeric, severance numeric);
  elsif p_kind = 'import' then
    insert into fin_import_lines (upload_id, business_id, period, row_no, ref_no, material, supplier, currency, amount, fx_rate, amount_krw, extra_cost)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.ref_no, x.material, x.supplier, x.currency, x.amount, x.fx_rate, x.amount_krw, x.extra_cost
      from jsonb_to_recordset(p_rows) as x(row_no int, ref_no text, material text, supplier text, currency text, amount numeric, fx_rate numeric, amount_krw numeric, extra_cost numeric);
  elsif p_kind = 'cashflow' then
    insert into fin_cash_flows (upload_id, business_id, period, row_no, flow_date, category, inflow, outflow)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.flow_date, x.category, x.inflow, x.outflow
      from jsonb_to_recordset(p_rows) as x(row_no int, flow_date date, category text, inflow numeric, outflow numeric);
  elsif p_kind = 'card' then
    insert into fin_card_lines (upload_id, business_id, period, row_no, used_on, merchant, dept, card_last4, amount)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.used_on, x.merchant, x.dept, x.card_last4, x.amount
      from jsonb_to_recordset(p_rows) as x(row_no int, used_on date, merchant text, dept text, card_last4 text, amount numeric);
  elsif p_kind = 'overseas' then
    insert into fin_overseas_costs (upload_id, business_id, period, row_no, entity, item, currency, amount, fx_rate, amount_krw)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.entity, x.item, x.currency, x.amount, x.fx_rate, x.amount_krw
      from jsonb_to_recordset(p_rows) as x(row_no int, entity text, item text, currency text, amount numeric, fx_rate numeric, amount_krw numeric);
  elsif p_kind = 'promo' then
    insert into fin_promo_costs (upload_id, business_id, period, row_no, person, item, currency, amount)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.person, x.item, x.currency, x.amount
      from jsonb_to_recordset(p_rows) as x(row_no int, person text, item text, currency text, amount numeric);
  elsif p_kind = 'loans' then
    insert into fin_loans (upload_id, business_id, period, row_no, lender, principal, rate, maturity, terms, principal_paid, interest_paid)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.lender, x.principal, x.rate, x.maturity, x.terms, x.principal_paid, x.interest_paid
      from jsonb_to_recordset(p_rows) as x(row_no int, lender text, principal numeric, rate numeric, maturity date, terms text, principal_paid numeric, interest_paid numeric);
  elsif p_kind = 'borrowings' then
    insert into fin_borrowings (upload_id, business_id, period, row_no, tx_date, lender, direction, amount, method)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.tx_date, x.lender, x.direction, x.amount, x.method
      from jsonb_to_recordset(p_rows) as x(row_no int, tx_date date, lender text, direction text, amount numeric, method text);
  elsif p_kind = 'savings' then
    insert into fin_savings_lines (upload_id, business_id, period, row_no, item, labor_cost, target, actual)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.item, x.labor_cost, x.target, x.actual
      from jsonb_to_recordset(p_rows) as x(row_no int, item text, labor_cost numeric, target numeric, actual numeric);
  else
    raise exception 'fin_upload_kind' using errcode = '22023';
  end if;
    get diagnostics v_n = row_count;
  end if;

  perform fin_upload_audit('create', v_id, p_business, null,
    jsonb_build_object('kind', p_kind, 'period', p_period, 'rows', jsonb_array_length(p_rows), 'auto', coalesce(p_auto, false),
                       'overlap', p_overlap, 'replaced', to_jsonb(v_old), 'closed_month', v_closed, 'status', v_status),
    case when coalesce(p_auto, false) then '회계 · 재무 자료 자동 넣기(0070)' else '회계 · 재무 자료 넣기(0070)' end);

  if coalesce(p_auto, false) then
    insert into notifications (user_id, kind, title, body, link)
    values (auth.uid(), 'system', '자료를 자동으로 넣었습니다', p_kind || ' · ' || p_period || ' · ' || jsonb_array_length(p_rows) || '줄 — 7일 안에 되돌릴 수 있습니다.',
            '/finance/' || p_business || '/upload');
  end if;
  return v_id;
end;
$fn$;

/** 그 올리기들의 줄 전부 무효(voided_at). 지우지 않는다. 이 파일의 RPC만 부른다. */
create or replace function fin_upload_void(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_ids is null then
    return;
  end if;
  update fin_sales_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_purchase_in_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_inventory_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_production_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_ledger_sums set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_payroll_depts set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_import_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_cash_flows set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_card_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_overseas_costs set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_promo_costs set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_loans set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_borrowings set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_savings_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_payroll_people set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
end;
$fn$;

/** 그 올리기들의 줄을 되살린다(바꾸기를 되돌릴 때 옛 줄). 이 파일의 RPC만 부른다. */
create or replace function fin_upload_unvoid(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_ids is null then
    return;
  end if;
  update fin_sales_lines set voided_at = null where upload_id = any (p_ids);
  update fin_purchase_in_lines set voided_at = null where upload_id = any (p_ids);
  update fin_inventory_lines set voided_at = null where upload_id = any (p_ids);
  update fin_production_lines set voided_at = null where upload_id = any (p_ids);
  update fin_ledger_sums set voided_at = null where upload_id = any (p_ids);
  update fin_payroll_depts set voided_at = null where upload_id = any (p_ids);
  update fin_import_lines set voided_at = null where upload_id = any (p_ids);
  update fin_cash_flows set voided_at = null where upload_id = any (p_ids);
  update fin_card_lines set voided_at = null where upload_id = any (p_ids);
  update fin_overseas_costs set voided_at = null where upload_id = any (p_ids);
  update fin_promo_costs set voided_at = null where upload_id = any (p_ids);
  update fin_loans set voided_at = null where upload_id = any (p_ids);
  update fin_borrowings set voided_at = null where upload_id = any (p_ids);
  update fin_savings_lines set voided_at = null where upload_id = any (p_ids);
  update fin_payroll_people set voided_at = null where upload_id = any (p_ids);
end;
$fn$;

/**
 * 되돌리기 — 넣은 지 7일 안, 그 회사 장부를 쓰는 사람. 마감 달이면 대표 · CFO만.
 * 리뷰 I-3: 이 올리기가 옛 올리기를 바꿨으면(replaced_by) 옛 줄을 되살리고 옛 올리기를 다시 applied로 — 그 달이 비지 않는다.
 */
create or replace function fin_upload_revert(p_upload uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row  fin_uploads;
  v_prev uuid[];
begin
  select * into v_row from fin_uploads where upload_id = p_upload for update;
  if v_row.upload_id is null or not coalesce(can_keep_books(v_row.business_id), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if v_row.status <> 'applied' then
    return false;
  end if;
  if v_row.applied_at < now() - interval '7 days' then
    raise exception 'fin_upload_revert_expired' using errcode = '22023';
  end if;
  if fin_month_closed(v_row.business_id, v_row.period) and coalesce(auth_role()::text, '') not in ('Chairman', 'GroupCFO') then
    raise exception 'fin_upload_closed' using errcode = '42501';
  end if;
  -- 리뷰 I-2: 넣기와 같은 자문 잠금.
  perform pg_advisory_xact_lock(hashtext('fin_upload:' || v_row.business_id || ':' || v_row.kind || ':' || v_row.period));
  perform fin_upload_void(array[p_upload]);
  select array_agg(u.upload_id) into v_prev from fin_uploads u where u.replaced_by = p_upload and u.status = 'replaced';
  if v_prev is not null then
    perform fin_upload_unvoid(v_prev);
    update fin_uploads set status = 'applied', replaced_by = null where upload_id = any (v_prev);
  end if;
  update fin_uploads set status = 'reverted', reverted_at = now(), reverted_by = auth.uid(),
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), reason)
   where upload_id = p_upload;
  perform fin_upload_audit('update', p_upload, v_row.business_id, jsonb_build_object('status', 'applied'),
    jsonb_build_object('status', 'reverted', 'reason', p_reason, 'restored', to_jsonb(v_prev)), '회계 · 재무 자료 되돌리기(0070)');
  return true;
end;
$fn$;

/** 미리보기 대기 취소. */
create or replace function fin_upload_cancel(p_upload uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_uploads;
begin
  select * into v_row from fin_uploads where upload_id = p_upload for update;
  if v_row.upload_id is null or not coalesce(can_keep_books(v_row.business_id), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if v_row.status <> 'needs_review' then
    return false;
  end if;
  update fin_uploads set status = 'cancelled', pending = null where upload_id = p_upload;
  perform fin_upload_audit('update', p_upload, v_row.business_id, jsonb_build_object('status', 'needs_review'),
    jsonb_build_object('status', 'cancelled'), '회계 · 재무 자료 올리기 취소(0070)');
  return true;
end;
$fn$;

/** 분류 학습 저장 — 칸 대응(이름 → 열 번호)만. 숫자는 받지 않는다(값이 숫자 · 짧은 이름뿐인지 본다). */
create or replace function fin_upload_shape_save(p_business text, p_sig text, p_sheet text, p_kind text, p_map jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_map is null or jsonb_typeof(p_map) <> 'object'
     or exists (select 1 from jsonb_each(p_map) e
                 where jsonb_typeof(e.value) <> 'number' or length(e.key) > 40
                    or (e.value)::numeric <> trunc((e.value)::numeric) or (e.value)::numeric not between 0 and 200) then
    raise exception 'fin_upload_shape' using errcode = '22023';
  end if;
  insert into fin_upload_shapes (business_id, header_sig, sheet_name, kind, column_map)
  values (p_business, p_sig, left(p_sheet, 120), p_kind, p_map)
  on conflict (business_id, header_sig) do update
     set sheet_name = excluded.sheet_name, kind = excluded.kind, column_map = excluded.column_map,
         updated_by = auth.uid(), updated_at = now();
end;
$fn$;

/** 미리보기 대기 줄 읽기 — 그 회사 장부를 쓰는 사람만. 급여 개인 줄(people)은 대표 · CFO에게만 싣는다(리뷰 I-1). */
create or replace function fin_upload_pending(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_uploads;
begin
  select * into v_row from fin_uploads where upload_id = p_upload;
  if v_row.upload_id is null or not coalesce(can_keep_books(v_row.business_id), false) or v_row.status <> 'needs_review' then
    return null;
  end if;
  if coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') then
    return v_row.pending;
  end if;
  -- 급여는 칸 격자(grid)에도 사람별 줄이 있다 — 대표 · CFO 밖에는 둘 다 뺀다.
  return case when v_row.kind = 'payroll' then v_row.pending - 'people' - 'grid' else v_row.pending - 'people' end;
end;
$fn$;

revoke all on function fin_upload_pending(uuid) from public, anon;
grant execute on function fin_upload_pending(uuid) to authenticated;
revoke all on function fin_upload_unvoid(uuid[]) from public, anon, authenticated;
revoke all on function fin_month_closed(text, text) from public, anon;
revoke all on function fin_upload_audit(audit_action, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function fin_upload_void(uuid[]) from public, anon, authenticated;
revoke all on function fin_upload_record(text, text, text, text, text, text, text, int, text, jsonb, text) from public, anon;
revoke all on function fin_upload_apply(text, text, text, text, text, text, text, int, boolean, jsonb, jsonb, text, text, uuid) from public, anon;
revoke all on function fin_upload_revert(uuid, text) from public, anon;
revoke all on function fin_upload_cancel(uuid) from public, anon;
revoke all on function fin_upload_shape_save(text, text, text, text, jsonb) from public, anon;

grant execute on function fin_month_closed(text, text) to authenticated;
grant execute on function fin_upload_record(text, text, text, text, text, text, text, int, text, jsonb, text) to authenticated;
grant execute on function fin_upload_apply(text, text, text, text, text, text, text, int, boolean, jsonb, jsonb, text, text, uuid) to authenticated;
grant execute on function fin_upload_revert(uuid, text) to authenticated;
grant execute on function fin_upload_cancel(uuid) to authenticated;
grant execute on function fin_upload_shape_save(text, text, text, text, jsonb) to authenticated;

commit;
