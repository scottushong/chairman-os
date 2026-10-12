'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { FEATURE_AUDIENCES, isFeatureKey, type FeatureAudience } from '@/lib/features'
import { getRepository } from '@/lib/repository'

/**
 * 기능 스위치 바꾸기(0073) — /settings/features. 대표만 · 이유 필수. 실제 문은 0073 feature_switch_set(대표만 · 이유 · 감사)이다.
 * 여기서는 모양만 본다.
 */

const BIZ = /^[a-z0-9_]{2,40}$/

const ERRORS: [RegExp, string][] = [
  [/feature_switch_denied/, '대표만 바꿀 수 있습니다.'],
  [/feature_switch_reason/, '바꾸는 이유를 2자 이상 적으세요.'],
  [/feature_switch_unknown/, '모르는 기능입니다.'],
  [/feature_switch_business/, '모르는 회사입니다.'],
  [/feature_switch_value/, '켜짐 · 범위 값이 올바르지 않습니다.'],
  [/feature_switch_unavailable/, '아직 스위치 표(0073)가 DB에 없습니다 — 마이그레이션 반영 뒤에 바꿀 수 있습니다.'],
]

export async function setFeatureSwitch(input: {
  feature: unknown
  business: unknown
  enabled: unknown
  audience: unknown
  reason: unknown
}): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') return { error: '대표만 바꿀 수 있습니다.' }
  if (!isFeatureKey(input.feature)) return { error: '모르는 기능입니다.' }
  const business = typeof input.business === 'string' && input.business !== '' ? input.business : null
  if (business !== null && !BIZ.test(business)) return { error: '모르는 회사입니다.' }
  if (typeof input.enabled !== 'boolean') return { error: '켜짐 값이 올바르지 않습니다.' }
  if (!FEATURE_AUDIENCES.includes(input.audience as FeatureAudience)) return { error: '범위 값이 올바르지 않습니다.' }
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : ''
  if (reason.length < 2) return { error: '바꾸는 이유를 2자 이상 적으세요.' }
  try {
    await (await getRepository()).setFeatureSwitch({
      feature_key: input.feature,
      business_id: business,
      enabled: input.enabled,
      audience: input.audience as FeatureAudience,
      reason,
    })
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    console.error('[setFeatureSwitch]', e)
    return { error: ERRORS.find(([re]) => re.test(m))?.[1] ?? '바꾸지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
  // 메뉴 · 화면이 모두 이 표를 본다 — 셸 전체를 다시 그린다.
  revalidatePath('/', 'layout')
  return { ok: true }
}
