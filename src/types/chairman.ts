import type { IsoDate, IsoDateTime } from './primitives'

/**
 * Phase 3-B 회장 루틴 (0014_chairman_routine).
 *
 * 회사에 속하지 않는 회장 개인의 기록이다. CH-020 Project와 이름이 겹치지만 다른 것이다 —
 * 저쪽은 회사의 업무 묶음이고 진행률을 사람이 올린다. 이쪽은 진행이 곧 시간이라 저장하지 않는다.
 */

export const CHAIRMAN_PROJECT_STATUS = ['Active', 'Done', 'Dropped'] as const
export type ChairmanProjectStatus = (typeof CHAIRMAN_PROJECT_STATUS)[number]

export const CHAIRMAN_PROJECT_STATUS_LABEL_KO: Record<ChairmanProjectStatus, string> = {
  Active: '진행 중',
  Done: '완료',
  Dropped: '중단',
}

export interface ChairmanProject {
  project_id: string
  title: string
  start_date: IsoDate
  target_date: IsoDate
  note: string
  this_month_action: string
  status: ChairmanProjectStatus
}

export interface ChairmanManifesto {
  body: string
  /** 한 번도 저장한 적 없으면 null */
  updated_at: IsoDateTime | null
}

/** 야간 브리핑이 장기 프로젝트마다 남기는 이번 주 행동 하나. 없으면 action이 '이번 주는 없음'이다. */
export interface ProjectNote {
  project_title: string
  action: string
}
