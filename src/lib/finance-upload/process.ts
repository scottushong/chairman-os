import type { ChairmanRepository } from '@/lib/repository'
import type { Account, FinRow, FinTxGroupSaveInput, FinTxLine, FinUpload, FinUploadShape } from '@/types'

import { cellText, EMPTY_CELL, type EcountCell } from '@/lib/ecount/excel/cells'
import type { EcountSheet } from '@/lib/ecount/excel/workbook'

import { countNewSuspects, crossMonthPairs, describeGroup, matchTx, nearMonthEdge, neighborPeriods, rejectedPairs, txLinesFromRows, type CrossMonthPair } from './dedupe'
import { looksOfficial, refuseAfterRead, refuseDoc, refuseFormula, type DocRefusal } from './doc-guard'
import { DocOpenError, openDocument, type DocFormat, type OpenedDoc } from './doc-open'
import {
  applyOfficialSuggestions,
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
import { linesToAsk, type OfficialSuggester } from './official-suggest'
import { decodeShape, encodeShape, fixByBalance, LEDGER_COLS, ledgerFeedback, ledgerLayoutByCode, ROLE_KO, type LedgerCol, type LedgerLayout, type RowLabel } from './ledger'
import { MSG, openUpload } from './open'
import {
  aiSample,
  autoDecision,
  classifyByCode,
  detectMonth,
  ledgerLayoutOf,
  looksLikeMaterialIssue,
  mapColumns,
  mergeAi,
  readRows,
  scrubSheet,
  shapeSignature,
  stripKgGrid,
  validate,
  type Check,
  type Classification,
  type Confidence,
  type ReadResult,
} from './pipeline'

/**
 * 파일 한 장 → 시트마다 «넣었다(자동) · 확인 필요 · 실패» 카드. 서버 액션과 검사(check:finance-upload)가 같은 함수를 부른다.
 * AI는 classify 인자로만 들어온다(진짜 · 가짜 · 없음) — 이 파일은 AI를 모른다.
 */

/** AI 구조 해석의 답(ai.ts가 JSON을 이 모양으로 바꾼다). header_row는 시트 줄 번호(0부터). */
export interface AiStructure {
  kind: string
  header_row: number
  columns: Record<string, number>
  row_labels: RowLabel[]
  account_head_col: number | null
  company: string | null
  period: string | null
  confidence: Confidence
  reason: string
  cost_usd?: number
}

/** feedback = 앞 해석으로 대조했더니 틀린 계정 · 줄(숫자 없음) — 재해석 때만. */
export type AiClassify = (sample: { sheet: string; rows: string[][]; row_no?: number[] }, code: Classification, feedback?: string[]) => Promise<AiStructure>

/** 재해석 포함 한 시트에 쓰는 AI 호출 천장(처음 1 + 다시 2). 파일 한도(env)가 더 작으면 그것. */
export const AI_TRIES_PER_SHEET = 3

/** 0070 fin_upload_shapes가 받는 종류(0072 넷은 학습 표에 없다). */
const SHAPE_KINDS = new Set(['sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll', 'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings'])

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
  /** 조용히 버리지 않은 것의 안내 — «숨긴 시트 n개 건너뜀» · «읽지 않은 줄 n개» */
  notes?: string[]
  /** 같은 파일이 이미 «확인 필요»에 있으면 그 올리기 — 화면이 «이전 올리기를 다시 해석할까요?»를 묻는다 */
  reinterpret_id?: string
}

/** C단계 PDF · 사진 설정 — 없으면(검사 · 옛 호출) PDF · 사진은 «준비 중». */
export interface DocOptions {
  /** 이 사람에게 PDF · 사진을 여는가(기능 스위치 «PDF · 사진 읽기» finance_docs — 0073, 기본 대표만) */
  allowed: boolean
  /** 꺼진 까닭(화면 · 카드 문구) — 스위치(누구에게 열렸나)와 서버 설정(키 · 한도 없음)을 다른 말로 */
  closed?: { why: 'switch'; audience: string | null } | { why: 'env' } | null
  /** 읽기 도구(진짜 · 가짜 · 없음). 없거나 한도 0이면 AI 없이(글 PDF는 칸 위치로 미리보기 · 사진 · 스캔은 못 읽음) */
  read: AiDocReader | null
  /** 문서의 회사 이름 대조 */
  businessName?: string
  /** 공식 결산 계정 맞추기(그 회사 계정과목) */
  accounts?: Pick<Account, 'account_code' | 'name' | 'section'>[]
  /** 0083 계정 맞춤 학습 «묶음:이름» → 계정 코드 */
  learned?: ReadonlyMap<string, string>
  /** 공식 결산 계정 맞추기 2차(AI) — 없으면 코드 맞춤만 */
  suggest?: OfficialSuggester | null
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
  /** 이 요청이 끝나야 하는 시각(ms, maxDuration 300초 안) — 가까우면 AI를 새로 부르지 않고 코드 해석으로 끝낸다 */
  deadline?: number
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

/** 같은 파일이 이미 살아 있을 때의 카드 — «확인 필요»면 다시 해석할 올리기를 싣는다. */
export function sameFileCard(fileName: string, u: FinUpload): FileCard {
  const pending = u.status === 'needs_review'
  return {
    file_name: fileName, sheet: u.sheet_name, kind: (u.kind as UploadKind) ?? 'unknown', period: u.period, status: 'duplicate', upload_id: null, rows: 0, why: [], ai_used: 0, confidence: 'none',
    message: pending
      ? `같은 파일을 이미 올려 «확인 필요»에 있습니다(${u.created_at.slice(0, 16).replace('T', ' ')}) — 이전 올리기를 다시 해석할까요? 늘리지 않았습니다.`
      : `${ERR_KO.fin_upload_duplicate} 이미 넣은 파일입니다 — 다시 넣으려면 «최근 올리기»에서 되돌린 뒤 올려 주세요.`,
    ...(pending ? { reinterpret_id: u.upload_id } : {}),
  }
}

/** 읽기에서 넣지 않은 줄 · 해가 없는 날짜를 카드에 — 조용히 버리지 않는다. */
function readNotes(read: ReadResult): string[] | undefined {
  const n: string[] = []
  if (read.skipped) n.push(`읽지 않은 줄 ${read.skipped}개(제목 · 빈 이름 · 숫자 아닌 칸 — 아래 검증에 줄 번호)`)
  if (read.ledger?.unknownRows.length) n.push(`거래인지 요약인지 모르는 줄 ${read.ledger.unknownRows.length}개는 더하지 않음`)
  return n.length ? n : undefined
}

export async function processUpload(o: ProcessOptions): Promise<FileCard[]> {
  // 0. 배합비 · 구성표로 보이는 파일 — 이름만으로, 여는 것보다 먼저. 기록 줄도 남기지 않는다(저장 없음 · AI 없음).
  const formula = refuseFormula(o.fileName)
  if (formula) return [refusedCard(o.fileName, formula)]
  const opened = await openUpload(o.bytes, o.fileName)
  if (!opened.ok && (opened.format === 'pdf' || opened.format === 'image')) return processDoc(o, opened.format, opened.sha256)
  if (!opened.ok) return [await failRecord(o, opened.sha256, opened.message)]
  // 엑셀도 시트 이름 · 앞 8줄이 배합비 · 구성표면 통째로 받지 않는다(기록 없음). 숨긴 시트도 본다(숨겨도 내용은 같다).
  for (const sh of opened.sheets) {
    const head = [sh.name, ...sh.rows.slice(0, 8).map((r) => r.map(cellText).join(' '))].join(' ')
    const r = refuseFormula('', head)
    if (r) return [refusedCard(o.fileName, r, 'excel')]
  }
  // 숨긴 시트는 건너뛰고(계산용 · 옛 달이 흔하다) 카드에 수를 적는다. 다 숨겨져 있으면 그대로 읽는다.
  const shown = opened.sheets.filter((s) => !s.hidden)
  const hidden = shown.length ? opened.sheets.length - shown.length : 0
  const cards = await processSheets(o, opened.sha256, shown.length ? shown : opened.sheets, null)
  return cards.map((c) => ({ ...c, format: c.format ?? 'excel', notes: hidden ? [...(c.notes ?? []), `숨긴 시트 ${hidden}개 건너뜀`] : c.notes }))
}

/** 실패 기록(진행 중에 남지 않는다 — failed는 바로 끝난 상태). 내용은 싣지 않는다. 기록이 실패해도 카드는 보여 준다. */
async function failRecord(
  o: ProcessOptions,
  sha: string,
  message: string,
  extra: { sheet?: string | null; aiUsed?: number; status?: 'failed' | 'refused' | 'later'; format?: FileCard['format'] } = {},
): Promise<FileCard> {
  // 보류(later)도 DB에는 끝난 줄(failed)이다 — 기록 문구 앞머리 «보류 — »로 화면이 «실패»와 가른다(HOLD_PREFIX).
  const error = extra.status === 'later' ? `${HOLD_PREFIX}${message}` : message
  const id = await o.repo
    .finUploadRecord({ business_id: o.businessId, kind: 'unknown', period: null, file_name: o.fileName, file_sha256: sha, sheet_name: extra.sheet ?? null, ai_confidence: 'none', ai_used: extra.aiUsed ?? 0, status: 'failed', pending: null, error: error.slice(0, 500) })
    .catch(() => null)
  return { file_name: o.fileName, sheet: extra.sheet ?? null, kind: 'unknown', period: null, status: extra.status ?? 'failed', upload_id: id, rows: 0, message, why: [], ai_used: extra.aiUsed ?? 0, confidence: 'none', format: extra.format }
}

/** 보류 기록의 앞머리(화면 finance-upload-board.tsx가 같은 글로 «보류»를 그린다). */
export const HOLD_PREFIX = '보류 — '

/** 공식 결산 갈래의 fin_uploads 기록 문구(내용 없음 — AI 사용 수를 하루 한도에 세려고 남긴다). 화면이 이 앞머리로 알아본다. */
export const OFFICIAL_RECORD_NOTE = '공식 결산으로 보냄 — 자료 표에 넣지 않음(사람이 확인하고 «공식 결산»으로 저장)'

/**
 * C단계 — PDF · 사진 한 장. 열기(코드) → 막기(코드, AI 전) → 공식 결산 갈래 → 읽기(AI JSON · 한도) → 표를 시트로 → 0070 길.
 * AI는 표 JSON만 돌려준다. 넣기 판단 · 검증은 전부 코드이고, 넣기는 사람 세션의 RPC다.
 */
async function processDoc(o: ProcessOptions, kind: 'pdf' | 'image', sha: string): Promise<FileCard[]> {
  const fmt0: FileCard['format'] = kind === 'image' ? 'image' : 'pdf_text'
  // 6. 입구 스위치가 꺼진 사람(직원) — PDF · 사진은 보류(엑셀은 그대로). 스위치 · 서버 설정을 다른 말로.
  if (!o.docs?.allowed) {
    const c = o.docs?.closed
    return [await failRecord(o, sha, c?.why === 'switch' ? MSG.docSwitchOff(c.audience) : MSG.pdfLater, { format: fmt0, status: 'later' })]
  }
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
  // 같은 PDF · 사진이 이미 살아 있으면 읽기(AI) 전에 멈춘다.
  // (이름까지 같을 때만 — 이름을 바꾼 같은 바이트는 예전처럼 읽은 뒤 종류 · 기간으로 가린다.)
  const same = (await o.repo.listFinUploads(o.businessId).catch(() => [] as FinUpload[])).find((u) => u.file_sha256 === sha && u.file_name === o.fileName && (u.status === 'applied' || u.status === 'needs_review'))
  if (same) return [{ ...sameFileCard(o.fileName, same), format: doc.format }]
  // 2. 읽기 — 한 파일 = AI 한 번(긴 글 PDF는 쪽을 나눠 한도까지). 글 PDF는 카드번호를 가린 글만 보낸다.
  const reader = o.docs.read
  let table: DocTable | null = null
  let aiUsed = 0
  let aiNote: string | null = null
  if (reader && o.aiBudget > 0) {
    aiUsed = 1
    try {
      const text = doc.text.replace(CARD_IN_TEXT, (_m, _a, _b, _c, d) => `****-****-****-${d}`)
      const layout = doc.layout?.map((l) => l.map((c) => ({ ...c, t: c.t.replace(CARD_IN_TEXT, (_m, _a, _b, _c, d) => `****-****-****-${d}`) })))
      table = await reader({ fileName: o.fileName, format: doc.format, text, layout, media: doc.media, expect: official ? 'official' : 'table', maxCalls: o.aiBudget, deadline: o.deadline })
      aiUsed = Math.max(1, table.calls ?? 1)
    } catch (e) {
      aiUsed = Math.max(1, Number((e as { calls?: number })?.calls) || 1)
      aiNote = `AI 읽기 실패(${e instanceof Error ? e.message.slice(0, 80) : '?'})`
    }
  } else {
    aiNote = reader ? 'AI 한도(파일당 · 하루)를 넘었습니다' : o.docs.closed?.why === 'env' ? MSG.docNoAi : 'AI가 꺼져 있습니다(한도 미설정 · 연결 없음)'
  }
  if (table) {
    const after = refuseAfterRead(table.doc_kind)
    if (after) return [await failRecord(o, sha, after.message, { status: 'refused', aiUsed, format: doc.format })]
  }
  // 5. 세무사 확정 결산 → «공식 결산» 미리보기(자료 표에 안 넣음 · 자동 없음). 기록은 실패 줄(내용 없음 — AI 사용 수를 하루 한도에 센다).
  if (official || table?.doc_kind === 'official_statement') {
    const t = table ?? (doc.layout ? layoutToStatement(doc.layout) : null)
    const accounts = o.docs.accounts ?? []
    const draft = t ? buildOfficialDraft(t, accounts, o.fileName, { learned: o.docs.learned, cover: doc.guardText }) : null
    // 2차 맞춤(AI) — 코드가 못 맞춘 줄만 · 줄 이름과 계정과목표만(숫자 없음) · 남은 한도 안에서 한 번.
    if (draft && accounts.length && o.docs.suggest) {
      const ask = linesToAsk(draft)
      if (ask.length && o.aiBudget - aiUsed > 0) {
        try {
          const r = await o.docs.suggest({ lines: ask, accounts, deadline: o.deadline })
          aiUsed += r.calls
          applyOfficialSuggestions(draft, r.items, accounts)
        } catch (e) {
          aiUsed += Math.max(1, Number((e as { calls?: number })?.calls) || 1)
          draft.warnings.push(`AI 계정 제안 실패(${e instanceof Error ? e.message.slice(0, 80) : '?'}) — 남은 줄은 직접 골라 주세요.`)
        }
      } else if (ask.length) draft.warnings.push('AI 한도(파일당 · 하루)를 넘어 계정 제안을 받지 못했습니다 — 남은 줄은 직접 골라 주세요.')
    }
    // 0083 증빙 — 올린 원본을 그 회사 증빙 보관함에 둔다(링크를 따로 적지 않아도 된다). 실패하면 링크를 적게 한다.
    if (draft) {
      const ext = /\.(pdf|jpe?g|png)$/i.exec(o.fileName)?.[1]?.toLowerCase() ?? (kind === 'pdf' ? 'pdf' : 'jpg')
      try {
        draft.evidence_file = await o.repo.putOfficialEvidence(o.businessId, `${o.businessId}/${sha}.${ext}`, o.bytes)
      } catch (e) {
        const m = e instanceof Error ? e.message : ''
        draft.evidence_note = /unavailable/.test(m)
          ? '증빙 보관함이 아직 없습니다(0083 반영 전) — 원본을 둔 사내 드라이브 링크를 적어 주세요.'
          : '올린 원본을 증빙으로 보관하지 못했습니다 — 원본을 둔 사내 드라이브 링크를 적어 주세요.'
      }
    }
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
      // 한도 · 설정 때문이면 보류(내일 · 설정 뒤 다시), AI가 읽다 실패했으면 실패.
      const hold = !aiUsed
      return [await failRecord(o, sha, `${aiNote ?? 'AI 없음'} — 사진 · 스캔 PDF는 AI 없이 읽지 못합니다. 저장하지 않았습니다 — ${hold ? '내일 다시 올리거나 ' : ''}엑셀로 올려 주세요.`, { aiUsed, format: doc.format, status: hold ? 'later' : 'failed' })]
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
  const budgetRef = { left: o.aiBudget }
  const cards: FileCard[] = []
  const unknown: { sheet: EcountSheet; aiUsed: number; cls: Classification; sig: string }[] = []
  for (const raw of opened.sheets) {
    if (raw.rows.every((r) => r.every((c) => c.t === 'empty'))) continue
    // 같은 파일 · 같은 시트가 이미 살아 있으면 해석(AI)부터 하지 않는다 — 돈이 드는 호출을 같은 파일에 다시 쓰지 않게.
    const again = uploads.find((u) => u.file_sha256 === opened.sha256 && u.file_name === o.fileName && u.sheet_name === raw.name && (u.status === 'applied' || u.status === 'needs_review'))
    if (again) {
      cards.push({ ...sameFileCard(o.fileName, again), sheet: raw.name })
      continue
    }
    const { sheet, dropped } = scrubSheet(raw)
    // c. 해석: 학습 → 코드 규칙 → (맞지 않으면) AI 구조 해석 + 대조가 틀리면 재해석(최대 2번). d · e. 읽기 · 대조는 해석마다 코드가.
    let cls = classifyByCode(sheet)
    const sig = shapeSignature(o.businessId, sheet, cls.headerRow)
    const learned = shapes.find((s) => s.header_sig === sig)
    let aiUsed = 0
    // 0072 구성표 노출 금지: 원료 출고명세(로 보이는) 시트는 AI에 보내지 않는다 — 코드 분류만.
    const noAi = cls.kind === 'material_issue' || looksLikeMaterialIssue(sheet)
    let ev: Evaluated
    let tries = 0
    if (doc) {
      // C단계: AI가 이미 표를 읽었다(종류 판단 포함) — 코드 판단과 합친다(같으면 높음). AI가 아니면 코드 판단만.
      aiUsed = doc.aiUsed
      if (doc.byAi) {
        const t = doc.table
        cls = mergeAi(cls, { kind: t.doc_kind, confidence: t.confidence, header_row: doc.headerRow, columns: {}, reason: t.reason }, sheet.colCount)
      }
      if (cls.kind === 'material_issue') cls = { ...cls, kind: 'unknown', confidence: 'none', reason: '원료 출고명세는 엑셀로만 받습니다' }
      ev = evaluate(sheet, cls, o.fileName, o.today)
    } else {
      const r = await interpret(o, sheet, cls, learned, noAi, budgetRef)
      ev = r.ev
      aiUsed = r.aiUsed
      tries = r.aiUsed
      if (r.save && SHAPE_KINDS.has(ev.cls.kind)) {
        // g. 배우기 — 맞게 해석된 모양(칸 · 요약 줄 낱말 · 머리 열, 숫자 없음). 같은 양식은 다음부터 AI 없이.
        await o.repo
          .saveFinUploadShape({ business_id: o.businessId, header_sig: sig, sheet_name: sheet.name.slice(0, 120), kind: ev.cls.kind, column_map: encodeShape(ev.cls.columns, ev.cls.ledger ?? (ev.cls.labels?.length ? { headerRow: ev.cls.headerRow, cols: {}, labels: ev.cls.labels } : null)) })
          .catch((e) => console.error('[finance-upload] shape save', e))
      }
    }
    cls = ev.cls
    if (cls.kind === 'unknown') {
      // 모르는 시트 — 다른 시트에 아는 것이 있으면 접고(아래), 아무것도 모르면 사람이 고르게 미리보기로(칸 격자를 둔다).
      unknown.push({ sheet, aiUsed, cls, sig })
      continue
    }
    const { read, month } = ev
    const check = ev.check
    if (doc) {
      check.errors = [...new Set([...check.errors, ...doc.extraErrors])]
      check.warnings = [...new Set([...check.warnings, ...doc.extraWarnings])]
    }
    // 같은 파일(해시 · 종류 · 기간)이 이미 살아 있으면 늘리지 않는다 — 겹침보다 먼저(0070 fin_uploads_same_file과 같은 판정).
    // «확인 필요»에 있으면 그 올리기를 다시 해석하자고 묻고(화면 단추), 넣은 것이면 되돌린 뒤 올리라고 말한다.
    const same = uploads.find((u) => u.kind === cls.kind && u.period === month.period && u.file_sha256 === opened.sha256 && (u.status === 'applied' || u.status === 'needs_review'))
    if (same) {
      cards.push({ ...sameFileCard(o.fileName, same), sheet: sheet.name, kind: cls.kind, period: month.period, ai_used: aiUsed, confidence: cls.confidence, notes: readNotes(ev.read) })
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
    const meta = {
      reason: cls.reason, period_how: month.how, errors: check.errors, warnings: check.warnings, why_not_auto: decision.why, columns: cls.columns, header_row: cls.headerRow, header, sig, dropped, dup_suspects: dup.count, dup_notes: dup.notes,
      ...(cls.labels?.length ? { labels: cls.labels } : {}),
      ...(cls.ledger ? { ledger: { headerRow: cls.ledger.headerRow, cols: cls.ledger.cols as Record<string, number>, headCol: cls.ledger.headCol ?? null } } : {}),
      ...(tries ? { tries } : {}),
      ...(doc ? { source_format: doc.format, fixes: doc.fixes } : {}),
    }
    const confidenceDb = cls.confidence
    const base = { file_name: o.fileName, sheet: sheet.name, kind: cls.kind, period: month.period, ai_used: aiUsed, confidence: cls.confidence, notes: readNotes(read) }
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
  // 리뷰(2026-10-14): 기록이 안 남은 시트(접은 «모름» 시트 · 같은 파일 · 기록 실패)에 쓴 AI 호출도 하루 한도에 센다 — 내용 없는 실패 줄 하나로.
  const spent = o.aiBudget - budgetRef.left
  const recorded = cards.filter((c) => c.upload_id).reduce((a, c) => a + c.ai_used, 0)
  if (!doc && spent > recorded) {
    await failRecord(o, sha, `AI 해석 기록 — 넣지 않은 시트에 쓴 호출 ${spent - recorded}번(내용 없음)`, { aiUsed: spent - recorded })
  }
  return cards
}

/** 한 해석으로 읽고 대조한 결과. structural = 구조가 틀렸다는 표시(계정 · 합계 대조 틀림 · 모르는 줄) — 이것이 있으면 재해석한다. */
export interface Evaluated {
  cls: Classification
  read: ReadResult
  month: { period: string | null; how: string }
  check: Check
  structural: string[]
  /** 재해석 때 AI에 줄 차이(숫자 없음) */
  feedback: string[]
}

/** 해석 하나 → 읽기(코드) · 기간 · 검증 · 구조 대조. */
export function evaluate(sheet: EcountSheet, cls0: Classification, fileName: string, today?: Date): Evaluated {
  const cls = { ...cls0 }
  if (cls.kind !== 'unknown' && Object.keys(cls.columns).length === 0) cls.columns = mapColumns(kindSpec(cls.kind), sheet.rows[cls.headerRow] ?? [])
  if (cls.kind === 'unknown') {
    return { cls, read: { rows: [], people: [], fileTotal: null, problems: [], dates: [] }, month: { period: null, how: '' }, check: { errors: [], warnings: [] }, structural: [], feedback: [] }
  }
  // ⑤ 원장: 해석(칸 · 요약 줄 낱말 · 머리 열)을 cls에 고정한다 — 미리보기 · 사람이 고칠 때 · 학습이 같은 해석을 쓴다.
  if (cls.kind === 'ledger') cls.ledger = ledgerLayoutOf(sheet, cls)
  const read = readRows(sheet, cls)
  const month = detectMonth(sheet, read.dates, fileName, today)
  const check = validate(cls.kind, read, month.period)
  // 연간 제목에 여러 달 날짜 — 한 달로 넣으면 다른 달 줄이 섞인다. 자동으로 넣지 않고 사람이 기간을 본다.
  if (/섞임/.test(month.how)) check.warnings = [...check.warnings, `날짜 칸에 여러 달이 섞여 있습니다(${month.how}) — 한 달씩 내려받아 올리거나 기간을 확인하세요.`]
  if (read.ledger) {
    const l = read.ledger
    const structural = [...l.mismatches.map((m) => `${m.code}:${m.side}`), ...l.unknownRows.map((r) => `row:${r}`), ...(l.rows.length ? [] : ['no-accounts'])]
    const roles = Object.entries(l.roles).map(([k, v]) => `${ROLE_KO[k as keyof typeof ROLE_KO] ?? k} ${v}`).join(' · ')
    const fixed = cls.ledger?.note ? ` · ${cls.ledger.note}` : ''
    cls.reason = `${cls.reason.replace(/ · 줄 종류: [^·]*(?: · [^·]*)*$/, '')}${fixed} · 줄 종류: ${roles || '없음'} · 계정 ${l.rows.length}개 중 ${l.compared}개 요약 줄과 대조`
    // 화면의 «칸 바꾸기»가 원장 칸을 보이게 — 해석의 차변 · 대변 · 계정 칸을 칸 대응에 싣는다.
    const lc = cls.ledger!
    cls.columns = Object.fromEntries((['account_code', 'account_name', 'debit', 'credit'] as const).filter((k) => lc.cols[k] !== undefined).map((k) => [k, lc.cols[k]!]))
    if (!l.compared && l.rows.length) check.warnings = [...check.warnings, '요약 줄(월계 · 합계)이 없어 계정별 거래 합을 대조하지 못했습니다.']
    if (l.warnings.length) check.warnings = [...new Set([...check.warnings, ...l.warnings])].slice(0, 30)
    return { cls, read, month, check, structural, feedback: ledgerFeedback(l) }
  }
  const spec = kindSpec(cls.kind)
  const sumOff = check.errors.find((e) => e.startsWith('합계가 맞지 않습니다'))
  const feedback: string[] = []
  if (sumOff && spec.sumField && read.fileTotal !== null) {
    const sum = read.rows.reduce((a, r) => a + Number(r[spec.sumField!] ?? 0), 0)
    const k = read.fileTotal !== 0 ? sum / read.fileTotal : 0
    const how = Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) >= 2 ? `줄의 합이 합계 줄의 정확히 ${Math.round(k)}배` : '줄의 합과 합계 줄이 다름'
    feedback.push(`«${spec.fields.find((f) => f.key === spec.sumField)?.label}» 칸: ${how}. 읽은 줄 ${read.rows.length}개(줄 번호 ${read.rows.slice(0, 20).map((r) => r.row_no - 1).join(',')}).`)
  }
  return { cls, read, month, check, structural: sumOff ? ['sum'] : [], feedback }
}

/** 나쁜 정도(작을수록 좋음) — 구조 틀림이 먼저, 그다음 검증 오류. */
const badness = (e: Evaluated) => e.structural.length * 1000 + e.check.errors.length

/** AI 답 → 해석(종류 · 칸은 mergeAi, 요약 줄 낱말 · 원장 칸 · 머리 열은 여기서). 원장 칸은 잔액 흐름으로 한 번 더 확인한다. */
export function withStructure(code: Classification, ai: AiStructure, sheet: EcountSheet): Classification {
  const headerOk = Number.isInteger(ai.header_row) && ai.header_row >= 0 && ai.header_row < sheet.rows.length
  const cls = mergeAi(code, { ...ai, header_row: headerOk ? ai.header_row : code.headerRow }, sheet.colCount)
  const labels = ai.row_labels ?? []
  if (cls.kind !== 'ledger') return { ...cls, labels }
  const base = ledgerLayoutByCode(sheet)
  const cols: Partial<Record<LedgerCol, number>> = { ...(base?.cols ?? {}) }
  for (const k of LEDGER_COLS) {
    const v = ai.columns[k]
    if (Number.isInteger(v) && v >= 0 && v < sheet.colCount) cols[k] = v
  }
  const layout: LedgerLayout = { headerRow: headerOk ? ai.header_row : (base?.headerRow ?? cls.headerRow), cols, labels, headCol: ai.account_head_col }
  return { ...cls, labels, ledger: fixByBalance(sheet, layout) }
}

/**
 * 시트 하나의 해석(엑셀). 학습 모양 → 코드 규칙 → AI(+재해석 2번). 대조가 맞으면 거기서 멈춘다.
 * 끝까지 맞지 않으면 가장 덜 틀린 해석을 «확인 필요»로 — 숫자를 억지로 맞추지 않는다(차이가 검증 오류로 남는다).
 */
async function interpret(o: ProcessOptions, sheet: EcountSheet, code0: Classification, learned: FinUploadShape | undefined, noAi: boolean, budget: { left: number }): Promise<{ ev: Evaluated; aiUsed: number; save: boolean }> {
  const evalOf = (c: Classification) => evaluate(sheet, c, o.fileName, o.today)
  let code = code0
  if (learned) {
    const d = decodeShape(learned.column_map)
    const kind = learned.kind as UploadKind
    const ledger = kind === 'ledger' && d.cols.debit !== undefined && d.cols.credit !== undefined ? fixByBalance(sheet, { headerRow: d.headerRow ?? code.headerRow, cols: d.cols, labels: d.labels, headCol: d.headCol }) : undefined
    const ev = evalOf({ kind, confidence: 'high', headerRow: d.headerRow ?? code.headerRow, columns: d.columns, labels: d.labels, ledger, reason: '지난번에 맞게 해석된 모양(학습) — AI 없이', source: 'learned' })
    if (!ev.structural.length) return { ev, aiUsed: 0, save: false }
    code = { ...code, reason: `${code.reason} · 학습한 모양으로는 대조가 맞지 않아 다시 해석` }
  }
  let best = evalOf(code)
  // 원장: 코드 규칙만으로 요약 줄 대조가 다 맞으면(대조한 계정 1개 이상) 믿음 높음 — AI 없이.
  if (best.cls.kind === 'ledger' && best.read.ledger && best.read.ledger.compared > 0 && !best.structural.length && best.cls.confidence !== 'high') {
    best = { ...best, cls: { ...best.cls, confidence: 'high', reason: `${best.cls.reason} · 거래 줄 합 = 요약 줄(코드 규칙)` } }
  }
  // 원장은 요약 줄과 대조가 된 해석만 «맞다»고 본다(대조할 줄이 없으면 AI에도 한 번 보인다).
  const verified = best.cls.kind !== 'ledger' || (best.read.ledger?.compared ?? 0) > 0
  if (best.cls.confidence === 'high' && !best.structural.length && verified) return { ev: best, aiUsed: 0, save: false }
  const why = (note: string) => ({ ev: { ...best, cls: { ...best.cls, reason: `${best.cls.reason} · ${note}` } }, aiUsed: 0, save: false })
  if (noAi) return why('출고명세로 보이는 시트라 AI에 보내지 않음(코드 해석만)')
  if (!o.classify) return why('AI 해석 꺼짐(한도 · 연결 없음)')
  if (budget.left <= 0) return why('AI 한도(파일당 · 하루)를 넘어 코드 해석만')
  let used = 0
  let feedback: string[] | undefined
  let ok = false
  for (let attempt = 0; attempt < AI_TRIES_PER_SHEET && budget.left > 0; attempt += 1) {
    // 요청 시간 한도(300초)가 가까우면 더 부르지 않는다 — 끊기면 기록 · 수신함 지우기가 남지 않는다.
    if (o.deadline && Date.now() > o.deadline - 60_000) {
      best = { ...best, cls: { ...best.cls, reason: `${best.cls.reason} · 시간 한도가 가까워 AI 재해석을 멈춤` } }
      break
    }
    used += 1
    budget.left -= 1
    let ai: AiStructure
    try {
      ai = await o.classify(aiSample(sheet, code.headerRow), code, feedback)
    } catch (e) {
      best = { ...best, cls: { ...best.cls, confidence: best.cls.confidence === 'high' ? 'medium' : best.cls.confidence, reason: `${best.cls.reason} · AI 해석 실패(${e instanceof Error ? e.message.slice(0, 80) : '?'}) — 코드 해석만` } }
      break
    }
    const ev = evalOf(withStructure(code, ai, sheet))
    if (attempt) ev.cls.reason = `${ev.cls.reason} · AI 재해석 ${attempt}번째`
    if (badness(ev) <= badness(best)) best = ev
    if (!ev.structural.length) {
      ok = best === ev
      break
    }
    feedback = ev.feedback
  }
  if (!ok && best.structural.length && used > 0) best = { ...best, cls: { ...best.cls, reason: `${best.cls.reason} · AI ${used}번 해석해도 요약 줄과 맞지 않음 — 차이를 보고 사람이 정합니다` } }
  // 학습은 대조로 맞음이 확인된 해석만(원장은 요약 줄과 맞춰 본 계정이 하나 이상).
  const checked = best.cls.kind !== 'ledger' || (best.read.ledger?.compared ?? 0) > 0
  return { ev: best, aiUsed: used, save: ok && checked && best.cls.source === 'ai' && best.cls.kind !== 'unknown' }
}

/**
 * «AI로 다시 해석» — 이미 올린 파일의 칸 격자(버리기 뒤)로 해석부터 다시 한다(파일을 다시 올리지 않는다).
 * 학습 모양은 쓰지 않는다(학습이 틀렸을 수 있다). 기록은 새 대기 · 넣기(옛 대기는 호출자가 먼저 취소).
 */
export async function reprocessSheet(o: ProcessOptions, sha: string, sheet: EcountSheet): Promise<FileCard[]> {
  return processSheets({ ...o, repo: withoutShapes(o.repo) }, sha, [sheet], null)
}

/**
 * «확인 필요» 카드의 다시 해석 — 대기의 칸 격자 → 옛 대기 취소 → 해석부터 다시(새 대기 · 넣기). 새 기록이 하나도 안 생기면
 * 옛 대기를 되살린다(같은 내용 · 같은 해시). 칸 격자가 없으면(급여 · 원료 숫자 가림 · 0080 문 밖) 다시 올리라고 말한다.
 */
export async function reinterpretPending(o: Omit<ProcessOptions, 'bytes' | 'fileName' | 'docs'>, uploadId: string): Promise<{ cards: FileCard[]; error?: string }> {
  const upload = (await o.repo.listFinUploads(o.businessId)).find((u) => u.upload_id === uploadId)
  if (!upload || upload.status !== 'needs_review') return { cards: [], error: '이미 처리했거나 볼 수 없는 올리기입니다.' }
  const pending = await o.repo.finUploadPending(uploadId)
  if (!pending) return { cards: [], error: '이미 처리했거나 볼 수 없는 올리기입니다.' }
  if (pending.masked || !pending.grid?.length) return { cards: [], error: '이 자리에서는 원본 칸을 볼 수 없어 다시 해석하지 못합니다 — «취소»를 누른 뒤 파일을 다시 올려 주세요.' }
  const sheet = fromGrid(upload.sheet_name ?? 'sheet', pending.grid)
  if (!(await o.repo.finUploadCancel(uploadId))) return { cards: [], error: '이미 처리한 올리기입니다.' }
  let cards: FileCard[] = []
  try {
    cards = await reprocessSheet({ ...o, fileName: upload.file_name, bytes: new Uint8Array() }, upload.file_sha256, sheet)
  } catch (e) {
    console.error('[finance-upload] reinterpret', e)
  }
  if (!cards.some((c) => c.upload_id && (c.status === 'needs_review' || c.status === 'applied'))) {
    // 되살린 줄의 ai_used는 0 — 옛 호출은 취소된 옛 줄에, 이번 호출은 processSheets가 남긴 줄에 이미 센다(두 번 세지 않게).
    const restored = await o.repo
      .finUploadRecord({ business_id: o.businessId, kind: upload.kind, period: upload.period, file_name: upload.file_name, file_sha256: upload.file_sha256, sheet_name: upload.sheet_name, ai_confidence: upload.ai_confidence, ai_used: 0, status: 'needs_review', pending, error: null })
      .then(() => true)
      .catch((e) => {
        console.error('[finance-upload] reinterpret restore', e)
        return false
      })
    return { cards, error: restored ? '다시 해석하지 못해 예전 «확인 필요»를 그대로 두었습니다.' : '다시 해석하지 못했고 예전 «확인 필요»도 되살리지 못했습니다 — 파일을 다시 올려 주세요.' }
  }
  return { cards }
}

function withoutShapes(repo: ChairmanRepository): ChairmanRepository {
  return new Proxy(repo, { get: (t, k, r) => (k === 'listFinUploadShapes' ? async () => [] : Reflect.get(t, k, r)) })
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
    // 0080: 원료 숫자가 가려진 입고 줄(올린 사람 1시간 · 대표 · CFO · 원가 관리 밖)이 있으면 금액으로 맞춰 볼 수 없다 —
    // 셀 수 없음(null)으로 두어 자동 넣기를 멈춘다(사람이 미리보기에서 본다).
    if (existing.some((l) => l.hidden)) return { count: null, notes: ['원료 금액이 가려진 입고 줄이 있어 같은 거래를 맞춰 보지 못했습니다 — 대표 · CFO · 원가 관리가 «자료 간 같은 거래»에서 확인합니다.'] }
    const fresh = txLinesFromRows(kind, rows)
    const groups = matchTx([...existing, ...fresh], setting, rejectedPairs(saved))
    const mine = groups.filter((g) => g.status === 'suspect' && g.refs.some((r) => r.startsWith('new:')))
    // PHASE 4: 달 경계 ±3일 줄은 앞 · 뒤 달 줄과도 맞춰 본다 — 짝이 있으면 자동 넣기를 멈춘다(닫힌 쪽 · 저장은 하지 않음).
    const cross = await crossMonthFor(repo, businessId, period, fresh)
    // PHASE 11(0076 리뷰 Minor): 달 넘김 짝은 «같은 거래»(same)만 자동 넣기를 멈춘다 — «의심»은 메모로만(달 넘김 짝은 무시할 손잡이가 없다).
    const crossRows = [...new Set(cross.filter((c) => c.kind === 'same').map((c) => c.ref))]
    const notes = [
      ...mine.slice(0, 10).map((g) => `${g.refs.filter((r) => r.startsWith('new:')).map((r) => r.slice(4) + '행').join(' · ')} — ${describeGroup(g)}`),
      ...cross.slice(0, 5).map((c) => `${c.ref.slice(4)}행 — ${c.other_period} 줄과 달 넘김 의심(${describeGroup(c)})`),
    ]
    return { count: countNewSuspects(groups) + crossRows.length, notes }
  } catch (e) {
    console.error('[finance-upload] dup count', e)
    return { count: null, notes: [] }
  }
}

/**
 * PHASE 4 — 이 달 줄 중 달 경계 ±3일인 것을 앞 · 뒤 달 살아 있는 줄과 맞춘 «달 넘김 의심»(보여 주기만 · 저장 없음).
 * 경계 줄이 없으면 앞 · 뒤 달을 읽지 않는다. 읽기가 실패하면 그 달은 건너뛴다.
 */
export async function crossMonthFor(repo: ChairmanRepository, businessId: string, period: string, lines: FinTxLine[]): Promise<CrossMonthPair[]> {
  const edge = lines.filter((l) => nearMonthEdge(l.date))
  const nb = neighborPeriods(period)
  if (!edge.length || !nb) return []
  const others = await Promise.all([nb.prev, nb.next].map(async (p) => ({ period: p, lines: await repo.listFinTxLines(businessId, p).catch(() => [] as FinTxLine[]) })))
  return crossMonthPairs(edge, others)
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
