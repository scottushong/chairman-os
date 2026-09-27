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
}
