import type { BusinessStrategy } from '@/types'

/**
 * CH-024 전략 좌표의 열한 칸을 한 곳에서 정의한다 (DEFERRED D-13 결정 A).
 *
 * 화면(어떤 라벨로 그리나)과 Server Action(어떤 이름을 DB로 보내도 되나)이 같은 목록을 봐야 한다.
 * 목록이 둘로 갈라지면 화면에만 있는 칸이 저장에서 조용히 버려지거나,
 * 반대로 화면에 없는 칸 이름을 밀어 넣는 경로가 생긴다 — 후자가 더 나쁘다.
 *
 * business_id는 여기 없다. 그건 이 행이 어느 회사인가지 회장이 쓰는 문장이 아니다.
 */

export type StrategyField = Exclude<keyof BusinessStrategy, 'business_id'>

export interface StrategyFieldMeta {
  field: StrategyField
  label: string
  /** 한 줄로 끝나는 칸인가. Mission·Gap·Bottleneck 같은 판단 문장은 여러 줄로 쓴다. */
  multiline: boolean
  placeholder: string
}

export const STRATEGY_FIELDS: readonly StrategyFieldMeta[] = [
  {
    field: 'mission',
    label: 'Mission',
    multiline: true,
    placeholder: '이 회사가 왜 있는가',
  },
  { field: 'goal_1y', label: '1년 목표', multiline: false, placeholder: '올해 안에 어디까지' },
  { field: 'goal_3y', label: '3년 목표', multiline: false, placeholder: '3년 뒤의 자리' },
  {
    field: 'current_position',
    label: '현재 위치',
    multiline: false,
    placeholder: '지금 어디에 있나',
  },
  {
    field: 'target_position',
    label: '목표 위치',
    multiline: false,
    placeholder: '어디로 가야 하나',
  },
  {
    field: 'gap',
    label: 'Gap',
    multiline: true,
    // 계산하지 않는다는 말을 자리 표시에도 둔다. 두 칸을 빼면 나오는 값이 아니다(0008 주석).
    placeholder: '현재와 목표의 차이. 숫자가 아니라 판단을 쓴다',
  },
  {
    field: 'bottleneck',
    label: 'Bottleneck',
    multiline: true,
    placeholder: '무엇이 막고 있나. 사람·거래처 이름이 들어와도 된다',
  },
  { field: 'top_kpi', label: 'Top KPI', multiline: false, placeholder: '한 숫자로 본다면' },
  {
    field: 'current_priority',
    label: '현재 우선순위',
    multiline: false,
    placeholder: '지금 무엇부터',
  },
  {
    field: 'chairman_comment',
    label: '회장 메모',
    multiline: true,
    placeholder: '이 회사를 볼 때 기억해 둘 것',
  },
] as const

const FIELD_SET = new Set<string>(STRATEGY_FIELDS.map((f) => f.field))

/** Server Action이 받은 칸 이름이 실제로 이 표의 칸인지. 아니면 DB로 보내지 않는다. */
export function isStrategyField(value: unknown): value is StrategyField {
  return typeof value === 'string' && FIELD_SET.has(value)
}

/**
 * 아직 좌표가 없는 회사(CH-002로 방금 추가한 곳)에 첫 칸을 쓸 때의 바닥값.
 * 0008이 열한 칸 전부 not null default ''라 빈 문자열이 '아직 안 썼다'의 표현이다.
 */
export function emptyStrategy(businessId: string): BusinessStrategy {
  return {
    business_id: businessId,
    mission: '',
    goal_1y: '',
    goal_3y: '',
    top_kpi: '',
    current_position: '',
    target_position: '',
    gap: '',
    current_priority: '',
    bottleneck: '',
    chairman_comment: '',
  }
}
