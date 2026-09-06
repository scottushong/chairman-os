import { dayKey } from '@/lib/format'
import type { DecisionId, DecisionStatus, UserId } from '@/types'

/**
 * CH-016 결정 처리의 어휘.
 *
 * 저장소가 아니다. 예전에는 이 파일이 localStorage였는데, CH-051이 '삭제 불가'를
 * 요구하는 기록을 사용자가 언제든 지울 수 있는 곳에 두는 셈이라 그 자리를 없앴다.
 * 지금 기록은 Supabase audit_log가 갖는다(app/actions/decisions.ts → repository).
 *
 * 여기 남은 것은 세 화면·서버·DB가 같은 말을 쓰게 하는 매핑뿐이다.
 * DB는 두 벌의 어휘를 쓴다 — decisions.status는 'Approved', audit_log.action은 'approve'다.
 * 그 둘을 잇는 표를 한 곳에만 둔다.
 */

/** 시트 DecisionStatus의 Open을 제외한 나머지가 곧 Chairman이 취할 수 있는 행동이다. */
export const DECISION_ACTION = ['Approved', 'Rejected', 'Modified', 'Delegated'] as const
export type DecisionAction = (typeof DECISION_ACTION)[number]

export const DECISION_ACTION_LABEL_KO: Record<DecisionAction, string> = {
  Approved: '승인',
  Rejected: '거절',
  Modified: '수정요청',
  Delegated: '위임',
}

/** audit_log.action enum(0001_init.sql)으로 옮긴다. */
export const AUDIT_ACTION: Record<DecisionAction, 'approve' | 'reject' | 'modify' | 'delegate'> = {
  Approved: 'approve',
  Rejected: 'reject',
  Modified: 'modify',
  Delegated: 'delegate',
}

/** 되돌리는 방향. audit_log 한 줄만 보고도 결정이 어떤 상태가 됐는지 알아야 한다. */
export const DECISION_STATUS: Record<
  'approve' | 'reject' | 'modify' | 'delegate',
  DecisionStatus
> = {
  approve: 'Approved',
  reject: 'Rejected',
  modify: 'Modified',
  delegate: 'Delegated',
}

export function isDecisionAction(value: string): value is DecisionAction {
  return (DECISION_ACTION as readonly string[]).includes(value)
}

/** audit_log에서 읽어 온 결정 처리 한 줄. */
export interface DecisionAuditRecord {
  decision_id: DecisionId
  action: 'approve' | 'reject' | 'modify' | 'delegate'
  /** 기록 시각(ISO). 감사에는 '무엇을'보다 '언제'가 먼저 필요하다. */
  occurred_at: string
  actor_user_id: UserId | null
  /**
   * 처리한 사람의 표시 이름. CH-041 타임라인이 쓴다.
   * uuid를 그대로 뿌리지 않는다 — 프로필을 못 찾으면 '미지정'이다(DEFERRED D-09 결정 B).
   * 남의 프로필은 Chairman이 아니면 0002가 내주지 않으므로, 보는 사람에 따라 값이 다를 수 있다.
   */
  actor_name: string
}

/** 결정별 마지막 처리. 같은 건이 여러 번 기록돼도 화면에는 최신 것 하나만 쓴다. */
export function latestByDecision(
  entries: DecisionAuditRecord[],
): Map<DecisionId, DecisionAuditRecord> {
  const map = new Map<DecisionId, DecisionAuditRecord>()
  // 오름차순으로 훑어야 마지막에 남는 것이 최신이다.
  // 문자열 비교가 아니라 시각으로 비교한다 — PostgREST가 주는 timestamptz는
  // 오프셋 표기가 섞일 수 있어 사전순이 시간순과 같다는 보장이 없다.
  ;[...entries]
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
    .forEach((e) => map.set(e.decision_id, e))
  return map
}

/**
 * 'YYYY-MM-DD' 하루치만 센다. 카운터는 '오늘 몇 건 털었나'를 답하는 자리다.
 *
 * occurred_at은 UTC로 온다. 문자열 앞 10글자를 그대로 자르면
 * 한국 시간 아침 7시에 처리한 건이 '어제'로 세어진다. 로컬 날짜로 바꿔서 비교한다.
 */
export function countOn(entries: DecisionAuditRecord[], day: string): number {
  return entries.filter((e) => dayKey(new Date(e.occurred_at)) === day).length
}
