import type { DrCr } from '@/types'

/**
 * 자주 쓰는 전표 모양 (Phase 2-B 블록 2). 템플릿은 라인을 채워 줄 뿐이다 — 채운 뒤 사람이 고친다.
 *
 * 계정코드는 표준 계정과목표(standard-chart.ts)의 코드다. 회사에 그 계정이 없거나 비활성이면
 * 그 줄의 계정을 비워 둔다. 폼이 '계정을 고르세요'라고 말한다 — 없는 계정으로 조용히 채우지 않는다.
 * DY처럼 ECOUNT 코드를 쓰는 회사는 대부분 비어서 나온다. 그래도 차대 모양은 쓸모가 있다.
 */

export interface JournalTemplate {
  id: string
  label: string
  /** 적요 기본값 */
  memo: string
  lines: { side: DrCr; code: string }[]
}

export const JOURNAL_TEMPLATES: readonly JournalTemplate[] = [
  {
    id: 'sale-cash',
    label: '매출 (현금 입금)',
    memo: '매출 — 입금',
    lines: [
      { side: 'debit', code: '1030' },
      { side: 'credit', code: '4010' },
    ],
  },
  {
    id: 'sale-credit',
    label: '매출 (외상)',
    memo: '매출 — 외상',
    lines: [
      { side: 'debit', code: '1080' },
      { side: 'credit', code: '4010' },
    ],
  },
  {
    id: 'collect',
    label: '외상대금 회수',
    memo: '외상매출금 회수',
    lines: [
      { side: 'debit', code: '1030' },
      { side: 'credit', code: '1080' },
    ],
  },
  {
    id: 'expense',
    label: '비용 지급',
    memo: '비용 지급',
    lines: [
      { side: 'debit', code: '8190' },
      { side: 'credit', code: '1030' },
    ],
  },
  {
    id: 'purchase-credit',
    label: '원재료 매입 (외상)',
    memo: '원재료 매입 — 외상',
    lines: [
      { side: 'debit', code: '4510' },
      { side: 'credit', code: '2010' },
    ],
  },
  {
    id: 'payroll',
    label: '급여 지급',
    memo: '급여 지급',
    lines: [
      { side: 'debit', code: '8010' },
      { side: 'credit', code: '1030' },
    ],
  },
]
