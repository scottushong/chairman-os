import { splitStats, type ReadStats } from '@/lib/finance-upload/read-stats'
import type { FinUpload } from '@/types'

/**
 * 이번 달 자료 18가지(대표 확인 시안 2026-10-19 — 순서 · 이름 그대로). 앞 열넷과 재공품 · 완제품 평가 · 출하집계표는 자료 올리기 종류,
 * 계정과목표 · 월별 손익계산서는 장부 쪽(ECOUNT 양식 — 0050 업로드)으로 저장된다. 원장 거래 줄 · 세금계산서 · 원료 출고 · 공식 결산은
 * 받지만 이 표의 열여덟에는 세지 않는다(«그 밖에 받은 것»).
 */
export const CHECKLIST: readonly { key: string; label: string }[] = [
  { key: 'sales', label: '판매현황' },
  { key: 'purchase_in', label: '입고명세서' },
  { key: 'inventory', label: '재고금액명세서' },
  { key: 'production', label: '제조지시명세서' },
  { key: 'ledger', label: '계정별 원장' },
  { key: 'payroll', label: '급여대장' },
  { key: 'import', label: '수입 거래목록' },
  { key: 'cashflow', label: '월별 자금흐름표' },
  { key: 'card', label: '법인카드 사용내역' },
  { key: 'overseas', label: '베트남 법인 운영비' },
  { key: 'promo', label: '해외 판촉비' },
  { key: 'loans', label: '대출현황' },
  { key: 'borrowings', label: '차입금' },
  { key: 'savings', label: '절감목표 · 진행' },
  { key: 'accounts', label: '계정과목표' },
  { key: 'pl_monthly', label: '월별 손익계산서' },
  { key: 'valuation', label: '재공품 · 완제품 평가' },
  { key: 'shipment', label: '출하집계표' },
]

/** (지운 2026-10-20) «월별 입력(CH-026)» 손입력이 장부에 넣은 전표의 적요 — «YYYY-MM 월별 간이 손익». 체크표 «월별 손익계산서»가 ECOUNT 전표와 함께 센다. */
export const MONTHLY_MEMO = /^(\d{4}-(?:0[1-9]|1[0-2])) 월별 간이 손익$/

export interface ChecklistItem {
  key: string
  label: string
  state: 'ok' | 'warn' | 'missing'
  warnings: string[]
  /** 받은 시각(ISO) */
  at: string | null
  /** 0091 체크표 «빼기» — 그 칸을 채운 올리기(파일). 장부 쪽(계정과목표 · 월별 손익) · 화면 입력 평가는 없음. */
  uploadId?: string | null
  fileName?: string | null
  /** 0093 그 파일의 «읽은 줄 N · 비운 칸 M»(0093 전 올리기는 null) */
  stats?: ReadStats | null
}

export interface ChecklistInput {
  period: string
  uploads: FinUpload[]
  /** 계정과목표가 있는가(자동 생성만이면 'auto') */
  accounts: 'file' | 'auto' | 'none'
  accountsAt: string | null
  /** 그 달 월별 손익(ECOUNT 업로드 전표)이 있는가 */
  plMonthlyAt: string | null
  /** 재공품 · 완제품 평가금액이 그 달에 있는가(올리기 · 화면 입력) */
  valuationAt: string | null
}

export function buildChecklist(x: ChecklistInput): ChecklistItem[] {
  return CHECKLIST.map(({ key, label }) => {
    if (key === 'accounts') {
      // 자동 생성 계정(원장이 만든 것)만 있으면 계정과목표는 아직 받지 않은 것 — «자료 N/18»에 세지 않는다(2026-10-22).
      return { key, label, state: x.accounts === 'file' ? 'ok' : 'missing', warnings: x.accounts === 'auto' ? ['자동 생성 계정만 있음 — 계정과목표를 올리면 덮어씁니다'] : [], at: x.accounts === 'file' ? x.accountsAt : null }
    }
    if (key === 'pl_monthly') return { key, label, state: x.plMonthlyAt ? 'ok' : 'missing', warnings: [], at: x.plMonthlyAt }
    const u = x.uploads.filter((v) => v.kind === key && v.period === x.period && v.status === 'applied').sort((a, b) => (b.applied_at ?? '').localeCompare(a.applied_at ?? ''))[0]
    if (key === 'valuation' && !u && x.valuationAt) return { key, label, state: 'ok', warnings: [], at: x.valuationAt }
    if (!u) return { key, label, state: 'missing', warnings: [], at: null }
    const { stats, warnings: w } = splitStats(u.warnings)
    return { key, label, state: w.length ? 'warn' : 'ok', warnings: w, at: u.applied_at, uploadId: u.upload_id, fileName: u.file_name, stats }
  })
}

/** «⚠ 계정별 원장 (합계 차이 2건)»의 괄호 — 경고 문구에서 짧게. */
export function warnShort(w: string[]): string {
  if (!w.length) return ''
  const sum = w.filter((x) => /합계/.test(x)).length
  if (sum) return `합계 차이 ${sum}건`
  if (w.some((x) => x.startsWith('꼭 있어야 하는 칸이 빈 줄'))) return '꼭 있어야 하는 칸 빔'
  const dup = w.find((x) => /중복 의심/.test(x))
  if (dup) return '중복 의심'
  return `경고 ${w.length}`
}
