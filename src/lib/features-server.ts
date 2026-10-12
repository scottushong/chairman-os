import 'server-only'

import { cache } from 'react'

import { featureOnFor, hiddenNavKeys, type FeatureKey, type FeatureSwitchRow } from '@/lib/features'
import { getRepository } from '@/lib/repository'
import type { Role, SessionUser } from '@/types'

/**
 * 기능 스위치(0073)를 DB에서 읽는 서버 쪽. 요청당 한 번만 읽는다(React cache — 요청이 끝나면 버려진다).
 * 0073 전 DB · 읽기 실패면 null → lib/features.ts 기본값(앱이 DB보다 먼저 나가도 화면이 그대로).
 * dummy 모드는 dummy-features.ts의 메모리 줄(같은 기본값)을 읽는다.
 */
export const loadFeatureSwitches = cache(async function loadFeatureSwitches(): Promise<FeatureSwitchRow[] | null> {
  try {
    return await (await getRepository()).listFeatureSwitches()
  } catch (e) {
    console.error('[features] 스위치를 못 읽었다 — 기본값으로', e)
    return null
  }
})

/** 이 기능이 이 사람에게 켜져 있나(회사 줄 → 그룹 줄 → 기본값). 로그인 안 했으면 false. */
export async function featureOn(user: Pick<SessionUser, 'role'> | null | undefined, key: FeatureKey, businessId?: string | null): Promise<boolean> {
  if (!user) return false
  return featureOnFor(await loadFeatureSwitches(), key, user.role, businessId)
}

/** 사이드바에서 뺄 메뉴 키(꺼진 기능의 메뉴). */
export async function hiddenNavFor(role: Role | null | undefined): Promise<string[]> {
  if (!role) return []
  return hiddenNavKeys(await loadFeatureSwitches(), role)
}
