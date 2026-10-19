import 'server-only'

import { cache } from 'react'

import { closedFeatureRows, featureOnFor, featureWhyFor, hiddenNavKeys, type FeatureKey, type FeatureSwitchRow, type FeatureWhy } from '@/lib/features'
import { getRepository } from '@/lib/repository'
import type { Role, SessionUser } from '@/types'

/**
 * 기능 스위치(0073)를 DB에서 읽는 서버 쪽. 요청당 한 번만 읽는다(React cache — 요청이 끝나면 버려진다).
 * 0073 전 DB(표 없음)면 null → lib/features.ts 기본값(앱이 DB보다 먼저 나가도 화면이 그대로).
 * 그 밖의 읽기 실패는 전부 꺼짐 — 대표가 끈 기능이 잠깐의 DB 오류로 다시 열리면 안 된다(0073 리뷰 I4).
 * dummy 모드는 dummy-features.ts의 메모리 줄(같은 기본값)을 읽는다.
 */
export const loadFeatureSwitches = cache(async function loadFeatureSwitches(): Promise<FeatureSwitchRow[] | null> {
  try {
    return await (await getRepository()).listFeatureSwitches()
  } catch (e) {
    console.error('[features] 스위치를 못 읽었다 — 이 요청은 전부 꺼짐으로', e)
    return closedFeatureRows()
  }
})

/** 이 기능이 이 사람에게 켜져 있나(회사 줄 → 그룹 줄 → 기본값). 로그인 안 했으면 false. */
export async function featureOn(user: Pick<SessionUser, 'role'> | null | undefined, key: FeatureKey, businessId?: string | null): Promise<boolean> {
  if (!user) return false
  return featureOnFor(await loadFeatureSwitches(), key, user.role, businessId)
}

/** featureOn과 같은 판정 + 근거(어느 줄 · 범위) — 화면이 «왜 꺼졌나»를 말할 때. */
export async function featureWhy(user: Pick<SessionUser, 'role'> | null | undefined, key: FeatureKey, businessId?: string | null): Promise<FeatureWhy> {
  const why = featureWhyFor(await loadFeatureSwitches(), key, user?.role, businessId)
  return user ? why : { ...why, on: false }
}

/** 사이드바에서 뺄 메뉴 키(꺼진 기능의 메뉴). */
export async function hiddenNavFor(role: Role | null | undefined, businessIds: readonly string[] = []): Promise<string[]> {
  if (!role) return []
  return hiddenNavKeys(await loadFeatureSwitches(), role, businessIds)
}
