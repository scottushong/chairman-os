'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { DUPLICATE_SHARE, getRepository } from '@/lib/repository'
import { type ShareEntityTable, type SharePerson, type ShareRecord } from '@/types'

/**
 * Phase 6-1 블록 C — 공유.
 *
 * **가시성을 여기서 다시 검사하지 않는다.** 0026의 shares_insert_visible이 "볼 수 있는
 * 것만 공유할 수 있다"를 판정하고(대상 표를 exists로 읽는 것이 곧 판정이다),
 * 0025의 restrictive 둘이 '남의 이름으로'와 Integration 계정을 막는다.
 * 이 파일이 하는 일은 입력을 좁히고, 거부를 한국어로 옮기고, 감사 기록이 남게 하는 것이다.
 *
 * 감사 어휘는 기존 enum을 쓴다 — 공유는 delegate, 회수는 permission_change.
 * **새 audit_action 값을 만들지 않는다**(0022가 production에서 55P04를 겪었다).
 *
 * 기간 연장 경로가 없다. 0025가 shares에 update 정책을 두지 않았기 때문이고, 그 판단의
 * 이유는 '한 행을 늘렸다 줄였다 하면 언제까지였는지가 기록에 남지 않는다'였다.
 * 기간을 바꾸려면 회수하고 다시 공유한다 — 화면도 그렇게 말한다.
 */

export interface ShareState {
  error?: string
  share?: ShareRecord
}

export interface SharePeopleState {
  error?: string
  people?: SharePerson[]
}

const ENTITY: readonly ShareEntityTable[] = ['documents', 'tasks', 'projects']

/** 화면이 고르는 기간 넷. '직접 지정'은 날짜를 그대로 받는다. */
const DAY = 86_400_000

function expiresAt(preset: unknown, until: unknown): { value: string | null } | { error: string } {
  if (preset === 'forever') return { value: null }
  if (preset === '7') return { value: new Date(Date.now() + 7 * DAY).toISOString() }
  if (preset === '30') return { value: new Date(Date.now() + 30 * DAY).toISOString() }
  if (preset === 'custom') {
    if (typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return { error: '종료일을 고르세요.' }
    }
    // 고른 날의 끝까지 열어 둔다. 날짜만 받아 자정으로 잡으면 '오늘까지'가 이미 지난
    // 시각이 되어, 사람이 고른 그날 하루가 통째로 사라진다.
    const ms = Date.parse(`${until}T23:59:59+09:00`)
    if (!Number.isFinite(ms)) return { error: '종료일을 확인하세요.' }
    if (ms <= Date.now()) return { error: '종료일이 이미 지났습니다. 오늘 이후로 고르세요.' }
    return { value: new Date(ms).toISOString() }
  }
  return { error: '공유 기간을 고르세요.' }
}

/**
 * DB가 거부했을 때 한국어 한 줄.
 * 화면이 판정을 흉내 내지 않는 대신, 거부를 사람 말로 옮기는 것까지가 화면의 몫이다.
 */
function denialMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : ''
  if (/42501|row-level security|PGRST301|shares_insert|shares_revoke/.test(message)) return fallback
  return '저장하지 못했습니다. 잠시 후 다시 시도하세요.'
}

/** 공유·회수 뒤에 다시 그려야 하는 화면들. 목록과 상세가 같은 사실을 보여 줘야 한다. */
function revalidateShareViews(table: ShareEntityTable, id: string) {
  revalidatePath('/shared')
  if (table === 'documents') {
    revalidatePath('/documents')
    revalidatePath(`/documents/${id}`)
  } else if (table === 'tasks') {
    revalidatePath('/tasks')
    revalidatePath(`/tasks/${id}`)
  } else {
    revalidatePath(`/projects/${id}`)
  }
}

export async function createShare(input: {
  entityTable: unknown
  entityId: unknown
  sharedWith: unknown
  preset: unknown
  until?: unknown
}): Promise<ShareState> {
  const entityTable = ENTITY.find((t) => t === input.entityTable)
  const entityId = typeof input.entityId === 'string' ? input.entityId.trim() : ''
  const sharedWith = typeof input.sharedWith === 'string' ? input.sharedWith.trim() : ''

  if (!entityTable) return { error: '알 수 없는 공유 대상입니다.' }
  if (!entityId) return { error: '공유할 항목을 알 수 없습니다.' }
  if (!sharedWith) return { error: '받는 사람을 고르세요.' }

  const period = expiresAt(input.preset, input.until)
  if ('error' in period) return { error: period.error }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (sharedWith === user.user_id) return { error: '자기 자신에게는 공유하지 않습니다.' }

  let share: ShareRecord
  try {
    const repo = await getRepository()
    share = await repo.createShare(
      {
        entity_table: entityTable,
        entity_id: entityId,
        shared_with: sharedWith,
        expires_at: period.value,
      },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[createShare]', e)
    if (e instanceof Error && (e.message === DUPLICATE_SHARE || /23505/.test(e.message))) {
      return {
        error:
          '이미 이 사람에게 열려 있습니다. 기간을 바꾸려면 회수하고 다시 공유하세요(기간 연장은 따로 없습니다).',
      }
    }
    return {
      error: denialMessage(
        e,
        '공유하지 못했습니다. 공유는 자기가 볼 수 있는 항목만, 같은 회사 사람에게만 됩니다.',
      ),
    }
  }

  revalidateShareViews(entityTable, entityId)
  return { share }
}

export async function revokeShare(input: {
  shareId: unknown
  entityTable: unknown
  entityId: unknown
}): Promise<ShareState> {
  const shareId = typeof input.shareId === 'string' ? input.shareId.trim() : ''
  const entityTable = ENTITY.find((t) => t === input.entityTable)
  const entityId = typeof input.entityId === 'string' ? input.entityId.trim() : ''
  if (!shareId) return { error: '회수할 공유를 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.revokeShare(shareId, { user_id: user.user_id, role: user.role })
  } catch (e) {
    console.error('[revokeShare]', e)
    return {
      error: denialMessage(e, '회수할 수 없습니다. 공유를 연 사람만 회수할 수 있습니다.'),
    }
  }

  if (entityTable && entityId) revalidateShareViews(entityTable, entityId)
  else revalidatePath('/shared')
  return {}
}

/**
 * 받는 사람 검색(0028 company_people).
 *
 * 사람 목록을 직접 읽지 않는다 — 0026이 그 표를 subtree로 잘라서, 옆 가지에 있는 사람
 * (구매팀장에게 영업팀장)을 화면에서 고를 수가 없다. 이 RPC는 같은 회사 사람의
 * 이름 두 칸과 id만 내준다. 질의가 비면 0행이다 — 사람 목록을 훑는 창구가 아니다.
 */
export async function searchSharePeople(input: { query: unknown }): Promise<SharePeopleState> {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (query.length < 1) return { people: [] }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    return { people: await repo.searchSharePeople(query) }
  } catch (e) {
    console.error('[searchSharePeople]', e)
    return { error: '사람을 찾지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
}
