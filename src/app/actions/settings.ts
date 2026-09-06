'use server'

import { getRepository } from '@/lib/repository'

/**
 * CH-003 숨김 / CH-004 핀.
 *
 * 예전에는 localStorage였다. 브라우저를 바꾸면 화면이 초기화되고, 같은 사람이
 * 두 기기에서 서로 다른 대시보드를 보게 된다 — 개인 설정은 서버가 갖는 게 맞다(CH-056).
 *
 * 남의 설정에 손댈 수 있는 경로는 만들지 않았다. user_id를 인자로 받지 않고
 * 세션에서 꺼내며, 그마저도 0002의 user_settings_own 정책이 다시 막는다.
 */

export interface SettingsState {
  error?: string
}

/** 문자열 배열인지만 본다. 존재하지 않는 회사 id가 섞여도 화면이 무시하므로 여기서 막지 않는다. */
function idList(ids: unknown): string[] | null {
  if (!Array.isArray(ids)) return null
  return ids.every((id) => typeof id === 'string') ? (ids as string[]) : null
}

async function save(patch: {
  hidden_businesses?: string[]
  pinned_businesses?: string[]
}): Promise<SettingsState> {
  try {
    const repo = await getRepository()
    await repo.saveUserSettings(patch)
  } catch (e) {
    console.error('[settings]', e)
    return { error: '설정을 저장하지 못했습니다.' }
  }
  // revalidatePath를 부르지 않는다. 대시보드는 동적 렌더라 다음 요청에서 어차피 다시 읽고,
  // 핀 한 번 누를 때마다 화면 전체를 다시 가져오면 왕복이 그만큼 늘어난다.
  return {}
}

export async function saveHiddenBusinesses(ids: unknown): Promise<SettingsState> {
  const list = idList(ids)
  if (!list) return { error: '잘못된 요청입니다.' }
  return save({ hidden_businesses: list })
}

export async function savePinnedBusinesses(ids: unknown): Promise<SettingsState> {
  const list = idList(ids)
  if (!list) return { error: '잘못된 요청입니다.' }
  return save({ pinned_businesses: list })
}
