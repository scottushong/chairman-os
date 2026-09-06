import { BUSINESS_STATUS, type Business, type BusinessStatus } from '@/types'

/**
 * CH-002로 추가한 회사의 저장소.
 *
 * 숨김·핀은 user_settings로 옮겼는데(CH-003/004) 이건 아직 localStorage에 남아 있다.
 * 성격이 다르기 때문이다 — 숨김·핀은 '내 화면' 설정이고, 회사 추가는 조직 데이터를 만드는 일이라
 * businesses INSERT 권한(0002에서 Chairman만)과 감사 기록(CH-051)이 같이 걸린다.
 * 이번 단계 범위 밖이라 그대로 뒀다(DEFERRED D-08).
 *
 * 그래서 지금 추가한 회사는 이 브라우저에만 있고 다른 기기에서는 보이지 않는다.
 * 모달이 그 사실을 화면에 적어 둔다.
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
