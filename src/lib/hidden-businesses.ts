/**
 * CH-003 숨김 상태의 저장소.
 * Acceptance가 '새로고침 후 상태 유지'라 localStorage에 둔다.
 * 서버 렌더는 항상 '숨김 없음'으로 시작하고 hydration 뒤에 실제 값으로 넘어가도록
 * useSyncExternalStore의 server snapshot을 따로 준다. (개인 설정이라 서버가 알 수 없다.)
 *
 * Phase 1에서 사용자 설정(CH-056)이 서버에 붙으면 이 파일만 갈아 끼운다.
 */

const KEY = 'chairman-os:hidden-businesses'
const EMPTY = '[]'

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
  // 다른 탭에서 바꾼 것도 따라간다.
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
  return EMPTY
}

export function parseHidden(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export function setHidden(ids: string[]): void {
  cache = JSON.stringify(ids)
  try {
    localStorage.setItem(KEY, cache)
  } catch {
    // 저장소를 못 써도 이번 세션 동안은 동작해야 한다. 숨김은 편의 기능이다.
  }
  listeners.forEach((l) => l())
}
