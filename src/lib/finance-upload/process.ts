import type { ChairmanRepository } from '@/lib/repository'
import type { Account, FinRow, FinTxGroupSaveInput, FinUpload } from '@/types'

import { cellText, EMPTY_CELL, type EcountCell } from '@/lib/ecount/excel/cells'
import type { EcountSheet } from '@/lib/ecount/excel/workbook'

import { countNewSuspects, describeGroup, matchTx, rejectedPairs, txLinesFromRows } from './dedupe'
import { looksOfficial, refuseAfterRead, refuseDoc, refuseFormula, type DocRefusal } from './doc-guard'
import { DocOpenError, openDocument, type DocFormat, type OpenedDoc } from './doc-open'
import {
  buildOfficialDraft,
  checkDocTotals,
  companyMismatch,
  docSheet,
  forcedDocReview,
  layoutToStatement,
  layoutToTable,
  numbersNotInText,
  type AiDocReader,
  type DocTable,
  type OfficialDraft,
} from './doc-read'
import { kindSpec, TX_KINDS, type UploadKind } from './kinds'
import { MSG, openUpload } from './open'
import {
  aiSample,
  autoDecision,
  classifyByCode,
  detectMonth,
  looksLikeMaterialIssue,
  mapColumns,
  mergeAi,
  readRows,
  scrubSheet,
  shapeSignature,
  stripKgGrid,
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
  /** official = 세무사 결산 → «공식 결산» 미리보기(자료 표에 안 넣음) · refused = 받지 않음(급여 · 제조지시 · 배합비 PDF · 사진) */
  status: 'applied' | 'needs_review' | 'failed' | 'duplicate' | 'official' | 'refused' | 'later'
  upload_id: string | null
  rows: number
  message: string
  why: string[]
  ai_used: number
  confidence: Confidence
  /** C단계 — 파일 형식(엑셀 · 글 PDF · 스캔 PDF · 사진) */
  format?: 'excel' | DocFormat
  /** 사진 바로 세우기 · 기울기 펴기 */
  fixes?: string[]
  /** status official의 미리보기 줄(계정 맞추기 · 부호 · 균형) — 저장은 사람이 «공식 결산»(0020 RPC)으로 */
  official?: OfficialDraft
}

/** C단계 PDF · 사진 설정 — 없으면(검사 · 옛 호출) PDF · 사진은 «준비 중». */
export interface DocOptions {
  /** 이 사람에게 PDF · 사진을 여는가(기능 스위치 «PDF · 사진 읽기» finance_docs — 0073, 기본 대표만) */
  allowed: boolean
  /** 읽기 도구(진짜 · 가짜 · 없음). 없거나 한도 0이면 AI 없이(글 PDF는 칸 위치로 미리보기 · 사진 · 스캔은 못 읽음) */
  read: AiDocReader | null
  /** 문서의 회사 이름 대조 */
  businessName?: string
  /** 공식 결산 계정 맞추기(그 회사 계정과목) */
  accounts?: Pick<Account, 'account_code' | 'name' | 'section'>[]
}

/** PDF · 사진에서 온 시트의 덧붙임(검증 · 미리보기 이유). */
interface DocContext {
  format: DocFormat
  table: DocTable
  /** AI가 읽었나(아니면 코드가 칸 위치로 세운 표) */
  byAi: boolean
  aiUsed: number
  headerRow: number
  extraErrors: string[]
  extraWarnings: string[]
  forceWhy: string[]
  fixes: string[]
}

export interface ProcessOptions {
  repo: ChairmanRepository
  businessId: string
  fileName: string
  bytes: Uint8Array
  classify: AiClassify | null
  /** 이 파일에 쓸 수 있는 AI 호출 수(파일 한도 · 하루 남은 한도 중 작은 것) */
  aiBudget: number
  /** 시험 · 화면이 정한 «오늘»(파일 이름의 «2월»에 해를 붙일 때 · 사진 · 스캔 처음 3개월) */
  today?: Date
  /** C단계 PDF · 사진 */
  docs?: DocOptions
}

/** PDF 글의 카드번호 16자리 — 뒤에 숫자가 붙어 읽혀도(칸이 겹친 PDF) 앞 16자리를 가린다. */
const CARD_IN_TEXT = /(?<!\d)(\d{4})[- ]?(\d{4})[- ]?(\d{4})[- ]?(\d{4})/g

const ERR_KO: Record<string, string> = {
  fin_upload_duplicate: '같은 파일을 이미 올렸습니다 — 늘지 않았습니다.',
  fin_upload_denied: '이 회사의 재무를 넣을 권한이 없습니다.',
  fin_upload_unavailable: '아직 준비 중입니다(0070 반영 전).',
  fin_upload_auto_blocked: '자동으로 넣지 못했습니다(겹침 · 마감 · 중복 의심) — 확인 필요로 다시 올려 주세요.',
  fin_valuation_final_exists: '그 구분의 확정된 평가금액이 이미 있습니다 — «재고 · 평가» 화면에서 이유를 적고 바꾸세요.',
  fin_value_state: '빈칸 · 0 표시가 맞지 않는 칸이 있습니다(빈칸은 0이 아닙니다).',
}

export function finUploadError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const k = Object.keys(ERR_KO).find((x) => m.includes(x))
  return k ? ERR_KO[k] : m.startsWith('fin_upload_') ? m : '처리하지 못했습니다.'
}

function refusedCard(fileName: string, r: DocRefusal, format?: FileCard['format']): FileCard {
  return { file_name: fileName, sheet: null, kind: 'unknown', period: null, status: 'refused', upload_id: null, rows: 0, message: r.message, why: [], ai_used: 0, confidence: 'none', format }
}

export async function processUpload(o: ProcessOptions): Promise<FileCard[]> {
  // 0. 배합비 · 구성표로 보이는 파일 — 이름만으로, 여는 것보다 먼저. 기록 줄도 남기지 않는다(저장 없음 · AI 없음).
  const formula = refuseFormula(o.fileName)
  if (formula) return [refusedCard(o.fileName, formula)]
  const opened = await openUpload(o.bytes, o.fileName)
  if (!opened.ok && (opened.format === 'pdf' || opened.format === 'image')) return processDoc(o, opened.format, opened.sha256)
  if (!opened.ok) return [await failRecord(o, opened.sha256, opened.message)]
  // 엑셀도 시트 이름 · 앞 8줄이 배합비 · 구성표면 통째로 받지 않는다(기록 없음).
  for (const sh of opened.sheets) {
    const head = [sh.name, ...sh.rows.slice(0, 8).map((r) => r.map(cellText).join(' '))].join(' ')
    const r = refuseFormula('', head)
    if (r) return [refusedCard(o.fileName, r, 'excel')]
  }
  return (await processSheets(o, opened.sha256, opened.sheets, null)).map((c) => ({ ...c, format: c.format ?? 'excel' }))
}

/** 실패 기록(진행 중에 남지 않는다 — failed는 바로 끝난 상태). 내용은 싣지 않는다. 기록이 실패해도 카드는 보여 준다. */
async function failRecord(
  o: ProcessOptions,
  sha: string,
  message: string,
  extra: { sheet?: string | null; aiUsed?: number; status?: 'failed' | 'refused' | 'later'; format?: FileCard['format'] } = {},
): Promise<FileCard> {
  const id = await o.repo
    .finUploadRecord({ business_id: o.businessId, kind: 'unknown', period: null, file_name: o.fileName, file_sha256: sha, sheet_name: extra.sheet ?? null, ai_confidence: 'none', ai_used: extra.aiUsed ?? 0, status: 'failed', pending: null, error: message.slice(0, 500) })
    .catch(() => null)
  return { file_name: o.fileName, sheet: extra.sheet ?? null, kind: 'unknown', period: null, status: extra.status ?? 'failed', upload_id: id, rows: 0, message, why: [], ai_used: extra.aiUsed ?? 0, confidence: 'none', format: extra.format }
}

/** 공식 결산 갈래의 fin_uploads 기록 문구(내용 없음 — AI 사용 수를 하루 한도에 세려고 남긴다). 화면이 이 앞머리로 알아본다. */
export const OFFICIAL_RECORD_NOTE = '공식 결산으로 보냄 — 자료 표에 넣지 않음(사람이 확인하고 «공식 결산»으로 저장)'

/**
 * C단계 — PDF · 사진 한 장. 열기(코드) → 막기(코드, AI 전) → 공식 결산 갈래 → 읽기(AI JSON · 한도) → 표를 시트로 → 0070 길.
 * AI는 표 JSON만 돌려준다. 넣기 판단 · 검증은 전부 코드이고, 넣기는 사람 세션의 RPC다.
 */
async function processDoc(o: ProcessOptions, kind: 'pdf' | 'image', sha: string): Promise<FileCard[]> {
  const fmt0: FileCard['format'] = kind === 'image' ? 'image' : 'pdf_text'
  // 6. 입구 스위치가 꺼진 사람(직원) — PDF · 사진은 준비 중(엑셀은 그대로).
  if (!o.docs?.allowed) return [await failRecord(o, sha, MSG.pdfLater, { format: fmt0, status: 'later' })]
  let doc: OpenedDoc
  try {
    doc = await openDocument(o.bytes, kind)
  } catch (e) {
    return [await failRecord(o, sha, e instanceof DocOpenError ? e.message : MSG.broken, { format: fmt0 })]
  }
  // 4. 막기 — AI 전, 이름 + 글(스캔 · 사진은 이름만). 배합비 · 구성표는 기록도 없다.
  const refusal = refuseDoc(o.fileName, doc.guardText)
  if (refusal) return [refusal.record ? await failRecord(o, sha, refusal.message, { status: 'refused', format: doc.format }) : refusedCard(o.fileName, refusal, doc.format)]
  const official = looksOfficial(o.fileName, doc.guardText)
  // 2. 읽기 — 한 파일 = AI 한 번. 글 PDF는 카드번호를 가린 글만 보낸다.
  const reader = o.docs.read
  let table: DocTable | null = null
  let aiUsed = 0
  let aiNote: string | null = null
  if (reader && o.aiBudget > 0) {
    aiUsed = 1
    try {
      const text = doc.text.replace(CARD_IN_TEXT, (_m, _a, _b, _c, d) => `****-****-****-${d}`)
      const layout = doc.layout?.map((l) => l.map((c) => ({ ...c, t: c.t.replace(CARD_IN_TEXT, (_m, _a, _b, _c, d) => `****-****-****-${d}`) })))
      table = await reader({ fileName: o.fileName, format: doc.format, text, layout, media: doc.media, expect: official ? 'official' : 'table' })
    } catch (e) {
      aiNote = `AI 읽기 실패(${e instanceof Error ? e.message.slice(0, 60) : '?'})`
    }
  } else {
    aiNote = reader ? 'AI 한도(파일당 · 하루)를 넘었습니다' : 'AI가 꺼져 있습니다(한도 미설정 · 연결 없음)'
  }
  if (table) {
    const after = refuseAfterRead(table.doc_kind)
    if (after) return [await failRecord(o, sha, after.message, { status: 'refused', aiUsed, format: doc.format })]
  }
  // 5. 세무사 확정 결산 → «공식 결산» 미리보기(자료 표에 안 넣음 · 자동 없음). 기록은 실패 줄(내용 없음 — AI 사용 수를 하루 한도에 센다).
  if (official || table?.doc_kind === 'official_statement') {
    const t = table ?? (doc.layout ? layoutToStatement(doc.layout) : null)
    const draft = t ? buildOfficialDraft(t, o.docs.accounts ?? [], o.fileName) : null
    if (draft && table && doc.format === 'pdf_text') {
      const miss = numbersNotInText(table, doc.text)
      if (miss) draft.warnings.push(`AI가 읽은 숫자 ${miss}개가 PDF 글에 없습니다 — 줄마다 확인하세요.`)
    }
    if (draft && aiNote) draft.warnings.push(`${aiNote} — AI 없이 글 줄에서 읽었습니다.`)
    const rec = await failRecord(o, sha, OFFICIAL_RECORD_NOTE, { aiUsed, format: doc.format })
    return [
      {
        ...rec,
        status: 'official',
        message: draft?.lines.length
          ? '세무사 확정 결산으로 보입니다 — 자료 표가 아니라 «공식 결산»으로 갑니다. 아래에서 계정 · 금액을 확인하고 증빙 링크와 함께 저장하세요(자동으로 넣지 않습니다).'
          : `세무사 확정 결산으로 보이지만 읽지 못했습니다${aiNote ? `(${aiNote})` : ''} — «공식 결산» 화면에서 손으로 넣어 주세요.`,
        official: draft ?? undefined,
        fixes: doc.fixes,
      },
    ]
  }
  if (!table) {
    if (!doc.layout) {
      return [await failRecord(o, sha, `${aiNote ?? 'AI 없음'} — 사진 · 스캔 PDF는 AI 없이 읽지 못합니다. 저장하지 않았습니다 — 내일 다시 올리거나 엑셀로 올려 주세요.`, { aiUsed, format: doc.format })]
    }
    table = layoutToTable(doc.layout)
  }
  if (!table.rows.length && !table.columns.length) {
    return [await failRecord(o, sha, `표를 읽지 못했습니다(${table.reason.slice(0, 120)}) — 엑셀로 올려 주세요.`, { aiUsed, format: doc.format })]
  }
  // 3. 검증(코드) — 합계 · 소계 = 줄의 합 · 글 PDF는 AI 숫자가 글에 있는가 · 회사 이름.
  const extraErrors = checkDocTotals(table)
  const byAi = aiUsed > 0 && !aiNote
  if (byAi && doc.format === 'pdf_text') {
    const miss = numbersNotInText(table, doc.text)
    if (miss) extraErrors.push(`AI가 읽은 숫자 ${miss}개가 PDF 글에 없습니다 — 사람이 봅니다.`)
  }
  const extraWarnings = o.docs.businessName && companyMismatch(table.company, o.docs.businessName) ? [`문서의 회사 이름 «${table.company}»이 이 회사와 다릅니다.`] : []
  const forceWhy = [forcedDocReview(doc.format, o.today), aiNote ? `${aiNote} — AI 없이 칸 위치로 세운 표라 사람이 봅니다.` : null].filter((x): x is string => !!x)
  const name = doc.format === 'image' ? '사진' : doc.format === 'pdf_scan' ? `스캔 PDF ${doc.pages}쪽` : `PDF ${doc.pages}쪽`
  const { sheet, headerRow } = docSheet(table, name)
  const ctx: DocContext = { format: doc.format, table, byAi, aiUsed, headerRow, extraErrors, extraWarnings, forceWhy, fixes: doc.fixes }
  return (await processSheets(o, sha, [sheet], ctx)).map((c) => ({ ...c, format: doc.format, fixes: doc.fixes }))
}

/** 시트들 → 카드(0070 길 — 엑셀 · PDF · 사진 공통). doc이 있으면 AI 표의 판단 · 검증 · 미리보기 이유를 더한다. */
async function processSheets(o: ProcessOptions, sha: string, sheets: EcountSheet[], doc: DocContext | null): Promise<FileCard[]> {
  const opened = { sha256: sha, sheets }
  const fail = (message: string, sheet: string | null = null) => failRecord(o, sha, message, { sheet, aiUsed: doc?.aiUsed ?? 0 })

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
    // 0072 구성표 노출 금지: 원료 출고명세(로 보이는) 시트는 AI에 보내지 않는다 — 코드 분류만.
    const noAi = cls.kind === 'material_issue' || looksLikeMaterialIssue(sheet)
    if (doc) {
      // C단계: AI가 이미 표를 읽었다(종류 판단 포함) — 코드 판단과 합친다(같으면 높음). AI가 아니면 코드 판단만.
      aiUsed = doc.aiUsed
      if (doc.byAi) {
        const t = doc.table
        cls = mergeAi(cls, { kind: t.doc_kind, confidence: t.confidence, header_row: doc.headerRow, columns: {}, reason: t.reason }, sheet.colCount)
      }
      if (cls.kind === 'material_issue') cls = { ...cls, kind: 'unknown', confidence: 'none', reason: '원료 출고명세는 엑셀로만 받습니다' }
    } else if (learned) {
      cls = { kind: learned.kind as UploadKind, confidence: 'high', headerRow: cls.headerRow, columns: learned.column_map, reason: '지난번에 사람이 고른 종류 · 칸(학습)', source: 'learned' }
    } else if (cls.confidence !== 'high' && noAi) {
      cls = { ...cls, reason: `${cls.reason} · 출고명세로 보이는 시트라 AI에 보내지 않음(코드 분류만)` }
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
    if (doc) {
      check.errors = [...new Set([...check.errors, ...doc.extraErrors])]
      check.warnings = [...new Set([...check.warnings, ...doc.extraWarnings])]
    }
    // 같은 파일(해시 · 종류 · 기간)이 이미 살아 있으면 늘리지 않는다 — 겹침보다 먼저(0070 fin_uploads_same_file과 같은 판정).
    if (uploads.some((u) => u.kind === cls.kind && u.period === month.period && u.file_sha256 === opened.sha256 && (u.status === 'applied' || u.status === 'needs_review'))) {
      cards.push({ file_name: o.fileName, sheet: sheet.name, kind: cls.kind, period: month.period, status: 'duplicate', upload_id: null, rows: 0, message: ERR_KO.fin_upload_duplicate, why: [], ai_used: aiUsed, confidence: cls.confidence })
      continue
    }
    const overlap = !!month.period && uploads.some((u) => u.kind === cls.kind && u.period === month.period && u.status === 'applied')
    const closed = month.period ? await o.repo.finMonthClosed(o.businessId, month.period).catch(() => false) : false
    // 0072 다섯째 조건 — 다른 자료의 살아 있는 줄과 «같은 거래 의심»(순수 함수). 세지 못하면 null(자동 아님).
    const dup = await countDupSuspects(o.repo, o.businessId, cls.kind, month.period, read.rows as FinRow[])
    const decision0 = autoDecision({ confidence: cls.confidence, check, overlap, closed, dupSuspects: dup.count })
    // C단계: 사진 · 스캔 처음 3개월 · AI 없이 세운 표는 다섯 조건을 넘어도 미리보기.
    const decision = doc?.forceWhy.length ? { auto: false, why: [...decision0.why, ...doc.forceWhy] } : decision0
    const header = (sheet.rows[cls.headerRow] ?? []).map((c) => cellText(c).slice(0, 40))
    const meta = { reason: cls.reason, period_how: month.how, errors: check.errors, warnings: check.warnings, why_not_auto: decision.why, columns: cls.columns, header_row: cls.headerRow, header, sig, dropped, dup_suspects: dup.count, dup_notes: dup.notes, ...(doc ? { source_format: doc.format, fixes: doc.fixes } : {}) }
    const confidenceDb = cls.confidence
    const base = { file_name: o.fileName, sheet: sheet.name, kind: cls.kind, period: month.period, ai_used: aiUsed, confidence: cls.confidence }
    try {
      if (decision.auto && month.period) {
        const id = await o.repo.finUploadApply({
          business_id: o.businessId, kind: cls.kind, period: month.period, file_name: o.fileName, file_sha256: opened.sha256, sheet_name: sheet.name,
          ai_confidence: confidenceDb, ai_used: aiUsed, auto: true, rows: read.rows as FinRow[], people: cls.kind === 'payroll' ? (read.people as FinRow[]) : null,
          overlap: 'none', reason: null, upload_id: null, dup_suspects: dup.count ?? 0,
        })
        // 같은 거래(same) 묶음 저장 — 원천 줄은 고치지 않는다. 실패해도 넣기는 그대로(묶음은 화면에서 다시 맞춘다).
        await saveTxGroupsFor(o.repo, o.businessId, cls.kind, month.period, id, null).catch((e) => console.error('[finance-upload] tx groups', e))
        cards.push({ ...base, status: 'applied', upload_id: id, rows: read.rows.length, message: `자동으로 넣었습니다 — ${read.rows.length}줄. 7일 안에 되돌릴 수 있습니다.`, why: [] })
      } else {
        const id = await o.repo.finUploadRecord({
          business_id: o.businessId, kind: cls.kind, period: month.period, file_name: o.fileName, file_sha256: opened.sha256, sheet_name: sheet.name,
          ai_confidence: confidenceDb, ai_used: aiUsed, status: 'needs_review',
          // 0072 리뷰 C1: 출고명세는 칸 격자의 kg · 수량 칸을 기록 전에 비운다(대기 줄의 kg는 DB가 넣을 때만 쓰고 아무에게도 돌려주지 않는다).
          pending: { rows: read.rows as FinRow[], people: cls.kind === 'payroll' ? (read.people as FinRow[]) : undefined, grid: cls.kind === 'material_issue' ? stripKgGrid(toGrid(sheet), cls.headerRow, true).grid : toGrid(sheet), meta },
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
        // 0072 리뷰 C1 남은 일: «모름» 대기의 칸 격자에서 kg 칸을 비운다(출고명세로 보이면 수량 칸까지).
        pending: { rows: [], grid: stripKgGrid(toGrid(u.sheet), u.cls.headerRow, looksLikeMaterialIssue(u.sheet)).grid, meta: { reason: u.cls.reason, header_row: u.cls.headerRow, header, sig: u.sig, columns: {}, ...(doc ? { source_format: doc.format, fixes: doc.fixes, why_not_auto: doc.forceWhy, errors: doc.extraErrors } : {}) } },
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

/** 넣은 지 7일 안이라 되돌릴 수 있는 올리기(0070 fin_upload_revert와 같은 기준 — 판정은 DB). */
export function revertableIds(uploads: FinUpload[], now = Date.now()): string[] {
  return uploads.filter((u) => u.status === 'applied' && !!u.applied_at && Date.parse(u.applied_at) > now - 7 * 86_400_000).map((u) => u.upload_id)
}

/**
 * 0072 다섯째 조건 — 이 파일의 줄이 다른 자료(판매 · 입고 · 세금계산서 · 원장)의 살아 있는 줄과 «같은 거래 의심»인 묶음 수.
 * 맞추기 종류가 아니면 0. 읽기가 실패하면 null(자동 아님).
 */
export async function countDupSuspects(repo: ChairmanRepository, businessId: string, kind: UploadKind, period: string | null, rows: FinRow[]): Promise<{ count: number | null; notes: string[] }> {
  if (!TX_KINDS.includes(kind)) return { count: 0, notes: [] }
  if (!period) return { count: null, notes: [] }
  try {
    const [existing, setting, saved] = await Promise.all([repo.listFinTxLines(businessId, period), repo.finDedupeSetting(businessId), repo.listFinTxGroups(businessId, period)])
    const groups = matchTx([...existing, ...txLinesFromRows(kind, rows)], setting, rejectedPairs(saved))
    const mine = groups.filter((g) => g.status === 'suspect' && g.refs.some((r) => r.startsWith('new:')))
    return { count: countNewSuspects(groups), notes: mine.slice(0, 10).map((g) => `${g.refs.filter((r) => r.startsWith('new:')).map((r) => r.slice(4) + '행').join(' · ')} — ${describeGroup(g)}`) }
  } catch (e) {
    console.error('[finance-upload] dup count', e)
    return { count: null, notes: [] }
  }
}

/**
 * 넣은 뒤 — 이 올리기의 줄이 든 묶음(same · suspect)을 저장한다(fin_tx_group_save). 이미 묶인 줄은 다시 묶지 않는다.
 * 원천 줄은 고치지 않는다. 돌려주는 값: 저장한 묶음 수.
 */
export async function saveTxGroupsFor(repo: ChairmanRepository, businessId: string, kind: string, period: string | null, uploadId: string, reason: string | null): Promise<number> {
  if (!period || !(TX_KINDS as readonly string[]).includes(kind)) return 0
  const [lines, setting, saved] = await Promise.all([repo.listFinTxLines(businessId, period), repo.finDedupeSetting(businessId), repo.listFinTxGroups(businessId, period)])
  const mineRefs = new Set(lines.filter((l) => l.upload_id === uploadId).map((l) => l.ref))
  let n = 0
  for (const g of matchTx(lines, setting, rejectedPairs(saved))) {
    if (!g.refs.some((r) => mineRefs.has(r))) continue
    await repo.finTxGroupSave({
      business_id: businessId,
      period,
      status: g.status,
      members: g.refs.map((r) => ({ source_table: r.slice(0, r.indexOf(':')) as FinTxGroupSaveInput['members'][number]['source_table'], line_id: Number(r.slice(r.indexOf(':') + 1)) })),
      evidence: g.evidence,
      amount_base_ref: g.amount_base_ref,
      qty_base_ref: g.qty_base_ref,
      reason,
    })
    n += 1
  }
  return n
}
