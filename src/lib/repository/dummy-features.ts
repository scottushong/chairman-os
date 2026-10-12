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
