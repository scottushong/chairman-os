import type { ChairmanRepository } from '@/lib/repository'

import { addMonths, computeCash, computeDebt, computePl } from './engine'
import { loadOverview } from './load'

/**
 * 0085 다시 계산 — 큐(fin_recalc_jobs)의 일을 가져가 그 회사 · 그 달부터 이번 달까지 «재무 현황 저장본»(회사 합계)을 다시 쓰고,
 * 월별 손익(0075 재고 반영)의 잠정 저장본도 다시 남긴다(스위치 · 권한이 허락할 때만 — 막히면 건너뛴다).
 *   부르는 곳 셋: 저장 · 되돌리기 직후(after — 그 사람 세션) · 재무 현황을 열 때(기다리는 일이 있으면) · 새벽 cron(AI Agent 세션).
 *   service_role 없음. 실패는 큐가 다섯 번까지 다시 기다리게 한다.
 * 저장본은 여럿이 읽는다 — 원료 줄이 셋 미만인 달의 원료 합계는 돌리는 사람과 상관없이 감춘 채 계산한다(그 달은 재고 반영 대신 장부 원가).
 *   원료별 숫자 · 원료 재고 합계 자체는 싣지 않는다(손익 합계 · 현금 · 차입만).
 */

export interface RecalcOutcome {
  jobs: number
  months: number
  failed: number
}

const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)

export async function processRecalc(repo: ChairmanRepository, o: { businessId: string | null; limit?: number; today?: string; plRecord?: boolean }): Promise<RecalcOutcome> {
  const today = o.today ?? kstToday()
  const jobs = await repo.finRecalcClaim(o.businessId, o.limit ?? 3).catch((e) => {
    console.error('[fin-recalc] claim', e instanceof Error ? e.message : e)
    return []
  })
  let months = 0
  let failed = 0
  for (const job of jobs) {
    try {
      const end = today.slice(0, 7) > job.from_period ? today.slice(0, 7) : job.from_period
      const periods: string[] = []
      for (let p = job.from_period; p <= end && periods.length < 15; p = addMonths(p, 1)) periods.push(p)
      // 한 해 단위로 읽는다(입력 모양이 그 해 1월 ~ 이번 달 + 앞 13달).
      const years = [...new Set(periods.map((p) => p.slice(0, 4)))]
      for (const y of years) {
        const last = periods.filter((p) => p.startsWith(y)).at(-1)!
        const { ctx } = await loadOverview(repo, job.business_id, last, today)
        // 저장본은 여럿이 읽는다 — 원료 줄이 셋 미만인 달의 원료 합계는 (돌리는 사람이 대표여도) 감춘 것으로 계산한다(0080과 같은 문).
        for (const m of ctx.months.values()) {
          if (!m.material) continue
          const t = m.material
          m.material = {
            ...t,
            purchase_amount: t.purchase_lines < 3 ? null : t.purchase_amount,
            inventory_closing: t.inventory_lines < 3 ? null : t.inventory_closing,
            inventory_opening: t.inventory_lines < 3 ? null : t.inventory_opening,
          }
        }
        for (const p of periods.filter((x) => x.startsWith(y))) {
          const pl = computePl(ctx, p)
          const cash = computeCash(ctx, p)
          const debt = computeDebt(ctx, p)
          const totals = {
            pl: { source: pl.source, method: pl.cogsBasis.method, revenue: pl.revenue, cogs: pl.cogs, gross: pl.gross, sga: pl.sga, op: pl.op, nonop: pl.nonop, net: pl.net },
            cash: { opening: cash.opening, closing: cash.closing, net: cash.net, operating: cash.operating, inflow: cash.inflow, outflow: cash.outflow },
            debt: { total: debt.total, monthly_pay: debt.monthlyPay, monthly_interest: debt.monthlyInterest },
          }
          const missing = [...pl.notes, ...(cash.hasFlows ? [] : ['월별 자금흐름표']), ...(debt.total === null ? ['대출현황 · 차입금'] : [])]
          await repo.finOverviewSave(job.business_id, p, totals, missing.slice(0, 20), true)
          if (o.plRecord !== false) await repo.finPlRecord(job.business_id, p, false, null).catch(() => undefined)
          months += 1
        }
      }
      await repo.finRecalcFinish(job.job_id, true, null)
    } catch (e) {
      failed += 1
      const m = e instanceof Error ? e.message : String(e)
      console.error('[fin-recalc]', job.business_id, m)
      await repo.finRecalcFinish(job.job_id, false, m.slice(0, 300)).catch(() => undefined)
    }
  }
  return { jobs: jobs.length, months, failed }
}
