import { businesses } from '@/data'
import type { BusinessId } from '@/types'

/**
 * CH-004 Pin 상태의 저장소.
 * hidden-businesses.ts와 같은 방식이다 — 개인 설정이라 서버가 알 수 없고,
 * Acceptance('Pin 카드가 항상 앞에 표시')를 새로고침 뒤에도 지켜야 해서 localStorage에 둔다.
 *
 * 시드(businesses.json)의 pinned 값은 읽기 전용 초기값이고,
 * 사용자가 한 번이라도 손대면 이 저장소가 그 위를 덮는다.
 * Phase 1에서 사용자 설정(CH-056)이 서버에 붙으면 이 파일만 갈아 끼운다.
 */

const KEY = 'chairman-os:pinned-businesses'
/** 저장된 값이 없다는 뜻. '핀이 하나도 없음'([])과 구분해야 시드 기본값을 살릴 수 있다. */
const UNSET = ''

let cache = UNSET
const listeners = new Set<() => void>()

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? UNSET
  } catch {
    return UNSET
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

export function getServerSnapshot(): string {
  return UNSET
}

/** 시드 pinned=true인 회사들. 저장된 설정이 없을 때의 기본 핀이다. */
export function seedPinned(): BusinessId[] {
  return businesses.filter((b) => b.pinned).map((b) => b.business_id)
}

export function parsePinned(raw: string): BusinessId[] {
  if (raw === UNSET) return seedPinned()
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as BusinessId[]) : seedPinned()
  } catch {
    return seedPinned()
  }
}

export function setPinned(ids: BusinessId[]): void {
  cache = JSON.stringify(ids)
  try {
    localStorage.setItem(KEY, cache)
  } catch {
    // 저장소를 못 써도 이번 세션 동안은 동작해야 한다. Pin은 편의 기능이다.
  }
  listeners.forEach((l) => l())
}
