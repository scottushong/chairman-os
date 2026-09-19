import { type CalendarItem, type CalendarItemKind, type IsoDate } from '@/types'

/**
 * 달력 격자의 표시 규칙 (Phase 4-A 다듬기 2번으로 컴포넌트는 지우고 규칙만 남았다).
 *
 * 칸을 실제로 그리는 것은 month-grid-client.tsx(서버 페이지가 그 클라이언트 컴포넌트 하나만
 * 렌더링한다)지만, "무엇을 어떤 모양·색으로 그리는가"는 여기 두 상수·함수가 정한다.
 * 격자를 다시 그릴 화면이 생기면 이 둘을 가져다 쓰면 된다 — 규칙을 복사하면 두 화면이
 * 같은 날을 다르게 칠하게 된다.
 */

/** 종류는 색이 아니라 모양으로 가른다 — 넷을 다 칠하면 무엇이 급한지 안 보인다. */
export const KIND_MARK: Record<CalendarItemKind, string> = {
  event: '●',
  next_action: '○',
  milestone: '◆',
  decision: '!',
}

/** 색이 오르는 유일한 경우: 지난(오늘보다 이전) next_action·decision. 지나간 이벤트는 위험이 아니다. */
export function isPastRisk(item: CalendarItem, today: IsoDate): boolean {
  return (item.kind === 'next_action' || item.kind === 'decision') && item.on_date < today
}
