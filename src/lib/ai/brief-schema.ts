import type { AiBriefItem, ProjectNote } from '@/types'

import type { AiBrief } from './adapter'

/**
 * { summary, confidence, items[] } 한 벌.
 *
 * 두 곳에서 쓴다.
 *   BRIEF_JSON_SCHEMA  모델에 output_config.format으로 넘긴다(구조 강제).
 *   parseBrief()       돌아온 값을 한 번 더 검사한다. 모델 쪽 강제가 있어도 여기서 거른다 —
 *                      이 값이 사람 검토 없이 회장 화면에 그대로 올라가는 자리다.
 *
 * Structured Outputs는 숫자 범위(minimum/maximum)를 스키마로 강제하지 않는다.
 * confidence의 0~1은 parseBrief가 잘라 맞춘다(DB check 제약도 0~1이다).
 */

const SEVERITIES = ['info', 'warning', 'critical'] as const

export const BRIEF_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '회장이 아침에 읽는 3~5문장 요약' },
    confidence: { type: 'number', description: '0~1. 입력 데이터가 요약을 얼마나 뒷받침하는가' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: [...SEVERITIES] },
        },
        required: ['title', 'detail', 'severity'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'confidence', 'items'],
  additionalProperties: false,
} as const

/**
 * 그룹 브리핑용. 회사 요약 스키마에 project_notes 하나를 더한다(Phase 3-B).
 * 회사 요약에는 장기 프로젝트가 입력으로 가지 않으니 이 칸을 요구하지 않는다.
 */
export const DAILY_BRIEF_JSON_SCHEMA = {
  ...BRIEF_JSON_SCHEMA,
  properties: {
    ...BRIEF_JSON_SCHEMA.properties,
    project_notes: {
      type: 'array',
      description: '장기 프로젝트마다 하나. 이번 주 행동 한 문장, 없으면 "이번 주는 없음"',
      items: {
        type: 'object',
        properties: {
          project_title: { type: 'string' },
          action: { type: 'string' },
        },
        required: ['project_title', 'action'],
        additionalProperties: false,
      },
    },
  },
  required: [...BRIEF_JSON_SCHEMA.required, 'project_notes'],
} as const

export class BriefShapeError extends Error {}

export function parseBrief(raw: unknown, opts: { projectNotes?: boolean } = {}): AiBrief {
  if (typeof raw !== 'object' || raw === null) throw new BriefShapeError('객체가 아니다')
  const o = raw as Record<string, unknown>

  const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
  if (!summary) throw new BriefShapeError('summary가 비었다')

  if (typeof o.confidence !== 'number' || Number.isNaN(o.confidence)) {
    throw new BriefShapeError('confidence가 숫자가 아니다')
  }
  // numeric(3,2)에 맞춘다. 0.905 같은 값이 들어가면 DB가 반올림하는데, 화면과 기록이 어긋나지 않게 여기서 정한다.
  const confidence = Math.round(Math.min(1, Math.max(0, o.confidence)) * 100) / 100

  if (!Array.isArray(o.items)) throw new BriefShapeError('items가 배열이 아니다')
  const items: AiBriefItem[] = o.items.map((it, i) => {
    const r = (typeof it === 'object' && it !== null ? it : {}) as Record<string, unknown>
    const severity = SEVERITIES.find((s) => s === r.severity)
    if (typeof r.title !== 'string' || typeof r.detail !== 'string' || !severity) {
      throw new BriefShapeError(`items[${i}] 모양이 맞지 않다`)
    }
    return { title: r.title.trim(), detail: r.detail.trim(), severity }
  })

  if (!opts.projectNotes) return { summary, confidence, items }

  if (!Array.isArray(o.project_notes)) throw new BriefShapeError('project_notes가 배열이 아니다')
  const project_notes: ProjectNote[] = o.project_notes.map((n, i) => {
    const r = (typeof n === 'object' && n !== null ? n : {}) as Record<string, unknown>
    if (typeof r.project_title !== 'string' || typeof r.action !== 'string' || !r.action.trim()) {
      throw new BriefShapeError(`project_notes[${i}] 모양이 맞지 않다`)
    }
    return { project_title: r.project_title.trim(), action: r.action.trim() }
  })

  return { summary, confidence, items, project_notes }
}
