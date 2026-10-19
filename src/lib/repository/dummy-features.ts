import { defaultFeatureRows, FEATURE_AUDIENCES, isFeatureKey, type FeatureSwitchRow } from '@/lib/features'
import type { UserAccount } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * 0073 기능 스위치의 dummy 자리 — 메모리 줄(0073 3절과 같은 기본 줄). **DB가 막는 것을 여기서도 막는다**:
 * 대표만 · 이유 2자 이상 · 아는 기능만 · 범위 셋 중 하나. 감사는 콘솔(dummy 감사 표는 이력 대상만 받는다).
 * 프로세스당 한 벌 — 서버를 다시 켜면 기본값으로 돌아간다.
 */

type Methods = Pick<ChairmanRepository, 'listFeatureSwitches' | 'setFeatureSwitch'>

const memory: FeatureSwitchRow[] = defaultFeatureRows()

/**
 * 0081 청사진 뼈대 — dummy 전용 화면 확인 손잡이. DUMMY_FEATURES_OPEN=1이면 새 스위치 일곱 개를 처음부터 'all'로 연다
 * (직원 자리 — 원가 관리 · 영업 · 구매 · 생산 — 의 화면을 찍어 보려고). live에는 이 길이 없다(운영 기본값은 0081 그대로 대표만).
 */
const BLUEPRINT_KEYS = ['cost_forecast', 'purchase_performance', 'customer_profit', 'margin_bridge', 'competitor_price', 'work_orders', 'product_diagnosis']
if (process.env.DUMMY_FEATURES_OPEN === '1') {
  for (const r of memory) if (r.business_id === null && BLUEPRINT_KEYS.includes(r.feature_key)) r.audience = 'all'
}

/**
 * 0087 전자결재 — dummy 전용 손잡이. DUMMY_EA_OPEN=biz_dy면 «대표가 그 회사 줄을 켠» 상태(회사 줄 · 전원)로 시작한다.
 * 서버를 다시 켜도 같은 상태라야 A · B · 대표를 차례로 켜 보는 시험이 이어진다. live에는 이 길이 없다(운영 기본값은 0087 그대로 대표만).
 */
const eaOpen = process.env.DUMMY_EA_OPEN?.trim()
if (eaOpen && /^[a-z0-9_]{2,40}$/.test(eaOpen)) {
  memory.push({ business_id: eaOpen, feature_key: 'approvals', enabled: true, audience: 'all', reason: 'dummy 시험 — 회사 줄 전원', updated_by: null, updated_at: new Date().toISOString() })
}

export function dummyFeatures(deps: { viewer(): UserAccount; businesses(): string[] }): Methods {
  return {
    async listFeatureSwitches() {
      return memory.map((r) => ({ ...r }))
    },
    async setFeatureSwitch(input) {
      const me = deps.viewer()
      if (me.role !== 'Chairman') throw new Error('feature_switch_denied')
      const reason = input.reason.trim()
      if (reason.length < 2 || reason.length > 500) throw new Error('feature_switch_reason')
      if (!FEATURE_AUDIENCES.includes(input.audience)) throw new Error('feature_switch_value')
      if (!isFeatureKey(input.feature_key)) throw new Error('feature_switch_unknown')
      if (input.business_id !== null && !deps.businesses().includes(input.business_id)) throw new Error('feature_switch_business')
      const row: FeatureSwitchRow = {
        business_id: input.business_id,
        feature_key: input.feature_key,
        enabled: input.enabled,
        audience: input.audience,
        reason,
        updated_by: me.user_id,
        updated_at: new Date().toISOString(),
      }
      const i = memory.findIndex((r) => r.feature_key === row.feature_key && r.business_id === row.business_id)
      if (i >= 0) memory[i] = row
      else memory.push(row)
      console.info('[dummy audit] 기능 스위치 바꾸기(0073)', row)
    },
  }
}
