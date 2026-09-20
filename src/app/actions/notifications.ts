'use server'

import { getRepository } from '@/lib/repository'

/**
 * 알림 읽음 표시 (Phase 5-E 1-2절, 0030).
 *
 * 만드는 경로는 없다. 0030이 notifications에 insert 권한도 insert 정책도 주지 않았고,
 * 그래서 이 파일에도 create가 없다 — 서버가 알림을 만들게 되는 날 definer 함수 하나가
 * 문이 되고, 그때 이 파일에 그 문을 부르는 함수가 생긴다.
 *
 * user_id를 인자로 받지 않는다. 어느 행을 만질 수 있는지는 0030의 notifications_own_mark가
 * 정하고, 이 함수는 id 목록만 넘긴다 — 남의 알림 id를 넣어도 0행이다.
 */
export async function markNotificationsRead(ids: unknown): Promise<{ error?: string }> {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    return { error: '잘못된 요청입니다.' }
  }
  try {
    const repo = await getRepository()
    await repo.markNotificationsRead(ids as string[])
  } catch (e) {
    console.error('[notifications]', e)
    return { error: '읽음 표시를 저장하지 못했습니다.' }
  }
  return {}
}
