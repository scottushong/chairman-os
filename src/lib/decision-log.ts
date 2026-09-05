import type { DecisionId, UserId } from '@/types'

/**
 * CH-016 결정 이력(audit log).
 * 요구사항서 CH-051이 '조회/수정/승인/권한변경 기록 · 삭제 불가'라, 이 저장소는 append만 한다.
 * 지우는 함수를 만들지 않는 것 자체가 정책이다.
 *
 * 시드(src/data/decisions.json)는 읽기 전용이므로 처리 결과를 원본에 되쓰지 않고
 * 여기 쌓인 로그를 시드 위에 겹쳐서 '남은 결정'을 만든다.
 * Phase 1에서 Approval DB가 붙으면 이 파일만 갈아 끼운다.
 */

const KEY = 'chairman-os:decision-log'
const EMPTY = '[]'

/** 시트 DecisionStatus의 Open을 제외한 나머지가 곧 Chairman이 취할 수 있는 행동이다. */
export const DECISION_ACTION = ['Approved', 'Rejected', 'Modified', 'Delegated'] as const
export type DecisionAction = (typeof DECISION_ACTION)[number]

export const DECISION_ACTION_LABEL_KO: Record<DecisionAction, string> = {
  Approved: '승인',
  Rejected: '거절',
  Modified: '수정요청',
  Delegated: '위임',
}

export interface DecisionLogEntry {
  decision_id: DecisionId
  action: DecisionAction
  /** 기록 시각(ISO). 감사에는 '무엇을'보다 '언제'가 먼저 필요하다. */
  at: string
  actor: UserId
}

/** getSnapshot은 값이 그대로면 같은 참조를 돌려줘야 한다. 아니면 렌더가 무한히 돈다. */
let cache = EMPTY
const listeners = new Set<() => void>()

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? EMPTY
  } catch {
    return EMPTY
  }
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function getSnapshot(): string {
  const raw = read()
  if (raw !== cache) cache = raw
  return cache
}

/** 서버는 개인 로그를 알 수 없다. 항상 '아직 아무것도 처리하지 않음'으로 시작한다. */
export function getServerSnapshot(): string {
  return EMPTY
}

export function parseLog(raw: string): DecisionLogEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DecisionLogEntry[]) : []
  } catch {
    return []
  }
}

/** append only. 기존 항목을 고치거나 지우지 않는다. */
export function appendLog(entry: DecisionLogEntry): void {
  const next = [...parseLog(getSnapshot()), entry]
  cache = JSON.stringify(next)
  try {
    localStorage.setItem(KEY, cache)
  } catch {
    // 저장소를 못 써도 이번 세션 동안은 동작해야 한다.
  }
  listeners.forEach((l) => l())
}

/** 결정별 마지막 처리. 같은 건이 여러 번 기록돼도 화면에는 최신 것 하나만 쓴다. */
export function latestByDecision(entries: DecisionLogEntry[]): Map<DecisionId, DecisionLogEntry> {
  const map = new Map<DecisionId, DecisionLogEntry>()
  entries.forEach((e) => map.set(e.decision_id, e))
  return map
}

/** 'YYYY-MM-DD' 하루치만 센다. 카운터는 '오늘 몇 건 털었나'를 답하는 자리다. */
export function countOn(entries: DecisionLogEntry[], day: string): number {
  return entries.filter((e) => e.at.slice(0, 10) === day).length
}
