import type { CityItem } from '@/lib/city'
import type { CitySpot } from '@/lib/city-live'
import type { CityAnchorName } from '@/types'

import { clamp, hashOf } from './shared'

/**
 * 3D 도시의 자리 잡기. 2D 그림의 %(layout x/y)를 그대로 옮기지 않는다 — 그림은 원근이 들어간
 * 한 장이라 그대로 세우면 건물이 겹치고 광장이 한쪽으로 쏠린다. 대신 **광장을 둘러싼 호**에
 * 회사를 layout.x 순서로 세워 왼쪽→오른쪽 순서만 그림과 맞춘다. 이니셔티브 터는 앞쪽 바깥 호.
 *
 * 좌표: 광장 중심이 원점, 카메라가 처음 보는 쪽이 +z(앞). 각 a 는 뒤(-z)에서 0, 시계 방향(+x)으로 커진다.
 */

export type V3 = [number, number, number]

export const PLAZA_R = 13
export const RING_IN = 17
export const RING_OUT = 23
export const RING_MID = 20
export const LANE_CAR = 21.6
export const LANE_ROBOT = 18.4
export const COMPANY_R = 32
export const LOT_R = 36
export const CANAL_IN = 50
export const CANAL_OUT = 57
/** 오벨리스크 — 광장 앞 가장자리(카메라 쪽). */
export const OBELISK: V3 = [0, 0, 8.5]

export const FLOOR_H = 3.2
export const MIN_FLOORS = 3
export const MAX_FLOORS = 16

/**
 * 월 매출 → 층수. 제곱근으로 누른다 — 매출이 열 배인 회사가 열 배 높으면 작은 회사가 땅에 붙는다.
 * 매출이 없는(null) 회사도 3층은 선다: «자료 없음»이지 «빈 땅»이 아니다.
 */
export function towerFloors(revenue: number | null): number {
  if (revenue === null || !Number.isFinite(revenue) || revenue <= 0) return MIN_FLOORS
  const h = 8 + 6.5 * Math.sqrt(revenue / 1e8)
  return clamp(Math.round(h / FLOOR_H), MIN_FLOORS, MAX_FLOORS)
}

export interface Placement {
  id: number
  item: CityItem
  /** 광장에서 본 방향(라디안). */
  angle: number
  pos: V3
  /** 앞면(+z 로컬)이 광장을 보게 하는 회전. */
  rotY: number
  w: number
  d: number
  floors: number
  anchors: Record<CityAnchorName, V3>
}

export const radial = (a: number): V3 => [Math.sin(a), 0, -Math.cos(a)]
export const tangent = (a: number): V3 => [Math.cos(a), 0, Math.sin(a)]

function place(item: CityItem, a: number, r: number, w: number, d: number): Placement {
  const u = radial(a)
  const t = tangent(a)
  const at = (dist: number, lat: number): V3 => [u[0] * dist + t[0] * lat, 0, u[2] * dist + t[2] * lat]
  const front = r - d / 2
  return {
    id: item.layout.id,
    item,
    angle: a,
    pos: at(r, 0),
    rotY: -a,
    w,
    d,
    floors: item.kind === 'business' ? towerFloors(item.revenue) : 0,
    anchors: {
      door: at(front - 1, 0),
      // 창가 자리 — 1층 유리 앞, 입구에서 옆으로 비켜 선다(입구로 드나드는 사람과 겹치지 않게).
      desk: at(front - 1.9, -2.6),
      road: at(RING_MID, 1.4),
    },
  }
}

const byX = (a: CityItem, b: CityItem) => a.layout.x - b.layout.x || a.layout.id - b.layout.id

export function placeItems(items: CityItem[]): Placement[] {
  const deg = Math.PI / 180
  const biz = items.filter((i) => i.kind === 'business').sort(byX)
  const lots = items.filter((i) => i.kind === 'initiative').sort(byX)
  const out: Placement[] = []
  // 회사: 뒤쪽 호 ±110° 안. 적으면 좁게 모아 광장 뒤에 선다.
  const bStep = biz.length > 1 ? Math.min(34, 220 / (biz.length - 1)) * deg : 0
  biz.forEach((item, i) => out.push(place(item, (i - (biz.length - 1) / 2) * bStep, COMPANY_R, 9, 8)))
  // 터: 앞쪽 호(π 둘레). 앞에서 보면 +x 가 오른쪽이므로 각을 거꾸로 센다.
  const lStep = lots.length > 1 ? Math.min(28, 80 / (lots.length - 1)) * deg : 0
  lots.forEach((item, i) => out.push(place(item, Math.PI - (i - (lots.length - 1) / 2) * lStep, LOT_R, 8, 7)))
  return out
}

/* ------------------------------------------------------------------ 자리 → 좌표 */

export interface SpotPos {
  p: V3
  /** 멈춰 섰을 때 바라보는 회전(rotation.y). */
  face: number
  /** 각(차 · 로봇의 순환 길). 광장은 π(앞). */
  angle: number
}

/**
 * CitySpot → 월드 좌표. 같은 자리에 여럿이 서도 겹치지 않게 id 해시로 옆으로 벌린다.
 * 배치에서 사라진 줄이면 광장으로(lib/city-live spotPoint 와 같은 판단 — 사람이 허공에 서지 않는다).
 */
export function spotPos(spot: CitySpot, byId: Map<number, Placement>, salt: string): SpotPos {
  const h = hashOf(salt)
  const pl = spot.at === 'layout' ? byId.get(spot.layoutId) : undefined
  if (!pl || spot.at === 'plaza') {
    // 오벨리스크 발치 — 앞쪽 반원에 흩어 선다(뒤는 오벨리스크에 가린다).
    const a = ((h % 9) / 8 - 0.5) * Math.PI * 1.1
    const r = 3.3 + ((h >>> 4) % 3) * 0.7
    const p: V3 = [OBELISK[0] + Math.sin(a) * r, 0, OBELISK[2] + Math.cos(a) * r]
    return { p, face: a, angle: Math.PI }
  }
  const t = tangent(pl.angle)
  const u = radial(pl.angle)
  const base = pl.anchors[spot.anchor]
  const lat = spot.anchor === 'desk' ? ((h % 3) - 1) * 1.9 : ((h % 5) - 2) * 0.8
  const p: V3 = [base[0] + t[0] * lat, 0, base[2] + t[2] * lat]
  return { p, face: Math.atan2(u[0], u[2]), angle: pl.angle }
}

/** 순환 길 위의 점. */
export function ringPoint(a: number, r: number): V3 {
  const u = radial(a)
  return [u[0] * r, 0, u[2] * r]
}

/** a1 → a2 의 짧은 쪽 호. 같은 자리면 한 바퀴를 돈다(멈춰 선 차보다 도는 차가 «오늘 할 일»답다). */
export function arcDelta(a1: number, a2: number): number {
  let d = (a2 - a1) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  if (Math.abs(d) < 0.05) d = Math.PI * 2
  return d
}
