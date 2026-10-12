import type { ChairmanRepository } from '@/lib/repository'
import type { FinRow, FinUpload } from '@/types'

import { cellText, EMPTY_CELL, type EcountCell } from '@/lib/ecount/excel/cells'
import type { EcountSheet } from '@/lib/ecount/excel/workbook'

import { kindSpec, type UploadKind } from './kinds'
import { openUpload } from './open'
import {
  aiSample,
  autoDecision,
  classifyByCode,
  detectMonth,
  mapColumns,
  mergeAi,
  readRows,
  scrubSheet,
  shapeSignature,
  validate,
  type Classification,
  type Confidence,
} from './pipeline'

/**
 * 파일 한 장 → 시트마다 «넣었다(자동) · 확인 필요 · 실패» 카드. 서버 액션과 검사(check:finance-upload)가 같은 함수를 부른다.
 * AI는 classify 인자로만 들어온다(진짜 · 가짜 · 없음) — 이 파일은 AI를 모른다.
 */

export type AiClassify = (
  sample: { sheet: string; rows: string[][] },
  code: Classification,
) => Promise<{ kind: string; header_row: number; columns: Record<string, number>; confidence: Confidence; reason: string; cost_usd?: number }>

export interface FileCard {
  file_name: string
  sheet: string | null
  kind: UploadKind | 'unknown'
  period: string | null
  status: 'applied' | 'needs_review' | 'failed' | 'duplicate'
  upload_id: string | null
  rows: number
  message: string
  why: string[]
  ai_used: number
  confidence: Confidence
}

export interface ProcessOptions {
  repo: ChairmanRepository
  businessId: string
  fileName: string
  bytes: Uint8Array
  classify: AiClassify | null
  /** 이 파일에 쓸 수 있는 AI 호출 수(파일 한도 · 하루 남은 한도 중 작은 것) */
  aiBudget: number
  /** 시험 · 화면이 정한 «오늘»(파일 이름의 «2월»에 해를 붙일 때) */
  today?: Date
}

const ERR_KO: Record<string, string> = {
  fin_upload_duplicate: '같은 파일을 이미 올렸습니다 — 늘지 않았습니다.',
  fin_upload_denied: '이 회사의 재무를 넣을 권한이 없습니다.',
  fin_upload_unavailable: '아직 준비 중입니다(0070 반영 전).',
}

export function finUploadError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const k = Object.keys(ERR_KO).find((x) => m.includes(x))
  return k ? ERR_KO[k] : m.startsWith('fin_upload_') ? m : '처리하지 못했습니다.'
}

export async function processUpload(o: ProcessOptions): Promise<FileCard[]> {
  const opened = await openUpload(o.bytes, o.fileName)
  const fail = async (message: string, sheet: string | null = null): Promise<FileCard> => {
    // 실패는 기록만(진행 중에 남지 않는다 — failed는 바로 끝난 상태). 기록이 실패해도 카드는 보여 준다.
    const id = await o.repo
      .finUploadRecord({ business_id: o.businessId, kind: 'unknown', period: null, file_name: o.fileName, file_sha256: opened.sha256, sheet_name: sheet, ai_confidence: 'none', ai_used: 0, status: 'failed', pending: null, error: message.slice(0, 500) })
      .catch(() => null)
    return { file_name: o.fileName, sheet, kind: 'unknown', period: null, status: 'failed', upload_id: id, rows: 0, message, why: [], ai_used: 0, confidence: 'none' }
  }
  if (!opened.ok) return [await fail(opened.message)]

  const [shapes, uploads] = await Promise.all([o.repo.listFinUploadShapes(o.businessId).catch(() => []), o.repo.listFinUploads(o.businessId).catch(() => [] as FinUpload[])])
  let budget = o.aiBudget
  const cards: FileCard[] = []
  const unknown: { sheet: EcountSheet; aiUsed: number; cls: Classification; sig: string }[] = []
  for (const raw of opened.sheets) {
    if (raw.rows.every((r) => r.every((c) => c.t === 'empty'))) continue
    const { sheet, dropped } = scrubSheet(raw)
    // c. 분류: 학습 → 코드 → (모자라면) AI
    let cls = classifyByCode(sheet)
    const sig = shapeSignature(o.businessId, sheet, cls.headerRow)
    const learned = shapes.find((s) => s.header_sig === sig)
    let aiUsed = 0
    if (learned) {
      cls = { kind: learned.kind as UploadKind, confidence: 'high', headerRow: cls.headerRow, columns: learned.column_map, reason: '지난번에 사람이 고른 종류 · 칸(학습)', source: 'learned' }
    } else if (cls.confidence !== 'high' && o.classify && budget > 0) {
      const sample = aiSample(sheet, cls.headerRow)
      const start = Math.max(0, cls.headerRow - 3)
      try {
        const ai = await o.classify(sample, cls)
        aiUsed = 1
        budget -= 1
        cls = mergeAi(cls, { ...ai, header_row: ai.header_row + start }, sheet.colCount)
      } catch (e) {
        aiUsed = 1
        budget -= 1
        cls = { ...cls, confidence: cls.confidence === 'high' ? 'medium' : cls.confidence, reason: `${cls.reason} · AI 분류 실패(${e instanceof Error ? e.message.slice(0, 60) : '?'}) — 코드 판단만` }
      }
    } else if (cls.confidence !== 'high' && !o.classify) {
      cls = { ...cls, reason: `${cls.reason} · AI 분류 꺼짐(한도 · 연결 없음)` }
    }
    if (cls.kind === 'unknown') {
      // 모르는 시트 — 다른 시트에 아는 것이 있으면 접고(아래), 아무것도 모르면 사람이 고르게 미리보기로(칸 격자를 둔다).
      unknown.push({ sheet, aiUsed, cls, sig })
      continue
    }
    // d. 읽기 · 기간 · e. 검증
    if (Object.keys(cls.columns).length === 0) cls.columns = mapColumns(kindSpec(cls.kind), sheet.rows[cls.headerRow] ?? [])
    const read = readRows(sheet, cls)
    const month = detectMonth(sheet, read.dates, o.fileName, o.today)
    const check = validate(cls.kind, read, month.period)
    // 같은 파일(해시 · 종류 · 기간)이 이미 살아 있으면 늘리지 않는다 — 겹침보다 먼저(0070 fin_uploads_same_file과 같은 판정).
    if (uploads.some((u) => u.kind === cls.kind && u.period === month.period && u.file_sha256 === opened.sha256 && (u.status === 'applied' || u.status === 'needs_review'))) {
      cards.push({ file_name: o.fileName, sheet: sheet.name, kind: cls.kind, period: month.period, status: 'duplicate', upload_id: null, rows: 0, message: ERR_KO.fin_upload_duplicate, why: [], ai_used: aiUsed, confidence: cls.confidence })
      continue
    }
    const overlap = !!month.period && uploads.some((u) => u.kind === cls.kind && u.period === month.period && u.status === 'applied')
    const closed = month.period ? await o.repo.finMonthClosed(o.businessId, month.period).catch(() => false) : false
    const decision = autoDecision({ confidence: cls.confidence, check, overlap, closed })
    const header = (sheet.rows[cls.headerRow] ?? []).map((c) => cellText(c).slice(0, 40))
    const meta = { reason: cls.reason, period_how: month.how, errors: check.errors, warnings: check.warnings, why_not_auto: decision.why, columns: cls.columns, header_row: cls.headerRow, header, sig, dropped }
    const confidenceDb = cls.confidence
    const base = { file_name: o.fileName, sheet: sheet.name, kind: cls.kind, period: month.period, ai_used: aiUsed, confidence: cls.confidence }
    try {
      if (decision.auto && month.period) {
        const id = await o.repo.finUploadApply({
          business_id: o.businessId, kind: cls.kind, period: month.period, file_name: o.fileName, file_sha256: opened.sha256, sheet_name: sheet.name,
          ai_confidence: confidenceDb, ai_used: aiUsed, auto: true, rows: read.rows as FinRow[], people: cls.kind === 'payroll' ? (read.people as FinRow[]) : null,
          overlap: 'none', reason: null, upload_id: null,
        })
        cards.push({ ...base, status: 'applied', upload_id: id, rows: read.rows.length, message: `자동으로 넣었습니다 — ${read.rows.length}줄. 7일 안에 되돌릴 수 있습니다.`, why: [] })
      } else {
        const id = await o.repo.finUploadRecord({
          business_id: o.businessId, kind: cls.kind, period: month.period, file_name: o.fileName, file_sha256: opened.sha256, sheet_name: sheet.name,
          ai_confidence: confidenceDb, ai_used: aiUsed, status: 'needs_review',
          pending: { rows: read.rows as FinRow[], people: cls.kind === 'payroll' ? (read.people as FinRow[]) : undefined, grid: toGrid(sheet), meta },
          error: null,
        })
        cards.push({ ...base, status: 'needs_review', upload_id: id, rows: read.rows.length, message: '확인이 필요합니다 — 아래 미리보기에서 종류 · 칸 · 기간을 보고 넣으세요.', why: decision.why })
      }
    } catch (e) {
      const msg = finUploadError(e)
      cards.push({ ...base, status: msg === ERR_KO.fin_upload_duplicate ? 'duplicate' : 'failed', upload_id: null, rows: 0, message: msg, why: [] })
    }
  }
  // 아는 시트가 하나도 없으면 «모름» 시트를 사람이 고르게 미리보기로 남긴다(첫 시트 하나 — 표지 · 메모 시트가 흔하다).
  if (!cards.length && unknown.length) {
    const u = unknown.sort((a, b) => b.sheet.rows.length - a.sheet.rows.length)[0]
    try {
      const header = (u.sheet.rows[u.cls.headerRow] ?? []).map((c) => cellText(c).slice(0, 40))
      const id = await o.repo.finUploadRecord({
        business_id: o.businessId, kind: 'unknown', period: null, file_name: o.fileName, file_sha256: opened.sha256, sheet_name: u.sheet.name,
        ai_confidence: u.cls.confidence, ai_used: u.aiUsed, status: 'needs_review',
        pending: { rows: [], grid: toGrid(u.sheet), meta: { reason: u.cls.reason, header_row: u.cls.headerRow, header, sig: u.sig, columns: {} } },
        error: null,
      })
      cards.push({ file_name: o.fileName, sheet: u.sheet.name, kind: 'unknown', period: null, status: 'needs_review', upload_id: id, rows: 0, message: `종류를 모릅니다 — 종류를 골라 주세요. (${u.cls.reason})`, why: [], ai_used: u.aiUsed, confidence: u.cls.confidence })
    } catch (e) {
      cards.push({ file_name: o.fileName, sheet: u.sheet.name, kind: 'unknown', period: null, status: 'failed', upload_id: null, rows: 0, message: finUploadError(e), why: [], ai_used: u.aiUsed, confidence: 'none' })
    }
  }
  if (!cards.length) return [await fail('빈 파일입니다(채워진 시트가 없습니다).')]
  return cards
}

/** 버리기 뒤 시트 → 칸 격자(pending.grid). 3,000줄 · 40칸까지. */
export function toGrid(sheet: EcountSheet): (string | number | null)[][] {
  return sheet.rows.slice(0, 3000).map((r) => r.slice(0, 40).map((c) => (c.t === 'number' ? c.v : c.t === 'empty' || c.t === 'error' ? null : c.v.slice(0, 200))))
}

/** 칸 격자 → 시트(사람이 종류 · 칸을 고른 뒤 다시 읽을 때). */
export function fromGrid(name: string, grid: (string | number | null)[][]): EcountSheet {
  const colCount = Math.min(40, Math.max(0, ...grid.map((r) => r.length)))
  const rows: EcountCell[][] = grid.map((r) => {
    const out: EcountCell[] = new Array(colCount).fill(EMPTY_CELL)
    r.forEach((v, i) => {
      if (i >= colCount) return
      if (typeof v === 'number' && Number.isFinite(v)) out[i] = { t: 'number', v }
      else if (typeof v === 'string' && v.trim()) out[i] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? { t: 'date', v } : { t: 'text', v }
    })
    return out
  })
  return { name, rows, colCount }
}
