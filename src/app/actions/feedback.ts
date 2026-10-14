'use server'

import { revalidatePath } from 'next/cache'

import { safePath } from '@/lib/ai/assistant/screen'
import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { feedbackSensitivity } from '@/lib/feedback/sensitive'
import { triageBundle, triageOne, TriageRefused } from '@/lib/feedback/triage'
import { getRepository } from '@/lib/repository'
import { FEEDBACK_STATUS, type FeedbackStatus } from '@/types'

/**
 * 0069 «시스템 보완 의견»(모든 사람 — 답 아래 접힌 칸) · «시스템 보완함»(대표만)의 서버 액션.
 *
 * ■ 판정은 DB다 ■ 본인 답인가 · 하루 상한 · 대표만 · 제외 줄 거부는 0069 RPC가 한다. 여기서는 문장만 고른다.
 * ■ 민감 차단 첫 겹 ■ 의견 · 질문 · 답을 feedbackSensitivity(배합비 감지 + 낱말)로 재서 «AI 정리 제외»를 같이 넘긴다.
 *   쓴 사람에게는 그 결과를 말하지 않는다(대표에게만 보인다) — 저장은 똑같이 «보냈습니다».
 * ■ 지시문은 실행하지 않는다 ■ AI 정리는 글을 만들어 저장할 뿐이다. 이 파일 어디에도 지시문을 돌리는 길이 없다.
 */

const text = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const UUID = /^[0-9a-f-]{36}$/i

const ERR: Record<string, string> = {
  ai_feedback_body: '의견은 2자 이상 2,000자까지입니다.',
  ai_feedback_duplicate: '이 답에는 이미 의견을 남기셨습니다.',
  ai_feedback_rate: '하루에 30건까지 남길 수 있습니다.',
  ai_feedback_message: '이 답을 찾지 못했습니다 — 대화를 새로 고친 뒤 다시 시도하세요.',
  ai_feedback_denied: '권한이 없습니다.',
  ai_feedback_unavailable: '보완 의견 칸이 아직 준비 중입니다(0069 반영 전).',
  ai_feedback_excluded: 'AI 정리 제외 · 취소 · 이미 묶인 의견은 AI로 보내지 않습니다.',
  ai_feedback_triage_sensitive: '정리 결과에 민감 낱말이 섞여 저장하지 않았습니다.',
  ai_feedback_bundle_screen: '같은 화면의 의견만 묶습니다.',
  ai_feedback_bundle_size: '둘 이상 30개까지 묶습니다.',
}

function message(e: unknown, fallback: string): string {
  if (e instanceof TriageRefused) return e.message
  const m = e instanceof Error ? e.message : ''
  const key = Object.keys(ERR).find((k) => m.includes(k))
  return key ? ERR[key] : fallback
}

/** 화면 경로의 회사(/business/biz_dy · /finance/biz_dy · /purchasing/biz_dy …). 범위 판정은 DB가 한 번 더 한다. */
function businessOf(path: string): string | null {
  const m = /^\/(?:business|finance|purchasing|production|sales|costing|cost-import)\/(biz_[a-z0-9_]+)/.exec(path)
  return m ? m[1] : null
}

/** 0073 기능 스위치로 꺼진 기능의 문장. */
const OFF = '지금은 쓸 수 없는 기능입니다.'

export interface FeedbackResult {
  ok?: true
  error?: string
}

export async function submitFeedback(input: { chatId: unknown; messageId: unknown; body: unknown; path: unknown }): Promise<FeedbackResult> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  // 0073 기능 스위치 «AI 어시스턴트 보강» — 꺼져 있으면 보완 의견을 받지 않는다(어시스턴트 자체는 그대로).
  if (!(await featureOn(user, 'ai_assist'))) return { error: OFF }
  const chatId = text(input.chatId, 64)
  const messageId = Number(input.messageId)
  const body = text(input.body)
  if (!chatId || !Number.isSafeInteger(messageId) || messageId <= 0) return { error: ERR.ai_feedback_message }
  if (body.length < 2) return { error: ERR.ai_feedback_body }
  const path = safePath(input.path)
  try {
    const repo = await getRepository()
    // 질문 · 답은 DB가 복사한다. 여기서 읽는 것은 감지(첫 겹)용 — 본인 대화만 읽힌다(0041).
    const messages = await repo.listAiChatMessages(chatId)
    const at = messages.findIndex((m) => m.id === messageId && m.role === 'assistant')
    if (at < 0) return { error: ERR.ai_feedback_message }
    const question = [...messages.slice(0, at)].reverse().find((m) => m.role === 'user')?.content ?? ''
    const s = feedbackSensitivity({ body, question, answer: messages[at].content })
    await repo.submitAiFeedback({
      message_id: messageId,
      body,
      path,
      business_id: businessOf(path),
      ai_excluded: s.excluded,
      excluded_reasons: s.reasons,
    })
    revalidatePath('/settings/feedback')
    return { ok: true }
  } catch (e) {
    console.error('[submitFeedback]', e)
    return { error: message(e, '의견을 남기지 못했습니다. 잠시 후 다시 시도하세요.') }
  }
}

export async function cancelFeedback(feedbackId: unknown): Promise<FeedbackResult> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (!(await featureOn(user, 'ai_assist'))) return { error: OFF }
  const id = text(feedbackId, 64)
  if (!UUID.test(id)) return { error: '의견을 알 수 없습니다.' }
  try {
    const ok = await (await getRepository()).cancelAiFeedback(id)
    return ok ? { ok: true } : { error: '이미 취소했거나 내 의견이 아닙니다.' }
  } catch (e) {
    console.error('[cancelFeedback]', e)
    return { error: message(e, '취소하지 못했습니다.') }
  }
}

/** 내가 이 대화에서 의견을 남긴 답들(message_id) — 접힌 칸이 «남김»으로 그려진다. */
export async function myFeedbackMessageIds(): Promise<number[]> {
  const user = await currentUser()
  if (!user) return []
  try {
    return (await (await getRepository()).listMyAiFeedback()).map((f) => f.message_id)
  } catch {
    return []
  }
}

/* ───────── 대표 «시스템 보완함» ───────── */

async function chairman() {
  const user = await currentUser()
  // 0073 — 기능 스위치 «AI 어시스턴트 보강»이 꺼져 있으면 보완함 동작도 거부.
  return user && user.role === 'Chairman' && (await featureOn(user, 'ai_assist')) ? user : null
}

export async function setFeedbackStatus(feedbackId: unknown, status: unknown): Promise<FeedbackResult> {
  if (!(await chairman())) return { error: ERR.ai_feedback_denied }
  const id = text(feedbackId, 64)
  const st = text(status, 20) as FeedbackStatus
  if (!UUID.test(id) || !FEEDBACK_STATUS.includes(st)) return { error: '값을 알 수 없습니다.' }
  try {
    await (await getRepository()).setAiFeedbackStatus(id, st)
    revalidatePath('/settings/feedback')
    return { ok: true }
  } catch (e) {
    console.error('[setFeedbackStatus]', e)
    return { error: message(e, '상태를 바꾸지 못했습니다.') }
  }
}

export async function setBundleStatus(bundleId: unknown, status: unknown): Promise<FeedbackResult> {
  if (!(await chairman())) return { error: ERR.ai_feedback_denied }
  const id = text(bundleId, 64)
  const st = text(status, 20) as Exclude<FeedbackStatus, 'triaged'>
  if (!UUID.test(id) || !['new', 'copied', 'applied', 'held'].includes(st)) return { error: '값을 알 수 없습니다.' }
  try {
    await (await getRepository()).setAiFeedbackBundleStatus(id, st)
    revalidatePath('/settings/feedback')
    return { ok: true }
  } catch (e) {
    console.error('[setBundleStatus]', e)
    return { error: message(e, '상태를 바꾸지 못했습니다.') }
  }
}

export async function triageFeedback(feedbackId: unknown): Promise<FeedbackResult> {
  if (!(await chairman())) return { error: ERR.ai_feedback_denied }
  const id = text(feedbackId, 64)
  if (!UUID.test(id)) return { error: '의견을 알 수 없습니다.' }
  try {
    const repo = await getRepository()
    const row = (await repo.listAiFeedback()).find((f) => f.feedback_id === id)
    if (!row) return { error: '의견을 찾지 못했습니다.' }
    await triageOne(repo, row)
    revalidatePath('/settings/feedback')
    return { ok: true }
  } catch (e) {
    console.error('[triageFeedback]', e)
    return { error: message(e, 'AI 정리에 실패했습니다. 잠시 후 다시 시도하세요.') }
  }
}

export async function bundleFeedback(ids: unknown): Promise<FeedbackResult> {
  if (!(await chairman())) return { error: ERR.ai_feedback_denied }
  const list = Array.isArray(ids) ? ids.map((x) => text(x, 64)).filter((x) => UUID.test(x)).slice(0, 30) : []
  if (list.length < 2) return { error: ERR.ai_feedback_bundle_size }
  try {
    const repo = await getRepository()
    const rows = (await repo.listAiFeedback()).filter((f) => list.includes(f.feedback_id))
    await triageBundle(repo, rows)
    revalidatePath('/settings/feedback')
    return { ok: true }
  } catch (e) {
    console.error('[bundleFeedback]', e)
    return { error: message(e, '묶음 정리에 실패했습니다.') }
  }
}
