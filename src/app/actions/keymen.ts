'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import type { BusinessKeyman } from '@/types'

/**
 * CH-024 키맨 저장·삭제 (0015 business_keymen).
 *
 * 권한 판정은 여기서 하지 않는다. 로그인한 본인 세션으로 DB에 붙고
 * 0015의 business_keymen_write가 can_approve()와 회사 범위를 본다. 감사 기록은 어댑터가 남긴다.
 * 입력 검증만 한다 — 폼은 사람이 손으로 고칠 수 있는 입력이다.
 */

export interface KeymanState {
  error?: string
  keyman?: BusinessKeyman
}

const NAME_MAX = 60
const TEXT_MAX = 300

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function failure(e: unknown, fallback: string): string {
  return e instanceof Error && /business_keymen|42501|PGRST301/.test(e.message)
    ? '키맨을 고칠 권한이 없습니다. (Chairman / Business CEO만 가능합니다)'
    : fallback
}

export async function saveKeyman(input: {
  keymanId?: unknown
  businessId: unknown
  name: unknown
  relation: unknown
  lastContactOn: unknown
  note: unknown
}): Promise<KeymanState> {
  const business_id = text(input.businessId)
  const name = text(input.name)
  const relation = text(input.relation)
  const note = text(input.note)
  const last = text(input.lastContactOn)
  const keymanId = text(input.keymanId)

  if (!business_id) return { error: '어느 회사의 키맨인지 알 수 없습니다.' }
  if (!name) return { error: '이름을 입력하세요.' }
  if (name.length > NAME_MAX) return { error: `이름은 ${NAME_MAX}자까지입니다.` }
  if (relation.length > TEXT_MAX || note.length > TEXT_MAX) {
    return { error: `관계·메모는 ${TEXT_MAX}자까지입니다.` }
  }
  // 비우면 '기록 없음'. 날짜가 있으면 실재하는 날이어야 하고 미래일 수 없다 — 아직 안 만난 접촉은 기록이 아니다.
  if (last && (!/^\d{4}-\d{2}-\d{2}$/.test(last) || Number.isNaN(Date.parse(`${last}T00:00:00Z`)))) {
    return { error: '최근 접촉일 형식이 맞지 않습니다.' }
  }
  if (last && last > new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)) {
    return { error: '최근 접촉일이 오늘보다 뒤일 수 없습니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const keyman = await repo.saveKeyman(
      {
        keyman_id: keymanId || undefined,
        business_id,
        name,
        relation,
        last_contact_on: last || null,
        note,
      },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath(`/business/${business_id}`)
    return { keyman }
  } catch (e) {
    console.error('[saveKeyman]', e)
    return { error: failure(e, '저장하지 못했습니다. 잠시 후 다시 시도하세요.') }
  }
}

export async function removeKeyman(keymanId: unknown, businessId: unknown): Promise<KeymanState> {
  const id = text(keymanId)
  if (!id) return { error: '지울 키맨을 알 수 없습니다.' }
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    await repo.removeKeyman(id, { user_id: user.user_id, role: user.role })
    revalidatePath(`/business/${text(businessId)}`)
    return {}
  } catch (e) {
    console.error('[removeKeyman]', e)
    return { error: failure(e, '지우지 못했습니다. 잠시 후 다시 시도하세요.') }
  }
}
