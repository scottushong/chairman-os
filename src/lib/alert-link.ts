import type { Alert, Decision } from '@/types'

/**
 * CH-018 알림 한 건이 어느 결정으로 이어지는가.
 *
 * 알림만 보고 끝나면 아무 일도 일어나지 않는다. 같은 회사에 열린 결정이 있으면 그리로 보낸다 —
 * 회장이 알림을 보고 할 수 있는 일은 결국 결정 하나를 처리하는 것이다.
 *
 * 상단 배너(CriticalBanner)와 아래 패널(AlertPanel)이 같은 알림에 대해 다른 곳으로
 * 보내면 안 되므로 판단을 여기 한 곳에 둔다.
 *
 * 없으면 null이다. 빈 '#'를 돌려주지 않는 이유는, 눌러도 아무 일 없는 링크가
 * '고장'으로 읽히기 때문이다. 갈 곳이 없으면 부르는 쪽이 링크를 아예 만들지 않는다.
 */
export function linkedDecisionHref(alert: Alert, decisions: Decision[]): string | null {
  const linked = decisions.find(
    (d) => d.business_id === alert.business_id && d.status === 'Open',
  )
  if (!linked) return null
  // CH-041이 ?id=로 특정 결재를 여는 화면이다. 결정 전용 상세 라우트를 따로 만들지 않았다.
  return `/approvals?tab=open&id=${encodeURIComponent(linked.decision_id)}`
}

/** 그 결정의 제목. 배너·패널이 '무엇을 결정하러 가는지' 같은 말로 보여 준다. */
export function linkedDecisionTitle(alert: Alert, decisions: Decision[]): string | null {
  return (
    decisions.find((d) => d.business_id === alert.business_id && d.status === 'Open')?.title ??
    null
  )
}
