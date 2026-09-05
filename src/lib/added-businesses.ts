import { BUSINESS_STATUS, type Business, type BusinessStatus } from '@/types'

/**
 * CH-002로 추가한 회사의 저장소.
 * 시드(src/data/businesses.json)는 읽기 전용이라 새 회사를 원본에 쓰지 않는다.
 * hidden/pinned과 같은 방식으로 localStorage에 쌓고 화면에서 시드 뒤에 이어 붙인다.
 * Phase 1에서 Business DB가 붙으면 이 파일만 갈아 끼운다.
 */

const KEY = 'chairman-os:added-businesses'
const EMPTY = '[]'

/** 시드 sort_order가 1~5라, 추가분은 그 뒤에서 시작해 항상 뒤에 선다. */
const SORT_BASE = 1000

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

export function getServerSnapshot(): string {
  return EMPTY
}

function isBusinessStatus(value: unknown): value is BusinessStatus {
  return BUSINESS_STATUS.includes(value as BusinessStatus)
}

/** 저장된 값이 깨져 있어도 화면은 떠야 한다. 모양이 맞는 항목만 통과시킨다. */
export function parseAdded(raw: string): Business[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (b): b is Business =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as Business).business_id === 'string' &&
        typeof (b as Business).name === 'string' &&
        isBusinessStatus((b as Business).status),
    )
  } catch {
    return []
  }
}

export function addBusiness(input: {
  name: string
  industry: string
  status: BusinessStatus
}): Business {
  const existing = parseAdded(getSnapshot())
  const business: Business = {
    // 시드 id와 부딪히지 않게 접두사를 나눈다. 서버 id가 생기면 여기서 교체된다.
    business_id: `biz_new_${Date.now().toString(36)}`,
    name: input.name.trim(),
    status: input.status,
    industry: input.industry.trim(),
    owner_user_id: 'user_001',
    visible: true,
    sort_order: SORT_BASE + existing.length,
    pinned: false,
  }

  cache = JSON.stringify([...existing, business])
  try {
    localStorage.setItem(KEY, cache)
  } catch {
    // 저장소를 못 써도 이번 세션 동안은 카드가 떠야 한다.
  }
  listeners.forEach((l) => l())
  return business
}
