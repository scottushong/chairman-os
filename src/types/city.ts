/**
 * 그룹 시티(Phase 8 G-1, 0037)의 어휘.
 *
 * **단계 목록은 0037 city_layout_stage_check와 글자 하나까지 같아야 한다.** 갈라지면
 * /group/edit가 DB가 받지 않는 값을 고르게 하고, 저장 순간에야 23514로 터진다.
 */
import type { BusinessId } from './primitives'

/** 'lot'은 빈 터(이니셔티브). 나머지 넷이 회사의 공사 단계다. */
export const CITY_STAGE = ['lot', 'foundation', 'frame', 'finishing', 'complete'] as const
export type CityStage = (typeof CITY_STAGE)[number]

export const CITY_STAGE_LABEL_KO: Record<CityStage, string> = {
  lot: '빈 터',
  foundation: '기초',
  frame: '골조',
  finishing: '마감',
  complete: '완공',
}

/** city_layout 한 줄. 좌표는 전경에 대한 백분율(0~100)이다. */
export interface CityLayout {
  id: number
  /** 둘 중 정확히 하나만 값이 있다(0037 city_layout_target_check). */
  business_id: BusinessId | null
  initiative_id: string | null
  x: number
  y: number
  w: number
  h: number
  /** null = 완성도에서 자동. 값이 있으면 그 단계로 고정. */
  stage_image: CityStage | null
  /** 0044 길목. null이거나 빠진 점은 상자에서 낸다(lib/city-live.ts anchorsOf). 0044 전 DB에서는 없다. */
  anchors?: CityAnchorsInput | null
}

/* ------------------------------------------------------------------ 0044 길목 */

/** 그림 위의 한 점(%). */
export interface CityPoint {
  x: number
  y: number
}

/** 건물 하나의 길목 셋 — 입구 · 창가 자리 · 건물 앞 길. */
export const CITY_ANCHOR = ['door', 'desk', 'road'] as const
export type CityAnchorName = (typeof CITY_ANCHOR)[number]
export type CityAnchors = Record<CityAnchorName, CityPoint>
/** DB에 적힌 모양 — 있는 점만(0044 city_anchors_ok). */
export type CityAnchorsInput = Partial<CityAnchors>

export const CITY_ANCHOR_LABEL_KO: Record<CityAnchorName, string> = {
  door: '입구',
  desk: '창가 자리',
  road: '앞 길',
}

/** 저장 한 건. id가 없으면 새 줄이다. */
export interface CityLayoutInput {
  id?: number
  business_id: BusinessId | null
  initiative_id: string | null
  x: number
  y: number
  w: number
  h: number
  stage_image: CityStage | null
  /** 없으면(undefined) 칸을 건드리지 않는다 — 0044 전 DB에 저장이 막히지 않게. */
  anchors?: CityAnchorsInput | null
}
