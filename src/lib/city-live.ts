import type { CityItem } from '@/lib/city'
import type { CityAnchorName, CityAnchors, CityLayout, CityPoint, IsoDate, Role } from '@/types'

/**
 * 살아 있는 그룹 시티(Phase 8 G-2 · G-3)의 **규격 한 벌**.
 *
 * 1분마다 서버가 원천(접속 · 업무 · 결재 · 이니셔티브 · AI Job · 브리핑)을 읽어 `CityLive` 한 장으로 접고,
 * 두 렌더러가 **같은 한 장을 읽는다** — PC의 3D 씬(components/city/scene/*)과 HOME 띠 · 폰 · 폴백의
 * 그림 + 레이어(components/city/live-layer.tsx). 둘이 각자 원천을 읽으면 같은 순간에 한쪽에서는
 * 결재 서류가 걷고 다른 쪽에서는 없다.
 *
 * 그래서 이 파일은 **«누가 · 무엇을 · 어디서 어디로»까지만** 말한다. 어디가 화면의 몇 픽셀인지는
 * 렌더러가 정한다: 2D는 길목 점(0044 anchors, 그림 %)으로, 3D는 건물의 앞면 · 창가 · 대로로.
 * 자리는 `CitySpot`(배치 줄 id + 길목 이름, 또는 광장)으로만 적는다.
 *
 * 이 파일은 데이터를 스스로 읽지 않는다(lib/city.ts와 같은 원칙) — 서버의 lib/city-live-load.ts가
 * 읽어 `CityLiveSources`로 내려 준 것만 접는다. 브라우저에서도 import 한다(2D 좌표 계산).
 */

/* ------------------------------------------------------------------ 하늘 */

/** 현지 시각의 하늘. 그림(낮 · 저녁 두 장)보다 한 칸 많다 — 밤은 저녁 그림을 어둡게 깔고 창을 켠다. */
export type CitySky = 'day' | 'dusk' | 'night'

/** 6~16시 낮 · 17~19시 해질녘 · 20~5시 밤. */
export function skyAt(hour: number): CitySky {
  if (hour >= 6 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}

export const CITY_SKY_LABEL_KO: Record<CitySky, string> = { day: '낮', dusk: '해질녘', night: '밤' }

/* ------------------------------------------------------------------ 길목 */

/**
 * 광장 — 오벨리스크의 발치. 전경(city-day) 위에서 눈으로 잰 자리(%)다. 회장 · 결재 상신 · 브리핑
 * 봉투가 여기로 모인다. 그림이 바뀌면 여기도 같이 본다(scripts/city-assets.mjs의 STAGE_CROP과 같은 판단).
 */
export const CITY_PLAZA: CityPoint = { x: 59.6, y: 64.5 }

/**
 * 길목 셋. 적힌 점(0044)이 있으면 그것, 없으면 상자에서 낸다:
 * 입구 = 상자 아래 가운데에서 조금 위, 창가 = 상자 가운데 조금 아래, 길 = 상자 바로 아래(그림 안으로 가둔다).
 */
export function anchorsOf(layout: CityLayout): CityAnchors {
  const { x, y, w, h } = layout
  const cx = x + w / 2
  const clamp = (v: number) => Math.min(99, Math.max(1, v))
  const auto: CityAnchors = {
    door: { x: cx, y: clamp(y + h * 0.94) },
    desk: { x: clamp(x + w * 0.35), y: clamp(y + h * 0.62) },
    road: { x: clamp(cx + w * 0.18), y: clamp(y + h + 3) },
  }
  return { ...auto, ...(layout.anchors ?? {}) }
}

/* ------------------------------------------------------------------ 규격 */

/** 캐릭터 여덟 — 직원 넷 · 팀장 · CEO · 회장 · AI 로봇. */
export const CITY_CHARACTER = ['staff1', 'staff2', 'staff3', 'staff4', 'lead', 'ceo', 'chairman', 'robot'] as const
export type CityCharacter = (typeof CITY_CHARACTER)[number]

/** 동작 넷 — 걷기 · 앉아 일하기 · 서류 들고 걷기 · 손들기. */
export const CITY_MOTION = ['walk', 'desk', 'carry', 'raise'] as const
export type CityMotion = (typeof CITY_MOTION)[number]

/** 자리. 배치 줄의 길목 하나, 또는 광장. */
export type CitySpot = { at: 'plaza' } | { at: 'layout'; layoutId: number; anchor: CityAnchorName }

export interface CityActor {
  /** 폴링 사이에 같은 사람 · 같은 일을 잇는 열쇠. `u:` 접속 · `t:` 업무 · `r:` 결재 · `c:` 회장. */
  id: string
  character: CityCharacter
  motion: CityMotion
  /** 이름표. **보는 사람이 Chairman일 때만** 채운다 — 그 밖에는 늘 null(/privacy 2-1절). */
  label: string | null
  /** 걸음의 출발점. 앉아 있거나 서 있는 사람은 to와 같다. */
  from: CitySpot
  to: CitySpot
  /** desk만. 0~1. 잴 수 없으면 null(진행바가 흐르는 줄로 선다). */
  progress?: number | null
}

export interface CityVehicle {
  id: string
  from: CitySpot
  to: CitySpot
  /** 이니셔티브 이름 — 보는 사람이 그 이니셔티브를 읽을 수 있어서 여기 왔다(RLS). */
  label: string
}

export interface CityLive {
  /** 서버가 접은 시각(ISO). */
  at: string
  actors: CityActor[]
  vehicles: CityVehicle[]
  /** AI Job이 도는 중 — 로봇이 건물들 앞 길을 돈다. 길은 렌더러가 정한다. */
  robotPatrol: boolean
  /** 오늘 그룹 브리핑이 끝났다 — 오벨리스크에 봉투. */
  briefDelivered: boolean
  /** 회장이 접속해 있다(최근 5분, 또는 지금 보는 사람이 회장) — 첨탑 점등. */
  chairmanOnline: boolean
  /** 끝난 업무 id. 지난 폴링에 앉아 있던 `t:` 가 여기로 오면 렌더러가 3초 손을 든다. */
  doneTaskIds: string[]
}

/** 폴링 한 번의 응답. 건물(매출 · 단계)도 같이 온다 — 매출이 갱신되면 층이 올라가야 한다. */
export interface CitySnapshot {
  items: CityItem[]
  live: CityLive
}

export const EMPTY_LIVE: CityLive = {
  at: new Date(0).toISOString(),
  actors: [],
  vehicles: [],
  robotPatrol: false,
  briefDelivered: false,
  chairmanOnline: false,
  doneTaskIds: [],
}

/* ------------------------------------------------------------------ 원천 → 규격 */

/** 최근 몇 분의 활동을 «지금 있다»로 보는가. 원문: activity_log 최근 5분. */
export const PRESENCE_MINUTES = 5
/** 화면에 한 번에 서는 사람 수의 끝. 넘으면 오래된 활동부터 뺀다 — 폰 60fps를 지킨다. */
export const MAX_ACTORS = 24

export interface CityLiveSources {
  now: Date
  /** 오늘(KST). 이니셔티브 next_action_date · 브리핑 run_date와 견준다. */
  today: IsoDate
  viewerRole: Role | null
  layout: CityLayout[]
  people: { user_id: string; role: Role; name: string; business_id: string | null; is_lead: boolean }[]
  /** 최근 활동. out = 로그아웃(없으면 5분이 지나 저절로 나간다). */
  activity: { user_id: string; at: string; kind: 'in' | 'out' }[]
  tasks: {
    task_id: string
    owner: string
    business_id: string | null
    status: 'Todo' | 'Doing' | 'Blocked' | 'Done'
    since: IsoDate | null
    deadline: IsoDate | null
  }[]
  /** 결재. to_lead = 직원 → 팀장, to_chairman = 팀장이 회장에게 올렸다. */
  requests: { id: string; business_id: string; created_by: string | null; stage: 'to_lead' | 'to_chairman' }[]
  initiatives: { initiative_id: string; title: string; business_id: string | null; next_action_date: IsoDate | null }[]
  aiRunning: boolean
  briefDoneToday: boolean
}

/** 같은 사람은 늘 같은 얼굴 — id의 글자 합으로 직원 넷 중 하나를 고른다. */
export function staffVariant(id: string): CityCharacter {
  let n = 0
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return (['staff1', 'staff2', 'staff3', 'staff4'] as const)[n % 4]
}

function characterOf(person: CityLiveSources['people'][number] | undefined, fallbackId: string): CityCharacter {
  if (!person) return staffVariant(fallbackId)
  if (person.role === 'Chairman') return 'chairman'
  if (person.role === 'AIAgent' || person.role === 'Integration') return 'robot'
  if (person.role === 'BusinessCEO') return 'ceo'
  if (person.is_lead || person.role === 'TeamLead') return 'lead'
  return staffVariant(person.user_id)
}

const DAY = 86_400_000

/** 업무의 진행 — 시작일에서 마감일까지 지난 몫. 마감이 없으면 잴 수 없다(null). */
export function taskProgress(since: IsoDate | null, deadline: IsoDate | null, now: Date): number | null {
  if (!since || !deadline) return null
  const a = Date.parse(since)
  const b = Date.parse(deadline) + DAY
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null
  return Math.min(1, Math.max(0, (now.getTime() - a) / (b - a)))
}

export function buildCityLive(src: CityLiveSources): CityLive {
  const byBusiness = new Map<string, CityLayout>()
  const byInitiative = new Map<string, CityLayout>()
  for (const l of src.layout) {
    if (l.business_id) byBusiness.set(l.business_id, l)
    if (l.initiative_id) byInitiative.set(l.initiative_id, l)
  }
  const spot = (businessId: string | null | undefined, anchor: CityAnchorName): CitySpot | null => {
    const l = businessId ? byBusiness.get(businessId) : undefined
    return l ? { at: 'layout', layoutId: l.id, anchor } : null
  }
  const personOf = new Map(src.people.map((p) => [p.user_id, p]))
  const named = src.viewerRole === 'Chairman'
  const labelOf = (userId: string | null | undefined) => (named && userId ? (personOf.get(userId)?.name ?? null) : null)

  // 지금 있는 사람 — 최근 5분 안의 마지막 활동이 로그아웃이 아닌 사람.
  const since = src.now.getTime() - PRESENCE_MINUTES * 60_000
  const last = new Map<string, { at: number; kind: 'in' | 'out' }>()
  for (const a of src.activity) {
    const at = Date.parse(a.at)
    if (!Number.isFinite(at) || at < since) continue
    const prev = last.get(a.user_id)
    if (!prev || at >= prev.at) last.set(a.user_id, { at, kind: a.kind })
  }
  const present = [...last.entries()]
    .filter(([, v]) => v.kind === 'in')
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => id)

  const actors: CityActor[] = []
  const busy = new Set<string>()

  // 결재 서류 — 직원 → 팀장 입구, 팀장 → 오벨리스크.
  for (const r of src.requests) {
    if (r.stage === 'to_lead') {
      const from = spot(r.business_id, 'road')
      const to = spot(r.business_id, 'door')
      if (!from || !to) continue
      const who = r.created_by ? personOf.get(r.created_by) : undefined
      actors.push({ id: `r:${r.id}`, character: characterOf(who, r.id), motion: 'carry', label: labelOf(r.created_by), from, to })
      if (r.created_by) busy.add(r.created_by)
    } else {
      const from = spot(r.business_id, 'door')
      if (!from) continue
      actors.push({ id: `r:${r.id}`, character: 'lead', motion: 'carry', label: null, from, to: { at: 'plaza' } })
    }
  }

  // 진행 중 업무 — 창가 자리 + 진행바.
  for (const t of src.tasks) {
    if (t.status !== 'Doing') continue
    const at = spot(t.business_id, 'desk')
    if (!at) continue
    actors.push({
      id: `t:${t.task_id}`,
      character: characterOf(personOf.get(t.owner), t.owner),
      motion: 'desk',
      label: labelOf(t.owner),
      from: at,
      to: at,
      progress: taskProgress(t.since, t.deadline, src.now),
    })
    busy.add(t.owner)
  }

  // 접속한 사람 — 건물 앞 길에서 입구로. 이미 서류를 들었거나 자리에 앉은 사람은 한 번만 선다.
  const viewerIsChairman = src.viewerRole === 'Chairman'
  let chairmanOnline = viewerIsChairman
  for (const userId of present) {
    const p = personOf.get(userId)
    if (p?.role === 'Chairman') {
      chairmanOnline = true
      continue
    }
    if (busy.has(userId) || p?.role === 'AIAgent' || p?.role === 'Integration') continue
    const from = spot(p?.business_id, 'road')
    const to = spot(p?.business_id, 'door')
    if (!from || !to) continue
    actors.push({ id: `u:${userId}`, character: characterOf(p, userId), motion: 'walk', label: labelOf(userId), from, to })
  }
  // 회장은 오벨리스크 앞에 선다(첨탑과 같은 사실을 사람으로도).
  if (chairmanOnline) {
    const chairman = src.people.find((p) => p.role === 'Chairman')
    actors.push({
      id: 'c:chairman',
      character: 'chairman',
      motion: 'walk',
      label: named ? (chairman?.name ?? '회장') : null,
      from: { at: 'plaza' },
      to: { at: 'plaza' },
    })
  }

  // 오늘이 다음 행동인 이니셔티브 — 터(또는 회사)와 광장(또는 회사) 사이의 차량.
  const vehicles: CityVehicle[] = []
  for (const i of src.initiatives) {
    if (i.next_action_date !== src.today) continue
    const lot = byInitiative.get(i.initiative_id)
    const company = spot(i.business_id, 'road')
    const from: CitySpot | null = lot ? { at: 'layout', layoutId: lot.id, anchor: 'road' } : company
    if (!from) continue
    const to: CitySpot = lot && company ? company : { at: 'plaza' }
    vehicles.push({ id: `v:${i.initiative_id}`, from, to, label: i.title })
  }

  return {
    at: src.now.toISOString(),
    actors: actors.slice(0, MAX_ACTORS),
    vehicles: vehicles.slice(0, 6),
    robotPatrol: src.aiRunning,
    briefDelivered: src.briefDoneToday,
    chairmanOnline,
    doneTaskIds: src.tasks.filter((t) => t.status === 'Done').map((t) => `t:${t.task_id}`),
  }
}

/* ------------------------------------------------------------------ 2D 자리 */

/** 자리 → 그림 위의 점(%). 배치에서 사라진 줄이면 광장으로 — 사람이 허공에 서지 않는다. */
export function spotPoint(spot: CitySpot, layoutById: Map<number, CityLayout>): CityPoint {
  if (spot.at === 'plaza') return CITY_PLAZA
  const l = layoutById.get(spot.layoutId)
  return l ? anchorsOf(l)[spot.anchor] : CITY_PLAZA
}
