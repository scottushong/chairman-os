/**
 * 화상회의(Jitsi Meet) — Phase 9 블록 5.
 *
 * meet.jit.si는 계정이 없어서 **방 이름이 곧 입장권이다.** 그래서 이름의 끝을 16자리 난수로 둔다
 * (0040 event_video_link()와 같은 모양: chairman-os-{회사}-{날짜}-{난수}). 이 파일은 dummy와
 * 즉석 회의실이 같은 모양을 쓰게 하고, 주소창의 ?room=이 그 모양인지 거른다.
 */
export const JITSI_ORIGIN = 'https://meet.jit.si'

/** 0040 check 제약과 같다. 이 모양이 아니면 iframe을 띄우지 않는다. */
export const ROOM_PATTERN = /^chairman-os-[a-z0-9-]+$/

export function roomSlug(businessId: string | null): string {
  // 소문자가 먼저다 — 0040 event_video_link()와 같은 순서.
  return (businessId ? businessId.replace(/^biz_/, '') : 'group').toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function random16(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function meetRoom(businessId: string | null, date: string): string {
  return `chairman-os-${roomSlug(businessId)}-${date.replaceAll('-', '')}-${random16()}`
}

export function meetUrl(businessId: string | null, date: string): string {
  return `${JITSI_ORIGIN}/${meetRoom(businessId, date)}`
}

/** 'https://meet.jit.si/chairman-os-…' → 'chairman-os-…'. 모양이 틀리면 null. */
export function roomOf(url: string | null | undefined): string | null {
  if (!url?.startsWith(`${JITSI_ORIGIN}/`)) return null
  const room = url.slice(JITSI_ORIGIN.length + 1)
  return ROOM_PATTERN.test(room) ? room : null
}
