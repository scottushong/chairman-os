import { krw } from '@/lib/sales/cost'
import { BRIDGE_KEYS, type BridgeKey, type MarginBridge } from '@/types'

/**
 * ④ 마진 변동 분해 → 사람의 말. **코드로 만든다(AI 아님).** 0081 margin_bridge 결과만 쓴다 — 다시 계산하지 않는다.
 * 효과 부호: + = GM을 올림(판매가가 오르거나 원가가 내림), − = GM을 내림.
 */

export const BRIDGE_KO: Record<BridgeKey, string> = {
  price: '판매가',
  material: '원료비',
  mfg: '제조비',
  logi: '물류비',
  other: '기타(포장 · 간접비)',
}

/** 효과가 가장 큰(절댓값) 항목 — 같으면 앞 순서(판매가 → 원료 → 제조 → 물류 → 기타). */
export function biggestEffect(b: MarginBridge): BridgeKey | null {
  if (!b.effects) return null
  let best: BridgeKey | null = null
  for (const k of BRIDGE_KEYS) {
    if (best === null || Math.abs(b.effects[k]) > Math.abs(b.effects[best])) best = k
  }
  return best
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${krw(Math.abs(n))}`

/**
 * 대시보드 한 줄: «이번 달 마진이 X원/kg 떨어졌습니다 — 가장 큰 이유: 원료비(+4.2%)».
 * 원료비가 가장 큰 이유면 괄호에 원료비 변화율(%), 그 밖은 그 항목이 GM에 준 원/kg.
 */
export function bridgeSentence(b: MarginBridge, label = '이번 달'): string {
  if (b.reason || b.total === null || !b.effects) return b.reason ?? '자료 없음 · 필요한 것: 두 기간 판매 · 원가'
  const big = biggestEffect(b)
  const move = b.total < 0 ? `${krw(Math.abs(b.total))}원/kg 떨어졌습니다` : b.total > 0 ? `${krw(b.total)}원/kg 올랐습니다` : '그대로입니다'
  if (!big || b.effects[big] === 0) return `${label} 마진이 ${move}.`
  const detail =
    big === 'material' && b.material_pct !== null
      ? `${b.material_pct > 0 ? '+' : b.material_pct < 0 ? '−' : ''}${Math.abs(b.material_pct).toFixed(1)}%`
      : `${signed(b.effects[big])}원/kg`
  const why = b.total < 0 ? '가장 큰 이유' : '가장 큰 힘'
  return `${label} 마진이 ${move} — ${why}: ${BRIDGE_KO[big]}(${detail})`
}

export { signed as signedKrw }
