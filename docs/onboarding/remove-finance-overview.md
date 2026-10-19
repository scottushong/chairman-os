# 빼기 안내서 — 재무 현황 · «놓으면 저장» (0085)

빼는 깊이 셋. 위에서부터 — 대부분은 1)로 끝난다.

## 1) 화면만 끄기 (1분 · 되돌리기 쉬움)

`https://chairman-os-eosin.vercel.app/settings/features` → «재무 현황(한 화면)»(`finance_overview`) → 끄기 · 이유.
- `/finance`가 예전 «그룹 재무»(5개사 합산 · 재무제표 3탭)로 돌아간다. 회사별 화면(`/finance/<회사>` · 전표 · 계정과목 · 월별 · 공식 결산 · 재고 · 평가)은 그대로.
- 자료 올리기(`/finance/<회사>/upload`)는 «자료 올리기»(`finance_upload`) 스위치를 따른다 — 저장 방식(«놓으면 저장»)은 이 스위치와 무관하다.

## 2) 앱을 앞 판으로 (5분)

Vercel → Deployments → 0085 앞 Production → «Promote to Production».
- 옛 앱은 «미리보기 → 넣기» 흐름이다. 0085가 남긴 «보류» 기록(needs_review)은 옛 화면에서 «확인 필요»로 보이고 그대로 넣을 수 있다.
- 0085 칸 · 표는 남아 있어도 옛 앱이 읽지 않는다.

## 3) DB까지 (회장 · SQL — 되돌리기 어려움, 꼭 필요할 때만)

0085는 **더하기만** 했다. 빼려면 production SQL Editor에서 아래 순서(한 트랜잭션). 저장된 자료(올리기 · 줄)는 지우지 않는다 — 0085가 더한 칸 · 표 · 함수 · 트리거만.

```sql
begin;
drop trigger if exists fin_shipment_follow_trigger on fin_uploads;
drop trigger if exists fin_recalc_on_upload_trigger on fin_uploads;
drop trigger if exists fin_recalc_on_official_trigger on official_statements;
drop trigger if exists fin_recalc_on_journal_trigger on journal_entries;
drop trigger if exists fin_recalc_on_valuation_trigger on fin_inventory_valuations;
drop function if exists fin_upload_save(text, text, text, text, text, text, text, int, jsonb, jsonb, text, uuid, jsonb);
drop function if exists fin_payroll_hold(uuid, jsonb);
drop function if exists fin_payroll_held_list(text);
drop function if exists fin_payroll_release(uuid, boolean);
drop function if exists fin_recalc_request(text, text);
drop function if exists fin_recalc_claim(text, int);
drop function if exists fin_recalc_finish(uuid, boolean, text);
drop function if exists fin_overview_save(text, text, jsonb, jsonb, boolean);
drop function if exists fin_kpi_settings_save(text, jsonb, text);
drop function if exists official_statement_withdraw(bigint, text);
delete from feature_switches where feature_key = 'finance_overview';
commit;
```

표(`fin_shipment_lines` · `fin_payroll_held` · `fin_recalc_jobs` · `fin_overview_months` · `fin_kpi_settings`)와 칸(`fin_uploads.warnings` · `fin_cash_flows.account/currency/balance/planned` · `fin_loans.loan_type/loan_total/pay_day` · `accounts.auto_created`)은 **남긴다** — 지우면 되돌릴 수 없고, 남아 있어도 옛 앱은 모른다.
보류 중인 급여 개인 줄(`fin_payroll_held` 결정 전)은 빼기 전에 대표 · CFO가 «저장» 또는 «버리기»를 끝낸다.

## 확인

- `https://chairman-os-eosin.vercel.app/api/health` → `migration` 값.
- `/finance`가 그룹 재무(1) · 예전 앱(2)인지 눈으로.
