'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 공지 등록 · 삭제 · 읽음 (Phase 9 블록 1, 0038).
 *
 * 판정은 DB다(쓰기 Executive 이상 · 그룹 공지는 그룹 범위 · 고치고 지우는 것은 작성자 또는 회장).
 * 여기서는 빈 칸만 먼저 보고, 거부는 사람 말로 바꾼다.
 */

export interface NoticeState {
  error?: string
  id?: number
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const DATE = /^\d{4}-\d{2}-\d{2}$/

function explain(e: unknown, fallback: string): NoticeState {
  const message = e instanceof Error ? e.message : ''
  if (/42501|PGRST301|row-level security/.test(message)) {
    return { error: '이 공지를 쓸 권한이 없습니다. 공지는 임원(Executive) 이상이 자기 회사에, 그룹 전체 공지는 회장 · 그룹 CFO가 씁니다.' }
  }
  return { error: fallback }
}

export async function saveNotice(input: {
  id?: unknown
  businessId: unknown
  title: unknown
  body: unknown
  titleEn?: unknown
  bodyEn?: unknown
  pinned?: unknown
  expiresOn?: unknown
}): Promise<NoticeState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  const title = text(input.title)
  if (!title) return { error: '제목을 넣으세요.' }
  const businessId = text(input.businessId)
  const expires = text(input.expiresOn)
  if (expires && !DATE.test(expires)) return { error: '내리는 날짜를 읽지 못했습니다.' }
  const rawId = Number(input.id)

  try {
    const repo = await getRepository()
    const id = await repo.saveNotice(
      {
        id: Number.isInteger(rawId) && rawId > 0 ? rawId : undefined,
        // '' = 그룹 전체 공지
        business_id: businessId || null,
        title,
        body: text(input.body),
        title_en: text(input.titleEn) || null,
        body_en: text(input.bodyEn) || null,
        pinned: input.pinned === true,
        expires_on: expires || null,
      },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath('/groupware')
    revalidatePath('/')
    return { id }
  } catch (e) {
    console.error('[saveNotice]', e)
    return explain(e, '공지를 저장하지 못했습니다.')
  }
}

export async function deleteNotice(id: unknown): Promise<NoticeState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const noticeId = Number(id)
  if (!Number.isInteger(noticeId)) return { error: '지울 공지를 알 수 없습니다.' }
  try {
    const repo = await getRepository()
    await repo.deleteNotice(noticeId, { user_id: user.user_id, role: user.role })
    revalidatePath('/groupware')
    revalidatePath('/')
    return {}
  } catch (e) {
    console.error('[deleteNotice]', e)
    return explain(e, '공지를 지우지 못했습니다.')
  }
}

/** 펼쳐 본 순간 한 번. 실패해도 화면을 막지 않는다 — 읽음 표시는 부가 기록이다. */
export async function markNoticeRead(id: unknown): Promise<NoticeState> {
  const user = await currentUser()
  const noticeId = Number(id)
  if (!user || !Number.isInteger(noticeId)) return {}
  try {
    const repo = await getRepository()
    await repo.markNoticeRead(noticeId, { user_id: user.user_id, role: user.role })
    revalidatePath('/groupware')
    return {}
  } catch (e) {
    console.error('[markNoticeRead]', e)
    return {}
  }
}
