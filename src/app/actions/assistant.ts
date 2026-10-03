'use server'

import { revalidatePath } from 'next/cache'

import { executeAiAction } from '@/lib/ai/assistant/execute'
import { CHAIRMAN_SCREEN_LABEL_KO, runAssistant } from '@/lib/ai/assistant/run'
import { safePath, type ScreenKind } from '@/lib/ai/assistant/screen'
import { currentUser } from '@/lib/auth/session'
import { isChairman } from '@/lib/boss'
import { getRepository } from '@/lib/repository'
import type { AiAction, AiActionView, AiChat, AiChatMessage } from '@/types'

/**
 * Phase 11 AI 어시스턴트의 서버 액션 — 묻기 · 불러오기 · **확인 · 취소**.
 *
 * ■ 확인이 실행의 유일한 문이다 ■
 *   confirmAiAction(actionId)만 executeAiAction을 부른다. 화면이 보내는 것은 id 하나고, 실행할 값은
 *   repo.decideAiAction이 DB(0046 ai_action_decide)에서 **주인 · pending · 만료 전**을 확인하며 한 번
 *   소비하고 돌려준 줄의 payload다. 모델의 도구 고리(runAssistant)는 이 파일의 이 함수를 부를 길이 없다.
 * ■ 화면으로 payload를 내리지 않는다 ■ 미리보기(preview)만 간다.
 */

export interface AssistantThread {
  chatId: string | null
  chats: AiChat[]
  messages: AiChatMessage[]
  actions: AiActionView[]
  /** 회장 세션에만: 회장 전용 화면의 «지금 화면» 이름. 직원에게는 싣지 않는다(직원 화면 용어 원칙, CLAUDE.md). */
  screenLabels?: Partial<Record<ScreenKind, string>>
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const view = ({ payload: _p, ...rest }: AiAction): AiActionView => (void _p, rest)

async function thread(chatId: string | null): Promise<AssistantThread> {
  const repo = await getRepository()
  const chats = await repo.listAiChats().catch(() => [])
  if (!chatId || !chats.some((c) => c.chat_id === chatId)) return { chatId: null, chats, messages: [], actions: [] }
  const [messages, actions] = await Promise.all([repo.listAiChatMessages(chatId), repo.listAiActions(chatId).catch(() => [])])
  return { chatId, chats, messages, actions: actions.map(view) }
}

export async function loadAssistant(chatId: unknown): Promise<AssistantThread & { error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.', chatId: null, chats: [], messages: [], actions: [] }
  try {
    const t = await thread(text(chatId) || null)
    return isChairman(user.role) ? { ...t, screenLabels: CHAIRMAN_SCREEN_LABEL_KO } : t
  } catch (e) {
    console.error('[loadAssistant]', e)
    return { error: '대화를 불러오지 못했습니다.', chatId: null, chats: [], messages: [], actions: [] }
  }
}

export async function askAssistant(input: { chatId?: unknown; question: unknown; path?: unknown }): Promise<AssistantThread & { error?: string }> {
  const empty = { chatId: null, chats: [], messages: [], actions: [] }
  const user = await currentUser()
  if (!user) return { ...empty, error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const question = text(input.question)
  if (!question) return { ...empty, error: '질문을 넣으세요.' }
  if (question.length > 2000) return { ...empty, error: '질문은 2,000자까지입니다.' }
  const path = safePath(input.path)
  const actor = { user_id: user.user_id, role: user.role }
  try {
    const repo = await getRepository()
    const chatId = text(input.chatId) || (await repo.createAiChat(question.slice(0, 60), actor, path))
    const history = await repo.listAiChatMessages(chatId)
    await repo.appendAiMessage(chatId, 'user', question, [], actor)
    const result = await runAssistant({ question, repo, user, path, chatId, history })
    await repo.appendAiMessage(chatId, 'assistant', result.answer, result.sources, actor, { tokens: result.tokens, action_ids: result.actionIds })
    revalidatePath('/chat')
    return await thread(chatId)
  } catch (e) {
    console.error('[askAssistant]', e)
    return { ...empty, error: 'AI가 답하지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
}

export interface DecideResult {
  error?: string
  message?: string
  href?: string
}

/** 확인 버튼. DB가 확인을 한 번 소비한 줄만 실행한다. 실패해도 확인 감사는 남고 결과는 failed로 적힌다. */
export async function confirmAiAction(actionId: unknown): Promise<DecideResult> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const id = text(actionId)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: '제안을 알 수 없습니다.' }
  const repo = await getRepository()
  let action: AiAction | null
  try {
    action = await repo.decideAiAction(id, true)
  } catch (e) {
    console.error('[confirmAiAction]', e)
    return { error: '확인하지 못했습니다.' }
  }
  if (!action) return { error: '이미 처리했거나 만료된 제안입니다(15분). 다시 물어 새 제안을 받으세요.' }

  let result: { ok: boolean; message: string; href?: string }
  try {
    result = await executeAiAction(action)
  } catch (e) {
    console.error('[confirmAiAction] 실행 실패', e)
    result = { ok: false, message: '실행하지 못했습니다.' }
  }
  await repo.finishAiAction(id, result.ok, result.message).catch((e) => console.error('[confirmAiAction] 결과 기록 실패', e))
  revalidatePath('/chat')
  return result.ok ? { message: result.message, href: result.href } : { error: result.message }
}

export async function cancelAiAction(actionId: unknown): Promise<DecideResult> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const id = text(actionId)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: '제안을 알 수 없습니다.' }
  try {
    const done = await (await getRepository()).decideAiAction(id, false)
    return done ? { message: '취소했습니다.' } : { error: '이미 처리했거나 만료된 제안입니다.' }
  } catch (e) {
    console.error('[cancelAiAction]', e)
    return { error: '취소하지 못했습니다.' }
  }
}
