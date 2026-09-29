'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 메신저 · AI 묻기 (Phase 9 블록 6, 0041). 판정은 DB(can_read_channel · ai_chats 본인만)가 한다.
 */

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function sendChatMessage(input: {
  channelId: unknown
  body: unknown
  link?: unknown
  documentId?: unknown
}): Promise<{ error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const channel_id = text(input.channelId)
  const body = text(input.body)
  const link = text(input.link) || null
  const document_id = text(input.documentId) || null
  if (!channel_id) return { error: '채널을 알 수 없습니다.' }
  if (!body && !link && !document_id) return { error: '보낼 내용이 없습니다.' }
  if (body.length > 4000) return { error: '4,000자까지 보낼 수 있습니다.' }
  if (link && !/^https?:\/\//.test(link) && !/^\/($|[^/\\])/.test(link)) {
    return { error: '링크는 https:// 주소나 앱 안의 경로(/…)만 됩니다.' }
  }
  try {
    const repo = await getRepository()
    await repo.sendChatMessage({ channel_id, body, link, document_id }, { user_id: user.user_id, role: user.role })
    await repo.markChannelRead(channel_id, { user_id: user.user_id, role: user.role })
    revalidatePath('/chat')
    return {}
  } catch (e) {
    console.error('[sendChatMessage]', e)
    const message = e instanceof Error ? e.message : ''
    if (/42501|row-level security/.test(message)) return { error: '이 채널에 쓸 권한이 없습니다(또는 그 문서를 볼 수 없습니다).' }
    return { error: '보내지 못했습니다.' }
  }
}

/** 채널을 연 순간 한 번. 실패해도 화면을 막지 않는다 — 읽음은 부가 기록이다. */
export async function markChannelRead(channelId: unknown): Promise<void> {
  const user = await currentUser()
  const id = text(channelId)
  if (!user || !id) return
  try {
    const repo = await getRepository()
    await repo.markChannelRead(id, { user_id: user.user_id, role: user.role })
  } catch (e) {
    console.error('[markChannelRead]', e)
  }
}

export async function openDm(otherId: unknown): Promise<{ error?: string; channelId?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const id = text(otherId)
  if (!id) return { error: '상대를 고르세요.' }
  try {
    const repo = await getRepository()
    const channelId = await repo.openDm(id)
    revalidatePath('/chat')
    return { channelId }
  } catch (e) {
    console.error('[openDm]', e)
    return { error: '이 사람과는 1:1을 열 수 없습니다(같은 회사가 아니거나 비활성 계정).' }
  }
}

// «AI에게 묻기»(Phase 9)는 Phase 11부터 어시스턴트 하나로 합쳤다 — /chat의 AI 탭도 떠 있는 패널과 같은
// 엔진(app/actions/assistant.ts askAssistant · lib/ai/assistant/run.ts)을 쓴다. 두 벌이면 한쪽만 권한을 고친다.
