import { getFxStrip } from '@/lib/fx'
import { ledgerScope } from '@/lib/ledger/scope'
import type { ChairmanRepository } from '@/lib/repository'
import type { FinRow, FinUpload, OverviewLineKind } from '@/types'

import { buildChecklist, MONTHLY_MEMO, type ChecklistItem } from './checklist'
import { addMonths, monthsOfYear, type Ctx, type MonthData, type OfficialYear } from './engine'
import { parseKpiSettings } from './settings'

/**
 * 재무 현황 입력 읽기 — 사람 세션(또는 cron의 AI Agent 세션)의 RLS 안에서. 원료 숫자 종류(입고 · 재고 · OFFER · 원료 출고)의 줄은 읽지 않고
 * fin_material_totals(회사 · 달 합계 — 원료 3가지 미만이면 감춘 값)만. 급여는 부서 합계 표만(개인 줄 표는 읽지 않는다).
 */

const KINDS: { kind: OverviewLineKind; key: keyof MonthData }[] = [
  { kind: 'ledger', key: 'ledgerSums' },
  { kind: 'ledger_lines', key: 'ledgerLines' },
  { kind: 'sales', key: 'sales' },
  { kind: 'shipment', key: 'shipment' },
  { kind: 'payroll', key: 'payroll' },
  { kind: 'cashflow', key: 'cashflow' },
  { kind: 'card', key: 'card' },
  { kind: 'overseas', key: 'overseas' },
  { kind: 'promo', key: 'promo' },
  { kind: 'loans', key: 'loans' },
  { kind: 'borrowings', key: 'borrowings' },
  { kind: 'savings', key: 'savings' },
  { kind: 'tax_invoice', key: 'taxInvoice' },
  { kind: 'production', key: 'production' },
]

const range = (from: string, to: string) => {
  const out: string[] = []
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(p)
  return out
}

export interface LoadedOverview {
  ctx: Ctx
  uploads: FinUpload[]
  checklist: ChecklistItem[]
  lastUploadAt: string | null
  officialStatements: { year: string; revenue: number | null; op: number | null }[]
}

export async function loadOverview(repo: ChairmanRepository, businessId: string, period: string, today: string): Promise<LoadedOverview> {
  const todayMonth = today.slice(0, 7)
  const from = [`${period.slice(0, 4)}-01`, addMonths(todayMonth, -12), addMonths(period, -13)].sort()[0]
  const to = [period, addMonths(todayMonth, 3)].sort().at(-1)!
  const all = range(from, to)
  const heavy = [...new Set([...monthsOfYear(period), addMonths(period, -1), addMonths(period, -12), addMonths(period, -13), todayMonth, addMonths(todayMonth, -1), ...monthsOfYear(addMonths(period, -12))])].filter((p) => p >= from && p <= to)

  const [ledger, uploads, officials, settingsRaw, autoCodes, slips, ...lineSets] = await Promise.all([
    repo.loadFinanceLedger(),
    repo.listFinUploads(businessId).catch(() => [] as FinUpload[]),
    repo.listOfficialStatements(businessId).catch(() => []),
    repo.finKpiSettings(businessId).catch(() => null),
    repo.listAutoAccounts(businessId).catch(() => [] as string[]),
    repo.listFinanceImportSlips(businessId).catch(() => []),
    ...KINDS.map((k) => repo.listFinLines(k.kind, businessId, all).catch(() => [] as FinRow[])),
  ])
  const perMonth = await Promise.all(
    heavy.map(async (p) => {
      const [material, vals] = await Promise.all([repo.finMaterialTotals(businessId, p).catch(() => null), repo.listFinValuations(businessId, p).catch(() => [])])
      const live = vals.filter((v) => !v.voided_at && v.value_state !== 'missing')
      const val = (c: 'wip' | 'finished') => {
        const v = live.find((x) => x.category === c)
        return v ? Number(v.amount ?? 0) : null
      }
      return { p, material, valuation: { wip: val('wip'), finished: val('finished') }, valuationAt: live[0]?.entered_at ?? null }
    }),
  )
  const months = new Map<string, MonthData>()
  for (const p of all) {
    const extra = perMonth.find((x) => x.p === p)
    const md: MonthData = {
      period: p, ledgerSums: [], ledgerLines: [], sales: [], shipment: [], payroll: [], cashflow: [], card: [], overseas: [], promo: [], loans: [], borrowings: [], savings: [], taxInvoice: [], production: [],
      material: extra?.material ?? null, valuation: extra?.valuation ?? { wip: null, finished: null }, received: new Set(uploads.filter((u) => u.period === p && u.status === 'applied').map((u) => u.kind)),
    }
    months.set(p, md)
  }
  KINDS.forEach((k, i) => {
    for (const r of lineSets[i] as FinRow[]) {
      const md = months.get(String(r.period ?? ''))
      if (md) (md[k.key] as FinRow[]).push(r)
    }
  })

  // 공식 결산(세무사 확정 — 해마다 활성 한 벌)과 그 줄.
  const yearly = officials.filter((o) => o.period_kind === 'year' && o.superseded_at === null && (o.basis ?? 'accountant') === 'accountant')
  const lines = await repo.listOfficialStatementLines(businessId, yearly.map((o) => o.id)).catch(() => [])
  const officialYears: OfficialYear[] = yearly.map((o) => ({ year: o.period_key, lines: lines.filter((l) => l.statement_id === o.id).map((l) => ({ account_code: l.account_code, amount: l.amount })) }))
  const accounts = new Map(ledger.accounts.filter((a) => a.business_id === businessId).map((a) => [a.account_code, a]))
  const officialStatements = officialYears
    .map((o) => {
      const sec = (code: string) => accounts.get(code)?.section
      const sum = (ss: string[]) => o.lines.filter((l) => ss.includes(sec(l.account_code) ?? '')).reduce((a, l) => a + l.amount, 0)
      const revenue = -sum(['revenue'])
      const op = revenue - sum(['cogs']) - sum(['sga', 'd_and_a'])
      return { year: o.year, revenue: o.lines.length ? revenue : null, op: o.lines.length ? op : null }
    })
    .sort((a, b) => a.year.localeCompare(b.year))

  const settings = parseKpiSettings(settingsRaw)
  let usdKrw = settings.usd_krw
  if (!usdKrw) usdKrw = (await getFxStrip().catch(() => null))?.chips.find((c) => c.code === 'USD')?.krw ?? null

  const human = ledger.accounts.filter((a) => a.business_id === businessId)
  const auto = new Set(autoCodes)
  const accountsState = human.length === 0 ? 'none' : human.every((a) => auto.has(a.account_code)) ? 'auto' : 'file'
  const slip = slips.find((x) => x.month === period && !x.superseded_at)
  // ECOUNT 월별 손익 전표가 없으면 (지운) «월별 입력» 손입력 전표(«YYYY-MM 월별 간이 손익») — 둘 다 장부에 있다(2026-10-20 A2 · A5).
  const manual = slip ? null : ledger.entries.find((e) => e.business_id === businessId && !e.correction_kind && MONTHLY_MEMO.exec(e.memo)?.[1] === period)
  const slipAt = slip ? (ledger.entries.find((e) => e.business_id === businessId && e.slip_no === slip.slip_no) as { created_at?: string } | undefined)?.created_at ?? `${period}-01T00:00:00Z` : manual ? manual.created_at ?? `${period}-01T00:00:00Z` : null
  const checklist = buildChecklist({
    period,
    uploads,
    accounts: accountsState,
    accountsAt: null,
    plMonthlyAt: slipAt,
    valuationAt: perMonth.find((x) => x.p === period)?.valuationAt ?? null,
  })
  const lastUploadAt = uploads.filter((u) => u.status === 'applied').map((u) => u.applied_at ?? u.created_at).sort().at(-1) ?? null

  return {
    ctx: { businessId, today, scope: ledgerScope(ledger, [businessId]), accounts, months, officials: officialYears, settings, usdKrw },
    uploads,
    checklist,
    lastUploadAt,
    officialStatements,
  }
}
