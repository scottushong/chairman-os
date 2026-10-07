import type { AiAction, AiChatMessage, AiSource } from '@/types'

/**
 * 앞선 대화를 모델에게 다시 싣는 법 (Phase 11). **새 칸 · 새 표 없이**(DB 변경 없이) 두 가지를 한다.
 *
 * ① 모양을 고른다 — Messages API는 user로 시작하고 user · assistant가 번갈아야 한다. 답을 못 만든 질문(예전에
 *    질문만 먼저 저장하던 때 남은 것)이 끼면 같은 역할이 두 번 온다 → 이어 붙인다. 앞이 assistant면 버린다.
 * ② 맥락 메모 — 저장된 답은 글만 있어서 «그 결재 올려줘» · «첨부해줘»의 «그것»이 무엇인지 다음 턴이 모른다.
 *    이미 저장돼 있는 근거 카드(sources: 도구가 실제로 읽은 줄)와 제안 id(action_ids → ai_actions 줄)로 짧은 메모를
 *    만들어 **모델에게 보내는 사본에만** 붙인다. 화면 · 저장된 글은 그대로다(규칙 10 — 답에 링크를 늘어놓지 않는다).
 */

export interface PlainTurn {
  role: 'user' | 'assistant'
  content: string
}

export function sanitizeHistory(turns: readonly PlainTurn[]): PlainTurn[] {
  const out: PlainTurn[] = []
  for (const t of turns) {
    const content = (t.content ?? '').trim()
    if (!content) continue
    if (!out.length && t.role !== 'user') continue
    const last = out.at(-1)
    if (last && last.role === t.role) last.content = `${last.content}\n\n${content}`
    else out.push({ role: t.role, content })
  }
  return out
}

/** 근거 카드의 경로 → 무엇의 몇 번인가. 모르는 모양이면 null. */
export function refOf(href: string): { kind: string; id: string } | null {
  let url: URL
  try {
    url = new URL(href, 'http://x')
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  const id = url.searchParams.get('id')
  if (parts[0] === 'approvals' && id) return { kind: '결재', id }
  if (parts[0] === 'documents' && parts[1]) return { kind: '문서', id: parts[1] }
  if (parts[0] === 'initiatives' && parts[1]) return { kind: '이니셔티브', id: parts[1] }
  if (parts[0] === 'business' && parts[1]) return { kind: '회사', id: parts[1] }
  if (parts[0] === 'finance' && parts[1]) return { kind: '회사 재무', id: parts[1] }
  if (parts[0] === 'tasks' && parts[1]) return { kind: '업무', id: parts[1] }
  return null
}

export function isLive(a: Pick<AiAction, 'status' | 'expires_at'>, now = Date.now()): boolean {
  return a.status === 'pending' && Date.parse(a.expires_at) > now
}

const STATUS_KO: Record<AiAction['status'], string> = {
  pending: '확인 대기',
  confirmed: '확인됨',
  cancelled: '취소됨',
  done: '저장됨',
  failed: '실패',
}

export function actionStatusKo(a: Pick<AiAction, 'status' | 'expires_at' | 'result'>, now = Date.now()): string {
  if (a.status === 'pending' && !isLive(a, now)) return '만료됨(15분)'
  return `${STATUS_KO[a.status]}${a.result ? ` — ${a.result.slice(0, 80)}` : ''}`
}

const NOTE_MAX = 700

/** 저장된 답 하나의 맥락 메모(모델에게만). 붙일 것이 없으면 빈 글. */
export function contextNote(m: Pick<AiChatMessage, 'sources' | 'action_ids'>, actions: ReadonlyMap<string, AiAction>, now = Date.now()): string {
  const refs = (m.sources ?? []).slice(0, 8).map((s: AiSource) => {
    const r = refOf(s.href)
    return `${r ? `${r.kind} ${r.id}` : s.href} «${s.label}»${s.detail ? ` (${s.detail})` : ''}`
  })
  const cards = (m.action_ids ?? [])
    .map((id) => actions.get(id))
    .filter((a): a is AiAction => !!a)
    .map((a) => `제안 카드 «${a.preview.title}» — ${actionStatusKo(a, now)}`)
  if (!refs.length && !cards.length) return ''
  const body = [...cards, ...refs].join('; ')
  return `\n\n[맥락 메모 — 사용자에게 보이지 않는다. 답에 옮기지 말 것: ${body.length > NOTE_MAX ? `${body.slice(0, NOTE_MAX)}…` : body}]`
}

/** 이 대화의 살아 있는 제안 카드(확인 대기 · 15분 안). 새 것부터. */
export function liveActions(actions: readonly AiAction[], now = Date.now()): AiAction[] {
  return actions.filter((a) => isLive(a, now)).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** 가장 최근 제안이 확인되지 않은 채 만료됐으면 그 줄(새 카드를 권할 때). 한 시간이 넘은 옛 카드는 보지 않는다. */
export function lastExpired(actions: readonly AiAction[], now = Date.now()): AiAction | null {
  const latest = [...actions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (!latest || latest.status !== 'pending' || isLive(latest, now)) return null
  return now - Date.parse(latest.created_at) <= 60 * 60_000 ? latest : null
}

/** 모델에게 보낼 앞선 대화: 최근 n개 + 맥락 메모 → 모양 고르기. */
export function historyForModel(history: readonly AiChatMessage[], actions: readonly AiAction[], n = 12, now = Date.now()): PlainTurn[] {
  const byId = new Map(actions.map((a) => [a.action_id, a]))
  return sanitizeHistory(
    history.slice(-n).map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? `${m.content}${contextNote(m, byId, now)}` : m.content,
    })),
  )
}
