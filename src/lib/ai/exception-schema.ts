import type { ExceptionAnalysis } from './adapter'

/**
 * 예외 분석 { cause, ceo_response, monitor_days } 한 벌 — 블록 B-2.
 *
 * brief-schema.ts와 같은 자리에 같은 이유로 둔다: 모델 쪽 구조 강제가 있어도 돌아온 값을
 * 한 번 더 거른다. 이 값이 사람 검토 없이 `exceptions.ai_analysis`에 들어가고, 그 칸은
 * 회장 화면에 그대로 올라간다.
 *
 * **셋 말고는 받지 않는다**(`additionalProperties: false`). 모델이 `severity`나 `status`를
 * 덧붙여 보내면 그 칸은 여기서 사라지고, 사라진 값은 아무것도 바꾸지 못한다 —
 * "AI는 결정하지 않는다"(§19)를 스키마가 지키는 자리다.
 */

/** 권고 관찰 일수의 상·하한. 원문의 회장 액션이 "관찰 14일"이라 그 자리가 이 범위 안에 있다. */
export const MONITOR_DAYS_MIN = 1
export const MONITOR_DAYS_MAX = 90

export const EXCEPTION_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    cause: { type: 'string', description: '원인 분해. 입력에 있는 수치로만 쓴다' },
    ceo_response: { type: 'string', description: 'CEO가 이미 대응 중인지에 대한 서술' },
    monitor_days: {
      type: 'number',
      description: `권고 관찰 일수(${MONITOR_DAYS_MIN}~${MONITOR_DAYS_MAX})`,
    },
  },
  required: ['cause', 'ceo_response', 'monitor_days'],
  additionalProperties: false,
} as const

export class AnalysisShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnalysisShapeError'
  }
}

const text = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new AnalysisShapeError(`${field}가 비어 있다.`)
  }
  return v.trim()
}

/**
 * **셋이 다 있어야 통과한다.** 하나라도 없으면 던지고, 호출자는 `ai_analysis`를 null로
 * 둔 채 예외를 그대로 만든다 — 반쪽 분석을 남기면 화면이 "CEO 대응"칸을 빈 채로 그리고,
 * 읽는 사람은 그것을 «CEO가 대응하지 않는다»로 읽는다.
 *
 * `monitor_days`는 범위를 **자르지 않고 거절한다.** brief-schema의 `confidence`는 잘라
 * 맞추지만(0~1 밖은 뜻이 분명하다), 여기서 999를 90으로 자르면 모델이 낸 권고가 아니라
 * 이 파일이 지어낸 권고가 회장에게 간다.
 */
export function parseExceptionAnalysis(value: unknown): ExceptionAnalysis {
  if (typeof value !== 'object' || value === null) throw new AnalysisShapeError('객체가 아니다.')
  const raw = value as Record<string, unknown>
  const days = raw.monitor_days
  if (typeof days !== 'number' || !Number.isFinite(days)) {
    throw new AnalysisShapeError('monitor_days가 수가 아니다.')
  }
  const rounded = Math.round(days)
  if (rounded < MONITOR_DAYS_MIN || rounded > MONITOR_DAYS_MAX) {
    throw new AnalysisShapeError(
      `monitor_days가 ${MONITOR_DAYS_MIN}~${MONITOR_DAYS_MAX} 밖이다(${days}).`,
    )
  }
  return {
    cause: text(raw.cause, 'cause'),
    ceo_response: text(raw.ceo_response, 'ceo_response'),
    monitor_days: rounded,
  }
}
