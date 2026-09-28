'use server'

import { revalidatePath } from 'next/cache'

import { answerQuestion } from '@/lib/ai/ask'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import type { AiSource } from '@/types'

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

/**
 * AI에게 묻기. 대화가 없으면 새로 만든다. 질문 → (DB 트리거가 감사에 요약) → 답 → 저장.
 * 답은 이 사람의 세션으로 읽은 데이터로만 만든다(lib/ai/ask.ts).
 */
export async function askAi(input: { chatId?: unknown; question: unknown }): Promise<{
  error?: string
  chatId?: string
  answer?: string
  sources?: AiSource[]
}> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const question = text(input.question)
  if (!question) return { error: '질문을 넣으세요.' }
  if (question.length > 2000) return { error: '질문은 2,000자까지입니다.' }
  const actor = { user_id: user.user_id, role: user.role }
  try {
    const repo = await getRepository()
    const chatId = text(input.chatId) || (await repo.createAiChat(question.slice(0, 60), actor))
    await repo.appendAiMessage(chatId, 'user', question, [], actor)
    const result = await answerQuestion(question, repo, user)
    await repo.appendAiMessage(chatId, 'assistant', result.answer, result.sources, actor)
    revalidatePath('/chat')
    return { chatId, answer: result.answer, sources: result.sources }
  } catch (e) {
    console.error('[askAi]', e)
    return { error: 'AI가 답하지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
}
