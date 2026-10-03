/**
 * 앱 안의 알림 한 줄 (0030 notifications).
 *
 * 헤더의 종이 세는 것이 이것이다. Phase 5-E 전까지 그 자리에는 `12`와 `5`가 하드코딩돼
 * 있었다 — 시안에서 온 숫자라 아무것도 세지 않았고, 눌러도 열리지 않았다.
 *
 * **지금 이 표는 비어 있는 것이 정상이다.** 알림을 만드는 코드가 아직 없고(0030 2절이
 * insert를 아무에게도 주지 않았다), 그래서 화면에 0이 뜬다. 0은 사실이고 12는 거짓말이다.
 */

/** 0030의 check와 같은 넷이어야 한다. 갈라지면 DB가 받아 주지 않는 값을 화면이 그리게 된다. */
export const NOTIFICATION_KIND = ['decision', 'task', 'share', 'system'] as const
export type NotificationKind = (typeof NOTIFICATION_KIND)[number]

export const NOTIFICATION_KIND_LABEL_KO: Record<NotificationKind, string> = {
  decision: '결정 대기',
  task: '업무',
  share: '공유',
  system: '시스템',
}

/** 설정 화면이 각 줄 밑에 다는 한 줄 설명. '무엇이 오는가'를 말한다. */
export const NOTIFICATION_KIND_HINT_KO: Record<NotificationKind, string> = {
  decision: '회장님의 결재·승인을 기다리는 건이 생겼을 때',
  task: '업무가 배정되거나 막혔을 때',
  share: '누군가 문서·업무·프로젝트를 열어 줬을 때',
  system: '마감·동기화 등 시스템이 알려야 하는 것',
}

/**
 * 보는 사람에 맞춘 설명. decision 줄의 호칭만 다르다 — 회장 본인 = 회장님, 그 외 = 대표님
 * (직원 화면 용어 원칙(CLAUDE.md)). `bossName`은 lib/boss.ts boss(role)의 값.
 */
export function notificationKindHint(kind: NotificationKind, bossName: string): string {
  return kind === 'decision' ? `${bossName}님의 결재·승인을 기다리는 건이 생겼을 때` : NOTIFICATION_KIND_HINT_KO[kind]
}

export interface AppNotification {
  notification_id: string
  kind: NotificationKind
  title: string
  body: string | null
  /** 앱 안의 경로만 온다(0030이 표에서 막는다). 없으면 누를 곳이 없는 알림이다. */
  link: string | null
  /** null이면 안 읽음. 헤더 뱃지가 세는 것이 이 칸이다. */
  read_at: string | null
  created_at: string
}

/** 알림 종이 한 번에 읽어 오는 것. 건수를 목록 길이로 세지 않는다 — 목록은 잘려 온다. */
export interface NotificationInbox {
  /** 안 읽은 전체 건수. 드롭다운이 20줄만 보여 줘도 뱃지는 전부를 센다. */
  unread: number
  /** 최근 것부터. 읽음·안 읽음을 섞어 준다 — 드롭다운이 둘을 같이 보여 준다. */
  items: AppNotification[]
}

/**
 * 종류별 켜고 끄기(설정 → 알림). 꺼 둔 종류는 헤더의 목록과 뱃지에서 **빠진다** —
 * 저장만 하고 아무 데서도 안 보는 스위치는 죽은 버튼과 같은 종류의 거짓말이다.
 */
export type NotificationSwitches = Record<NotificationKind, boolean>

/** 아무것도 저장한 적이 없으면 전부 켜짐이다. 알림을 놓치는 쪽이 성가신 쪽보다 나쁘다. */
export const NOTIFICATION_SWITCHES_DEFAULT: NotificationSwitches = {
  decision: true,
  task: true,
  share: true,
  system: true,
}
