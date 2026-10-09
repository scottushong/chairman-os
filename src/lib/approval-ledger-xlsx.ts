// scripts/check-approval-ledger.ts가 이 파일을 바로 import한다 — 런타임 import는 상대 경로로 둔다.
import ExcelJS from 'exceljs'

import { LEDGER_GRAIN_LABEL, type LedgerFilters, type LedgerGroup, type LedgerHistoryLine, type LedgerRow, type LedgerTotals } from './approval-ledger'
import type { ApprovalTemplate } from '@/types'

/**
 * 0059 결재 대장 엑셀 — 세 장.
 *   목록         결재 한 건 = 한 줄. 대장 표의 칸 + 양식 항목 전부를 칸으로 편다(항목 이름 = label_ko).
 *   묶음 합계    월 · (고른 단위) · 양식 · 구입처 · 팀별 건수와 금액, 맨 위에 전체.
 *   결재선 이력  단계 한 칸 = 한 줄.
 *
 * 금액은 숫자 칸(서식 '#,##0'), 날짜는 진짜 엑셀 날짜(서식 'yyyy-mm-dd')다 — 글자로 넣으면 경영지원이
 * 엑셀에서 다시 더하거나 거를 때 한 번 더 손을 대야 한다.
 *
 * 줄은 화면과 같은 함수(approval-ledger.ts)가 거른 것만 받는다. 이 파일은 그리기만 한다.
 */

export const MONEY_FMT = '#,##0'
export const DATE_FMT = 'yyyy-mm-dd'
export const DATETIME_FMT = 'yyyy-mm-dd hh:mm'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 'yyyy-mm-dd' → 엑셀 날짜(UTC 자정 — exceljs는 Date를 UTC 기준 일련값으로 적는다). */
function dayCell(day: string): Date | null {
  return day ? new Date(`${day}T00:00:00Z`) : null
}

/** ISO 시각 → 서울 벽시계 시각의 엑셀 날짜. 엑셀에는 시간대가 없어 보이는 그대로(KST)를 적는다. */
function kstCell(iso: string | null): Date | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + KST_OFFSET_MS) : null
}

/** 양식 항목 칸 — 들어 있는 양식들의 항목 합집합. 양식 sort_order → 항목 순서. 같은 key는 한 칸. */
export function formColumns(rows: LedgerRow[], templates: ApprovalTemplate[]): { key: string; label: string; money: boolean }[] {
  const present = new Set(rows.map((r) => r.template_key))
  const cols = new Map<string, { key: string; label: string; money: boolean }>()
  const labels = new Set<string>()
  const put = (key: string, label: string, money: boolean) => {
    cols.set(key, { key, label, money })
    labels.add(label)
  }
  for (const t of [...templates].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!present.has(t.template_key)) continue
    for (const f of t.fields) {
      if (cols.has(f.key)) continue
      // 다른 key가 같은 이름을 쓰면(양식마다 따로 지은 이름) key를 붙여 가른다.
      put(f.key, labels.has(f.label_ko) ? `${f.label_ko} (${f.key})` : f.label_ko, f.type === 'money')
    }
  }
  // 양식이 지금은 빼 버린 항목이 예전 결재에 남아 있으면 그 값도 버리지 않는다(key 그대로 칸 이름).
  for (const r of rows) {
    for (const k of Object.keys(r.form)) {
      if (!cols.has(k)) put(k, labels.has(k) ? `${k} (이전 항목)` : k, false)
    }
  }
  return [...cols.values()]
}

function moneyValue(raw: string | undefined): number | string | null {
  const s = raw?.trim()
  if (!s) return null
  const n = Number(s.replace(/[,\s원]/g, ''))
  return /^[\d,]+(\.\d+)?\s*원?$/.test(s) && Number.isFinite(n) ? n : s
}

function headerRow(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1)
  row.font = { bold: true }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F2F6' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

export interface LedgerWorkbookInput {
  rows: LedgerRow[]
  totals: LedgerTotals
  history: LedgerHistoryLine[]
  templates: ApprovalTemplate[]
  filters: LedgerFilters
  /** business_id → 회사 이름. */
  businessNames: Record<string, string>
}

export function buildLedgerWorkbook(input: LedgerWorkbookInput): ExcelJS.Workbook {
  const { rows, totals, history, templates, filters, businessNames } = input
  const wb = new ExcelJS.Workbook()
  wb.creator = 'DY 그룹웨어'
  wb.created = new Date()

  /* 1. 목록 */
  const list = wb.addWorksheet('목록')
  const extra = formColumns(rows, templates)
  list.columns = [
    { header: '결재 번호', key: 'id', width: 14 },
    { header: '날짜', key: 'day', width: 12, style: { numFmt: DATE_FMT } },
    { header: '회사', key: 'company', width: 14 },
    { header: '양식', key: 'template', width: 8 },
    { header: '제목', key: 'title', width: 36 },
    { header: '올린 사람', key: 'requester', width: 12 },
    { header: '팀', key: 'team', width: 12 },
    { header: '금액', key: 'amount', width: 14, style: { numFmt: MONEY_FMT } },
    { header: '구입처', key: 'vendor', width: 16 },
    { header: '링크', key: 'link', width: 30 },
    { header: '상태', key: 'status', width: 10 },
    { header: '현재 결재자', key: 'approver', width: 12 },
    { header: '최종 처리일', key: 'decided', width: 12, style: { numFmt: DATE_FMT } },
    ...extra.map((c) => ({
      header: c.label,
      key: `f:${c.key}`,
      width: 16,
      ...(c.money ? { style: { numFmt: MONEY_FMT } } : {}),
    })),
  ]
  headerRow(list)
  for (const r of rows) {
    const values: Record<string, unknown> = {
      id: r.id,
      day: dayCell(r.day),
      company: businessNames[r.business_id] ?? r.business_id,
      template: r.template_name,
      title: r.title,
      requester: r.requester,
      team: r.team,
      amount: r.amount,
      vendor: r.vendor,
      link: r.link ? { text: r.link, hyperlink: r.link } : null,
      status: r.status_label,
      approver: r.approver ?? '—',
      decided: dayCell(r.decided_day),
    }
    for (const c of extra) {
      const raw = r.form[c.key]
      values[`f:${c.key}`] = c.money ? moneyValue(raw) : (raw ?? null)
    }
    list.addRow(values)
  }

  /* 2. 묶음 합계 */
  const sums = wb.addWorksheet('묶음 합계')
  sums.columns = [
    { header: '묶음', key: 'group', width: 14 },
    { header: '항목', key: 'label', width: 24 },
    { header: '건수', key: 'count', width: 8 },
    { header: '금액', key: 'sum', width: 16, style: { numFmt: MONEY_FMT } },
  ]
  headerRow(sums)
  sums.addRow({ group: '전체', label: '합계', count: totals.count, sum: totals.sum }).font = { bold: true }
  const section = (name: string, groups: LedgerGroup[]) => {
    for (const g of groups) sums.addRow({ group: name, label: g.label, count: g.count, sum: g.sum })
  }
  section('월', totals.byMonth)
  if (filters.grain !== 'month') section(LEDGER_GRAIN_LABEL[filters.grain], totals.byPeriod)
  section('양식', totals.byTemplate)
  section('구입처', totals.byVendor)
  section('팀', totals.byTeam)

  /* 3. 결재선 이력 */
  const hist = wb.addWorksheet('결재선 이력')
  hist.columns = [
    { header: '결재 번호', key: 'id', width: 14 },
    { header: '제목', key: 'title', width: 36 },
    { header: '단계', key: 'seq', width: 6 },
    { header: '결재자', key: 'approver', width: 12 },
    { header: '이유', key: 'why', width: 30 },
    { header: '상태', key: 'status', width: 12 },
    { header: '처리 시각', key: 'at', width: 17, style: { numFmt: DATETIME_FMT } },
    { header: '의견', key: 'note', width: 30 },
  ]
  headerRow(hist)
  for (const h of history) {
    hist.addRow({
      id: h.id,
      title: h.title,
      seq: h.seq,
      approver: h.approver,
      why: h.why,
      status: h.status,
      at: kstCell(h.decided_at),
      note: h.note,
    })
  }

  return wb
}

/**
 * Content-Disposition — RFC 5987(filename*=UTF-8'')에 한글 이름, filename=에는 ASCII 대체 이름.
 * 대체 이름은 한글을 '_'로 바꾼 것이라 옛 브라우저에서도 .xlsx로는 받힌다.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
