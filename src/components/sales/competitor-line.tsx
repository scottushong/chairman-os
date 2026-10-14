import { BLUEPRINT_OFF, blueprintErrorKey } from '@/lib/blueprint/format'
import { krw } from '@/lib/sales/cost'
import type { ChairmanRepository } from '@/lib/repository/types'

/**
 * ⑤ 경쟁사 기준 한 줄(0081 competitor_price) — «경쟁사 예상 최소가 ₩ / 우리 목표가 ₩ / 그 값에서 우리 마진 % · 등급».
 * 결과만 받는다(경쟁사 가정 · 원가 값은 DB가 돌려주지 않는다). 부를 때마다 제품 하나 = 문 한 건(영업 0시 기준 · 하루 200건).
 * 부르는 화면이 스위치 'competitor_price'를 먼저 본다.
 */
export async function CompetitorLine({ repo, productId, label }: { repo: ChairmanRepository; productId: string; label?: string }) {
  let text: string
  let tone = 'text-ink'
  try {
    const c = await repo.competitorPrice(productId)
    if (!c || !c.computed) {
      text = '경쟁사 기준 — 아직 계산 전입니다(원가 자료가 다 모이지 않음).'
      tone = 'text-ink-muted'
    } else {
      const m = c.our_margin_at_competitor_pct
      text = `경쟁사 예상 최소가 ₩${krw(c.competitor_min_krw_per_kg)} / 우리 목표가 ₩${krw(c.our_target_krw_per_kg)} / 그 값에서 우리 마진 ${m === null ? '—' : `${m.toFixed(1)}%`} · ${c.grade_at_competitor ?? '—'}`
      tone = m !== null && m < 15 ? 'text-critical' : 'text-ink'
    }
  } catch (e) {
    console.error('[sales] competitor_price', e instanceof Error ? e.message : String(e))
    const k = blueprintErrorKey(e)
    text = k === 'off' ? BLUEPRINT_OFF : k === 'unavailable' ? '경쟁사 기준은 준비 중입니다.' : /cost_rate_limited/.test(e instanceof Error ? e.message : '') ? '오늘 조회 한도에 걸렸습니다.' : '경쟁사 기준을 불러오지 못했습니다.'
    tone = 'text-ink-muted'
  }
  return (
    <p className={`text-t12 tnum ${tone}`}>
      {label ? <span className="mr-1.5 font-semibold text-ink">{label}</span> : null}
      {text}
    </p>
  )
}
