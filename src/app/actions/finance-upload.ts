'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'

import { canCloseBooks, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { aiLimits, realClassifier } from '@/lib/finance-upload/ai'
import { realDocReader } from '@/lib/finance-upload/ai-doc'
import { realOfficialSuggester } from '@/lib/finance-upload/official-ai'
import { isUploadKind, kindSpec } from '@/lib/finance-upload/kinds'
import { encodeShape, ledgerLayoutByCode, ROW_ROLES, type LedgerLayout, type RowLabel } from '@/lib/finance-upload/ledger'
import { inboxPathOk } from '@/lib/finance-upload/inbox'
import { labelKey, SKIP_COLUMN } from '@/lib/finance-upload/synonyms'
import { MSG, UPLOAD_MAX_BYTES } from '@/lib/finance-upload/open'
import { mapColumns, readRows, validate, type Classification } from '@/lib/finance-upload/pipeline'
import { finUploadError, fromGrid, processUpload, reinterpretPending, saveTxGroupsFor, type DocOptions, type FileCard } from '@/lib/finance-upload/process'
import { AUDIENCE_LABEL } from '@/lib/features'
import { featureOn, featureWhy } from '@/lib/features-server'
import { getRepository, type ChairmanRepository } from '@/lib/repository'
import { processRecalc } from '@/lib/finance-overview/recalc'
import { parseKpiSettings } from '@/lib/finance-overview/settings'
import type { FinRow, FinUpload } from '@/types'

/** 0073 기능 스위치로 꺼진 기능의 문장. */
const OFF = '지금은 쓸 수 없는 기능입니다.'
const MATERIAL_HIDDEN = '원료 단가 · 수량은 올린 사람(올린 뒤 1시간) · 대표 · CFO · 원가 관리만 봅니다 — 이 미리보기는 넣을 수 없습니다. 파일을 다시 올려 주세요.'

/**
 * «회계 · 재무 자료 올리기» v2 서버 액션 — 올리기(여러 파일) · 미리보기 넣기(종류 · 칸 · 기간 · 겹침 · 이유) · 되돌리기 · 취소.
 * 판정은 DB(0070 RPC — can_keep_books · 마감 · 겹침 · 같은 파일)다. 여기서는 파일을 열고 코드로 읽어 넘길 뿐이다.
 * AI는 분류 · 칸 맞추기 JSON만(lib/finance-upload/ai.ts) — 한도(env)를 넘으면 AI 없이 미리보기로.
 */

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const UUID = /^[0-9a-f-]{36}$/i
const BIZ = /^[a-z0-9_]{2,40}$/

export interface UploadResult {
  cards: FileCard[]
  error?: string
}

function kstDay(iso: string) {
  return new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10)
}

const failedCard = (fileName: string, message: string): FileCard => ({ file_name: fileName, sheet: null, kind: 'unknown', period: null, status: 'failed', upload_id: null, rows: 0, message, why: [], ai_used: 0, confidence: 'none' })

/**
 * 파일 **하나** 올리기(2026-10-16 — 한 요청에 한 파일: 한 파일 실패가 다른 파일에 번지지 않고, 요청마다 maxDuration 300초).
 *   live  브라우저가 0082 수신함(fin-upload-inbox «<회사>/<본인>/<이름>»)에 바로 올리고 여기에는 경로만 — Vercel 4.5MB 요청 한도를 타지 않는다.
 *         서버는 사람 세션(RLS)으로 내려받아 처리하고 **지운다**(원본을 두지 않는다 — 0070 설계).
 *   dummy 바이트를 이 요청으로(dummy 첨부와 같은 길 — bodySizeLimit 21mb).
 */
export async function uploadFinanceFile(form: FormData): Promise<UploadResult> {
  // 요청 300초(화면 maxDuration) 안에 끝내도록 — AI가 남은 시간을 보고 멈춘다.
  const deadline = Date.now() + 280_000
  const user = await currentUser()
  if (!user) return { cards: [], error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const businessId = text(form.get('business_id'), 40)
  const file = form.get('file')
  const path = text(form.get('path'), 300)
  const fileName = (file instanceof File ? file.name : text(form.get('name'), 255)).slice(0, 255)
  // 수신함 파일은 어느 길로 끝나든(거부 · 실패 포함) 지운다 — 원본을 두지 않는다(리뷰: 앞쪽 거부가 파일을 남겼다).
  const mine = !!path && BIZ.test(businessId) && inboxPathOk(path, businessId, user.user_id)
  const repo = await getRepository()
  try {
    if (!BIZ.test(businessId)) return { cards: [], error: '회사를 알 수 없습니다.' }
    // 0073 기능 스위치 «자료 올리기» — 꺼져 있으면 거부(화면도 404).
    if (!(await featureOn(user, 'finance_upload', businessId))) return { cards: [], error: OFF }
    if (!canKeepBooks(user, businessId)) return { cards: [], error: '이 회사의 재무를 넣을 권한이 없습니다.' }
    if (!fileName || (!(file instanceof File) && !path)) return { cards: [], error: '파일을 놓아 주세요.' }
    let bytes: Uint8Array
    if (path) {
      // 경로는 본인 폴더만(DB 정책 0082가 최종 판정 — 여기는 사람의 말로 먼저).
      if (!mine) return { cards: [failedCard(fileName, '올린 파일의 자리가 맞지 않습니다 — 다시 올려 주세요.')] }
      try {
        bytes = await repo.finInboxRead(path)
      } catch (e) {
        console.error('[uploadFinanceFile] inbox read', e)
        return { cards: [failedCard(fileName, '올린 파일을 서버가 읽지 못했습니다 — 다시 올려 주세요.')] }
      }
    } else {
      bytes = new Uint8Array(await (file as File).arrayBuffer())
    }
    if (bytes.length > UPLOAD_MAX_BYTES) return { cards: [failedCard(fileName, MSG.tooBig)] }
    // 하루 AI 한도 — 이 회사의 오늘(KST) 올리기의 AI 호출 합(파일마다 다시 센다 — 앞 파일의 기록이 이미 DB에 있다).
    const { perFile, perDay } = aiLimits()
    const today = kstDay(new Date().toISOString())
    const usedToday = (await repo.listFinUploads(businessId).catch(() => [] as FinUpload[])).filter((u) => kstDay(u.created_at) === today).reduce((a, u) => a + u.ai_used, 0)
    const budget = Math.max(0, Math.min(perFile, perDay - usedToday))
    const docs = await docOptions(user, repo, businessId, fileName, perFile > 0 && perDay > 0)
    // 0089 기능 스위치 «엑셀 열 맞추기 AI»(finance_upload_ai) — 꺼진 회사 · 사람은 엑셀 해석에 AI를 부르지 않는다(비슷한 이름 · 저장된 맞춤만). PDF · 사진은 finance_docs가 따로.
    const excelAi = budget > 0 && (await featureOn(user, 'finance_upload_ai', businessId)) ? realClassifier(repo, businessId) : null
    const cards = await processUpload({ repo, businessId, fileName, bytes, classify: excelAi, aiBudget: budget, docs, deadline, boss: user.role === 'Chairman' || user.role === 'GroupCFO', user })
    recalcAfter(repo, businessId)
    revalidatePath(`/finance/${businessId}/upload`)
    revalidatePath('/finance')
    return { cards }
  } catch (e) {
    console.error('[uploadFinanceFile]', e)
    return { cards: [failedCard(fileName, finUploadError(e))] }
  } finally {
    if (mine) {
      await repo.finInboxRemove([path]).catch(() => false)
      // 처리 중 끊겨 남은 본인 파일(1시간 넘은 것)도 치운다(화면을 열 때도 — upload/page.tsx).
      await repo.finInboxSweep(path.slice(0, path.lastIndexOf('/'))).catch(() => 0)
    }
  }
}

/** PDF · 사진 설정 — 스위치(누구에게 열렸나)와 서버 설정(키 · 한도)을 다른 말로. 회사 이름 · 계정은 PDF · 사진일 때만 읽는다. */
async function docOptions(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, repo: Awaited<ReturnType<typeof getRepository>>, businessId: string, fileName: string, limitsSet: boolean): Promise<DocOptions> {
  const why = await featureWhy(user, 'finance_docs', businessId)
  const read = why.on && limitsSet ? realDocReader(repo, businessId) : null
  const docs: DocOptions = {
    allowed: why.on,
    read,
    closed: !why.on ? { why: 'switch', audience: why.enabled ? AUDIENCE_LABEL[why.audience] : null } : read ? null : { why: 'env' },
  }
  if (why.on && /\.(pdf|jpe?g|png)$/i.test(fileName)) {
    const [businesses, ledger] = await Promise.all([repo.listBusinesses().catch(() => []), repo.loadFinanceLedger().catch(() => null)])
    docs.businessName = businesses.find((b) => b.business_id === businessId)?.name
    docs.accounts = (ledger?.accounts ?? []).filter((a) => a.business_id === businessId && a.active).map((a) => ({ account_code: a.account_code, name: a.name, section: a.section }))
    // 0083 계정 맞춤 학습 · 2차 맞춤(AI — 읽기와 같은 스위치 · 한도).
    docs.learned = new Map((await repo.listOfficialAccountMap(businessId).catch(() => [])).map((m) => [m.std_key, m.account_code]))
    docs.suggest = read ? realOfficialSuggester(repo, businessId) : null
  }
  return docs
}

/** 저장 직후 다시 계산(그 사람 세션 — 응답 뒤). 실패는 큐가 cron으로 다시 한다. */
function recalcAfter(repo: ChairmanRepository, businessId: string) {
  try {
    after(async () => {
      await processRecalc(repo, { businessId, limit: 2 }).catch((e) => console.error('[finance-upload] recalc', e))
    })
  } catch {
    // after 밖(검사 스크립트)에서 불리면 건너뛴다 — 큐에는 이미 들어 있다(DB 트리거).
  }
}

export interface ApplyInput {
  uploadId: unknown
  businessId: unknown
  /** 보류 «종류 모름»이면 고른 종류 */
  kind?: unknown
  /** 보류 «달 모름»이면 고른 달 */
  period?: unknown
  /** 보류 «마감 달»이면 대표 · CFO의 이유 */
  reason?: unknown
  /** 옛 미리보기 칸(쓰지 않는다 — 0085부터 겹치면 늘 바꾸기) */
  overlap?: unknown
  columns?: unknown
}

const YM = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * 0085 보류 풀기 — «보류» 카드에서 종류 · 달 · 이유를 받아 그 자리에서 저장한다(미리보기 · 겹침 고르기 없음 — 같은 달은 바꾸기).
 * 종류를 바꾸면 버리기 뒤 칸 격자로 다시 읽는다(숫자는 코드가). 막는 것은 DB 판정(마감 · 재고 바꾸기 · 확정 평가) 그대로.
 */
export async function applyPendingUpload(input: ApplyInput): Promise<{ ok?: true; error?: string; problems?: string[] }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const id = text(input.uploadId, 64)
  const businessId = text(input.businessId, 40)
  if (!(await featureOn(user, 'finance_upload', businessId))) return { error: OFF }
  const reason = text(input.reason, 500) || null
  if (!UUID.test(id) || !BIZ.test(businessId)) return { error: '올리기를 알 수 없습니다.' }
  try {
    const repo = await getRepository()
    const pending = await repo.finUploadPending(id)
    if (!pending) return { error: '이미 처리했거나 볼 수 없는 올리기입니다.' }
    if (pending.masked) return { error: MATERIAL_HIDDEN }
    const upload = (await repo.listFinUploads(businessId)).find((u) => u.upload_id === id)
    if (!upload) return { error: '이미 처리했거나 볼 수 없는 올리기입니다.' }
    const meta = pending.meta ?? {}
    const kind = text(input.kind, 30) || upload.kind
    const period = text(input.period, 7) || upload.period || ''
    if (!isUploadKind(kind)) return { error: '종류를 골라 주세요.' }
    if (!YM.test(period)) return { error: '달(YYYY-MM)을 골라 주세요.' }
    let rows = pending.rows
    let people = pending.people ?? null
    let warnings = [...(meta.warnings ?? []), ...(meta.errors ?? [])]
    if ((kind !== upload.kind || !rows.length) && pending.grid) {
      const sheet = fromGrid(upload.sheet_name ?? 'sheet', pending.grid)
      const headerRow = meta.header_row ?? 0
      const columns = mapColumns(kindSpec(kind), sheet.rows[headerRow] ?? [])
      const labels = (meta.labels ?? []).filter((l): l is RowLabel => (ROW_ROLES as readonly string[]).includes(l.role))
      const base = kind === 'ledger' ? ledgerLayoutByCode(sheet) : null
      const ledger: LedgerLayout | undefined = kind === 'ledger' ? { headerRow: base?.headerRow ?? headerRow, cols: base?.cols ?? {}, labels, headCol: base?.headCol ?? null } : undefined
      const cls: Classification = { kind, confidence: 'medium', headerRow, columns, reason: '사람이 고름', source: 'code', labels, ledger }
      const read = readRows(sheet, cls)
      if (!read.rows.length) return { error: '고른 종류로 읽었더니 넣을 줄이 없습니다 — 다른 종류를 골라 주세요(엑셀은 받은 그대로 두셔도 됩니다).' }
      rows = read.rows as FinRow[]
      people = kind === 'payroll' ? (read.people as FinRow[]) : null
      const check = validate(kind, read, period)
      warnings = [...new Set([...check.errors, ...check.warnings])]
      // 배우기 — 시트 모양 → 사람이 고른 종류 · 칸(숫자 없음).
      if (meta.sig) await repo.saveFinUploadShape({ business_id: businessId, header_sig: meta.sig, sheet_name: upload.sheet_name ?? null, kind, column_map: encodeShape(columns, ledger ?? null) }).catch((e) => console.error('[applyPendingUpload] shape', e))
    } else if (kind !== upload.kind) {
      return { error: '이 올리기는 칸 격자가 없어 종류를 바꿀 수 없습니다 — 파일을 다시 올려 주세요.' }
    }
    const boss = user.role === 'Chairman' || user.role === 'GroupCFO'
    const saved = await repo.finUploadSave({
      business_id: businessId, kind, period, file_name: upload.file_name, file_sha256: upload.file_sha256, sheet_name: upload.sheet_name ?? null,
      ai_confidence: upload.ai_confidence, ai_used: upload.ai_used, rows, people: boss && people?.length ? people : null, reason, upload_id: id,
      warnings: warnings.slice(0, 40),
    })
    if (!boss && people?.length) await repo.finPayrollHold(saved, people).catch((e) => console.error('[applyPendingUpload] payroll hold', e))
    await saveTxGroupsFor(repo, businessId, kind, period, saved, reason).catch((e) => console.error('[applyPendingUpload] tx groups', e))
    recalcAfter(repo, businessId)
    revalidatePath(`/finance/${businessId}/upload`)
    revalidatePath('/finance')
    return { ok: true }
  } catch (e) {
    console.error('[applyPendingUpload]', e)
    const m = e instanceof Error ? e.message : ''
    if (m.includes('fin_upload_closed')) return { error: '마감된 달입니다 — 대표 · CFO가 이유(2자 이상)를 적어야 저장됩니다.' }
    if (m.includes('ledger_post_live') || m.includes('cost_candidate_live')) return { error: '이 자료의 줄이 장부 반영 · 원가 LOT로 이미 쓰였습니다 — 그쪽을 먼저 무효로 하세요.' }
    if (m.includes('fin_replace_restricted')) return { error: '이미 넣은 달의 재고 · 원료 출고를 바꾸는 것은 대표 · CFO만 합니다.' }
    if (m.includes('fin_material_hidden')) return { error: MATERIAL_HIDDEN }
    if (m.includes('fin_valuation_final_exists')) return { error: '그 구분의 확정된 평가금액이 이미 있습니다 — «재고 · 평가» 화면에서 이유를 적고 바꾸세요.' }
    if (m.includes('fin_value_state')) return { error: '빈칸 · 0 표시가 맞지 않는 칸이 있습니다(빈칸은 0이 아닙니다).' }
    return { error: finUploadError(e) }
  }
}

/** 0085 급여 개인 줄 보류 — 대표 · CFO의 저장 · 버리기. */
export async function releasePayrollHold(holdId: unknown, businessId: unknown, save: unknown): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다.' }
  if (user.role !== 'Chairman' && user.role !== 'GroupCFO') return { error: '급여 개인 줄은 대표 · CFO만 저장합니다.' }
  const id = text(holdId, 64)
  const biz = text(businessId, 40)
  if (!UUID.test(id) || !BIZ.test(biz)) return { error: '보류를 알 수 없습니다.' }
  try {
    const repo = await getRepository()
    if (!(await repo.listFinPayrollHeld(biz)).some((h) => h.hold_id === id)) return { error: '보류를 알 수 없습니다.' }
    const ok = await repo.finPayrollRelease(id, save === true)
    revalidatePath(`/finance/${biz}/upload`)
    return ok ? { ok: true } : { error: '이미 결정한 보류입니다.' }
  } catch (e) {
    return { error: /hold_state/.test(e instanceof Error ? e.message : '') ? '그 급여대장이 되돌려졌습니다 — 다시 올려 주세요.' : finUploadError(e) }
  }
}

/** 0085 바로 저장한 공식 결산 되돌리기(7일 — 앞 결산이 있으면 되살린다). */
export async function withdrawOfficialSave(ids: unknown, businessId: unknown): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다.' }
  const biz = text(businessId, 40)
  const list = Array.isArray(ids) ? ids.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, 10) : []
  if (!BIZ.test(biz) || !list.length) return { error: '되돌릴 결산을 알 수 없습니다.' }
  if (!canKeepBooks(user, biz)) return { error: '이 회사의 재무를 넣을 권한이 없습니다.' }
  try {
    const repo = await getRepository()
    const mine = new Set((await repo.listOfficialStatements(biz)).filter((o) => o.superseded_at === null).map((o) => o.id))
    for (const id of list) if (mine.has(id)) await repo.withdrawOfficialStatement(id, '자료 올리기 되돌리기')
    recalcAfter(repo, biz)
    revalidatePath(`/finance/${biz}/upload`)
    revalidatePath('/finance')
    return { ok: true }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (/withdraw_expired/.test(m)) return { error: '저장한 지 7일이 지나 되돌릴 수 없습니다.' }
    if (/books_forbidden/.test(m)) return { error: '올린 사람 또는 대표 · CFO · 마감 권한자만 되돌립니다.' }
    return { error: '되돌리지 못했습니다.' }
  }
}

/** 0085 12가지 지표 기준값 — 대표 · CFO · 마감 권한자. */
export async function saveKpiSettings(businessId: unknown, raw: unknown, reason: unknown): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다.' }
  const biz = text(businessId, 40)
  if (!BIZ.test(biz)) return { error: '회사를 알 수 없습니다.' }
  if (!canCloseBooks(user, biz)) return { error: '기준값은 대표 · CFO · 마감 권한자만 바꿉니다.' }
  const why = text(reason, 300)
  if (why.length < 2) return { error: '바꾸는 이유를 적어 주세요.' }
  try {
    const repo = await getRepository()
    await repo.saveFinKpiSettings(biz, parseKpiSettings(raw) as unknown as Record<string, unknown>, why)
    revalidatePath('/finance')
    return { ok: true }
  } catch (e) {
    return { error: /denied/.test(e instanceof Error ? e.message : '') ? '기준값은 대표 · CFO · 마감 권한자만 바꿉니다.' : '저장하지 못했습니다.' }
  }
}

/** 화면이 보낸 회사 id로 스위치를 봤으니 — 그 올리기가 그 회사 것인지 확인한다(0073 리뷰 I1). */
async function ownsUpload(repo: Awaited<ReturnType<typeof getRepository>>, businessId: string, uploadId: string): Promise<boolean> {
  if (!BIZ.test(businessId)) return false
  return (await repo.listFinUploads(businessId)).some((u) => u.upload_id === uploadId)
}

export async function revertUpload(uploadId: unknown, businessId: unknown, reason: unknown): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다.' }
  if (!(await featureOn(user, 'finance_upload', text(businessId, 40)))) return { error: OFF }
  const id = text(uploadId, 64)
  if (!UUID.test(id)) return { error: '올리기를 알 수 없습니다.' }
  try {
    const repo = await getRepository()
    if (!(await ownsUpload(repo, text(businessId, 40), id))) return { error: '올리기를 알 수 없습니다.' }
    const ok = await repo.finUploadRevert(id, text(reason, 500) || null)
    if (ok) recalcAfter(repo, text(businessId, 40))
    revalidatePath(`/finance/${text(businessId, 40)}/upload`)
    revalidatePath('/finance')
    return ok ? { ok: true } : { error: '이미 되돌렸거나 넣은 것이 아닙니다.' }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (m.includes('fin_upload_revert_expired')) return { error: '넣은 지 7일이 지나 되돌릴 수 없습니다 — 정정 자료를 올리세요.' }
    if (m.includes('fin_upload_closed')) return { error: '마감된 달은 대표 · CFO만 되돌립니다.' }
    if (m.includes('ledger_post_live') || m.includes('cost_candidate_live')) return { error: '이 자료의 줄이 장부 반영 · 원가 LOT로 이미 쓰였습니다 — 그쪽을 먼저 무효로 하세요.' }
    if (m.includes('fin_replace_restricted')) return { error: '원료 출고 · 재고 자료의 되돌리기는 대표 · CFO만 합니다 — 대표 · CFO에게 요청하세요.' }
    return { error: finUploadError(e) }
  }
}

/**
 * «AI로 다시 해석» — «확인 필요» 카드의 올리기를 파일 없이 다시 해석한다(대기의 칸 격자 → 해석 · 대조 · 재해석).
 * AI 한도(파일당 · 하루)는 올리기와 같다. 옛 대기는 취소되고 새 카드가 생긴다(실패하면 옛 대기를 되살린다).
 */
export async function reinterpretUpload(uploadId: unknown, businessId: unknown): Promise<UploadResult> {
  const user = await currentUser()
  if (!user) return { cards: [], error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const biz = text(businessId, 40)
  const id = text(uploadId, 64)
  if (!BIZ.test(biz) || !UUID.test(id)) return { cards: [], error: '올리기를 알 수 없습니다.' }
  if (!(await featureOn(user, 'finance_upload', biz))) return { cards: [], error: OFF }
  if (!canKeepBooks(user, biz)) return { cards: [], error: '이 회사의 재무를 넣을 권한이 없습니다.' }
  try {
    const repo = await getRepository()
    if (!(await ownsUpload(repo, biz, id))) return { cards: [], error: '올리기를 알 수 없습니다.' }
    const { perFile, perDay } = aiLimits()
    const today = kstDay(new Date().toISOString())
    const all = await repo.listFinUploads(biz).catch(() => [] as FinUpload[])
    const usedToday = all.filter((u) => kstDay(u.created_at) === today).reduce((a, u) => a + u.ai_used, 0)
    // 파일당 한도는 다시 해석까지 센다 — 같은 파일(해시)에 이미 쓴 호출을 뺀다(리뷰 2026-10-14).
    const sha = all.find((u) => u.upload_id === id)?.file_sha256
    const usedOnFile = sha ? all.filter((u) => u.file_sha256 === sha).reduce((a, u) => a + u.ai_used, 0) : 0
    const budget = Math.max(0, Math.min(perFile - usedOnFile, perDay - usedToday))
    const out = await reinterpretPending({ repo, businessId: biz, classify: budget > 0 && (await featureOn(user, 'finance_upload_ai', biz)) ? realClassifier(repo, biz) : null, aiBudget: budget, deadline: Date.now() + 280_000 }, id)
    revalidatePath(`/finance/${biz}/upload`)
    return out
  } catch (e) {
    console.error('[reinterpretUpload]', e)
    return { cards: [], error: finUploadError(e) }
  }
}

export async function cancelUpload(uploadId: unknown, businessId: unknown): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다.' }
  if (!(await featureOn(user, 'finance_upload', text(businessId, 40)))) return { error: OFF }
  const id = text(uploadId, 64)
  if (!UUID.test(id)) return { error: '올리기를 알 수 없습니다.' }
  try {
    const repo = await getRepository()
    if (!(await ownsUpload(repo, text(businessId, 40), id))) return { error: '올리기를 알 수 없습니다.' }
    await repo.finUploadCancel(id)
    revalidatePath(`/finance/${text(businessId, 40)}/upload`)
    return { ok: true }
  } catch (e) {
    return { error: finUploadError(e) }
  }
}

/**
 * 0089 «이 열은 무엇입니까?»의 답 — (회사, 종류) 열 맞춤에 더한다(머리글 글 → 칸 이름 · '-' = 쓰지 않음). 다음 올리기부터 그 열을 그 칸으로 읽는다.
 * 숫자는 받지 않는다. 판정은 DB(fin_column_map_save — 그 회사 장부를 쓰는 사람).
 */
export async function answerColumns(businessId: unknown, kind: unknown, answers: unknown): Promise<{ ok?: true; error?: string; saved?: number }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다.' }
  const biz = text(businessId, 40)
  if (!BIZ.test(biz)) return { error: '회사를 알 수 없습니다.' }
  if (!(await featureOn(user, 'finance_upload', biz))) return { error: OFF }
  if (!canKeepBooks(user, biz)) return { error: '이 회사의 재무를 넣을 권한이 없습니다.' }
  if (!isUploadKind(kind) || kind === 'ledger') return { error: '자료 종류를 알 수 없습니다.' }
  const keys = new Set(kindSpec(kind).fields.map((f) => f.key))
  const list = Array.isArray(answers) ? answers.slice(0, 20) : []
  const map: Record<string, string> = {}
  for (const a of list) {
    const label = labelKey(text((a as { label?: unknown })?.label, 60))
    const key = text((a as { key?: unknown })?.key, 40)
    if (!label || !(key === SKIP_COLUMN || keys.has(key))) continue
    map[label] = key
  }
  if (!Object.keys(map).length) return { error: '고른 열이 없습니다.' }
  try {
    const repo = await getRepository()
    await repo.saveFinColumnMap({ business_id: biz, kind, label_map: map, source: 'person' })
    revalidatePath(`/finance/${biz}/upload`)
    return { ok: true, saved: Object.keys(map).length }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (/unavailable/.test(m)) return { error: '아직 준비 중입니다(0089 반영 전) — 이번 파일은 그대로 저장되어 있습니다.' }
    return { error: finUploadError(e) }
  }
}
