import 'server-only'

import { kstToday } from '@/lib/chairman-project'
import { computeCalendar } from '@/lib/finance-overview/cash-days'
import { computeKpis, type Kpi } from '@/lib/finance-overview/kpis'
import { loadOverview } from '@/lib/finance-overview/load'
import type { ChairmanRepository } from '@/lib/repository/types'

import type { DataStatus } from './types'

/**
 * DY Portfolio ↔ 재무(/finance) — 읽기만(재무 쪽은 고치지 않는다). 대양산업(biz_dy)의 자금 전망.
 *   지표 8 «자금 전망(3개월)» · 지표 12 «투자 여력» = min(3개월 최저 잔액) − 안전 잔액 + 쓰지 않은 대출 한도(kpis.ts 그대로).
 *   자금 4영역(시안): A 운영자금 = 향후 3개월 평균 지출 · B 유동성 준비금 = 안전 잔액 · C 전략사업 자금 = 재무에 칸 없음(UNAVAILABLE) ·
 *   D 장기투자 가능 = 지표 12의 여력(양수일 때만 — 앞의 셋을 지킨 뒤 남는 현금).
 */
export interface FinanceLink {
  status: DataStatus
  k8: Kpi | null
  k12: Kpi | null
  operating: number | null
  reserve: number | null
  strategic: null
  investable: number | null
  note: string | null
}

export async function financeLink(repo: ChairmanRepository, businessId = 'biz_dy'): Promise<FinanceLink> {
  const today = kstToday()
  const period = today.slice(0, 7)
  try {
    const { ctx } = await loadOverview(repo, businessId, period, today, { auto: true })
    const kpis = computeKpis(ctx, period)
    const cal = computeCalendar(ctx, period)
    const fut = cal.forecast.filter((f) => f.low !== null)
    const lows = fut.map((f) => f.low!)
    const room = lows.length && cal.safety.value !== null ? Math.min(...lows) - cal.safety.value + (ctx.settings.unused_credit ?? 0) : null
    const operating = cal.forecast.length ? cal.forecast.reduce((s, f) => s + f.outflow, 0) / cal.forecast.length : null
    return {
      status: room === null ? 'PARTIAL' : 'LIVE',
      k8: kpis.find((k) => k.no === 8) ?? null,
      k12: kpis.find((k) => k.no === 12) ?? null,
      operating: operating && operating > 0 ? operating : null,
      reserve: cal.safety.value,
      strategic: null,
      investable: room === null ? null : Math.max(0, room),
      note: room === null ? '재무 자료 부족 — /finance 자금 전망(지표 8 · 12)이 계산되어야 합니다' : null,
    }
  } catch (e) {
    return { status: 'UNAVAILABLE', k8: null, k12: null, operating: null, reserve: null, strategic: null, investable: null, note: `재무 읽기 실패: ${e instanceof Error ? e.message.slice(0, 80) : '알 수 없음'}` }
  }
}
