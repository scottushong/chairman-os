'use server'

import { revalidatePath } from 'next/cache'

import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { aiLimits, realClassifier } from '@/lib/finance-upload/ai'
import { realDocReader } from '@/lib/finance-upload/ai-doc'
import { isUploadKind, kindSpec } from '@/lib/finance-upload/kinds'
import { encodeShape, ledgerLayoutByCode, ROW_ROLES, type LedgerLayout, type RowLabel } from '@/lib/finance-upload/ledger'
import { inboxPathOk } from '@/lib/finance-upload/inbox'
import { MSG, UPLOAD_MAX_BYTES } from '@/lib/finance-upload/open'
import { mapColumns, readRows, validate, type Classification } from '@/lib/finance-upload/pipeline'
import { finUploadError, fromGrid, processUpload, reinterpretPending, saveTxGroupsFor, type DocOptions, type FileCard } from '@/lib/finance-upload/process'
import { AUDIENCE_LABEL } from '@/lib/features'
import { featureOn, featureWhy } from '@/lib/features-server'
import { getRepository } from '@/lib/repository'
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
    const cards = await processUpload({ repo, businessId, fileName, bytes, classify: budget > 0 ? realClassifier(repo, businessId) : null, aiBudget: budget, docs, deadline })
    revalidatePath(`/finance/${businessId}/upload`)
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
  }
  return docs
}

export interface ApplyInput {
  uploadId: unknown
  businessId: unknown
  kind: unknown
  period: unknown
  /** 칸 이름 → 열 번호 — 사람이 바꿨으면 */
  columns?: unknown
  overlap: unknown
  reason?: unknown
}

export async function applyPendingUpload(input: ApplyInput): Promise<{ ok?: true; error?: string; problems?: string[] }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const id = text(input.uploadId, 64)
  const businessId = text(input.businessId, 40)
  if (!(await featureOn(user, 'finance_upload', businessId))) return { error: OFF }
  const kind = text(input.kind, 30)
  const period = text(input.period, 7)
  const overlap = text(input.overlap, 10) as 'none' | 'replace' | 'keep_old'
  const reason = text(input.reason, 500) || null
  if (!UUID.test(id) || !BIZ.test(businessId) || !isUploadKind(kind) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !['none', 'replace', 'keep_old'].includes(overlap)) {
    return { error: '종류 · 기간(YYYY-MM) · 겹침 선택을 확인하세요.' }
  }
  try {
    const repo = await getRepository()
    const pending = await repo.finUploadPending(id)
    if (!pending) return { error: '이미 처리했거나 볼 수 없는 올리기입니다.' }
    // 0080: 원료 숫자가 가려진 대기는 숫자 없는 줄만 돌려받는다 — 넣지 않는다(DB 트리거도 거부한다).
    if (pending.masked) return { error: MATERIAL_HIDDEN }
    const meta = pending.meta ?? {}
    const cols = input.columns && typeof input.columns === 'object' ? (input.columns as Record<string, unknown>) : null
    const chosen: Record<string, number> = {}
    if (cols) for (const [k, v] of Object.entries(cols)) if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 200) chosen[k] = v as number
    // 스위치는 화면이 보낸 회사로 봤다 — 그 올리기가 정말 그 회사 것이어야 한다(0073 리뷰 I1).
    const upload = (await repo.listFinUploads(businessId)).find((u) => u.upload_id === id)
    if (!upload) return { error: '이미 처리했거나 볼 수 없는 올리기입니다.' }
    const kindChanged = upload?.kind !== kind
    const colsChanged = !!cols && JSON.stringify(chosen) !== JSON.stringify(meta.columns ?? {})
    let rows = pending.rows
    let people = pending.people ?? null
    if ((kindChanged || colsChanged) && pending.grid) {
      // 사람이 종류 · 칸을 고쳤다 — 버리기 뒤 칸 격자로 다시 읽는다(숫자는 코드가 읽는다).
      const sheet = fromGrid(upload?.sheet_name ?? 'sheet', pending.grid)
      const headerRow = meta.header_row ?? 0
      const columns = colsChanged ? chosen : mapColumns(kindSpec(kind), sheet.rows[headerRow] ?? [])
      // 해석이 본 요약 줄 낱말 · 원장 칸은 그대로 쓰고, 사람이 고친 칸이 이긴다.
      const labels = (meta.labels ?? []).filter((l): l is RowLabel => (ROW_ROLES as readonly string[]).includes(l.role))
      // 리뷰(2026-10-14): 사람이 고른 원장 칸(계정 · 차변 · 대변)은 해석 · 코드 탐지보다 늘 이긴다(머리글 줄 · 날짜 · 잔액은 해석에서).
      const base = kind === 'ledger' ? (meta.ledger && !kindChanged ? { headerRow: meta.ledger.headerRow, cols: meta.ledger.cols, headCol: meta.ledger.headCol ?? null } : ledgerLayoutByCode(sheet)) : null
      const picked = colsChanged ? Object.fromEntries(Object.entries(chosen).filter(([k]) => ['account_code', 'account_name', 'debit', 'credit'].includes(k))) : {}
      const ledger: LedgerLayout | undefined =
        kind === 'ledger' ? { headerRow: base?.headerRow ?? headerRow, cols: { ...(base?.cols ?? {}), ...picked }, labels, headCol: base?.headCol ?? null } : undefined
      const cls: Classification = { kind, confidence: 'medium', headerRow, columns, reason: '사람이 고름', source: 'code', labels, ledger }
      const read = readRows(sheet, cls)
      const check = validate(kind, read, period)
      if (check.errors.length) return { error: '고친 종류 · 칸으로 다시 읽었더니 맞지 않습니다.', problems: check.errors }
      rows = read.rows as FinRow[]
      people = kind === 'payroll' ? (read.people as FinRow[]) : null
      // g. 배우기 — 시트 모양 → 사람이 고른 종류 · 칸 · 요약 줄 낱말(숫자 없음).
      if (meta.sig) await repo.saveFinUploadShape({ business_id: businessId, header_sig: meta.sig, sheet_name: upload?.sheet_name ?? null, kind, column_map: encodeShape(columns, ledger ?? (labels.length ? { headerRow, cols: {}, labels } : null)) }).catch((e) => console.error('[applyPendingUpload] shape', e))
    } else if (kindChanged) {
      return { error: '이 올리기는 칸 격자가 없어 종류를 바꿀 수 없습니다 — 파일을 다시 올려 주세요.' }
    } else if (meta.errors?.length) {
      return { error: '검증을 통과하지 못한 자료는 넣지 않습니다 — 칸을 고르거나 파일을 고쳐 다시 올리세요.', problems: meta.errors }
    }
    if (kind === 'payroll' && !people && !['Chairman', 'GroupCFO'].includes(user.role)) people = null
    // 0072: 손으로 넣기는 다섯째 조건이 없다(사람이 미리보기에서 «중복 의심»을 보고 넣는다 — dup_suspects null).
    // 원료 출고(material_issue)는 돌려받은 줄에 kg가 없다 — DB가 저장해 둔 대기 줄에서 줄 번호로 붙인다(0072 리뷰 C1).
    await repo.finUploadApply({
      business_id: businessId, kind, period, file_name: upload?.file_name ?? '', file_sha256: upload?.file_sha256 ?? '', sheet_name: upload?.sheet_name ?? null,
      ai_confidence: upload?.ai_confidence ?? 'none', ai_used: upload?.ai_used ?? 0, auto: false, rows, people, overlap, reason, upload_id: id, dup_suspects: null,
    })
    // 같은 거래 묶음(same · suspect) 저장 — suspect는 «같은 거래» 칸에서 사람이 정한다. 실패해도 넣기는 그대로.
    await saveTxGroupsFor(repo, businessId, kind, period, id, reason).catch((e) => console.error('[applyPendingUpload] tx groups', e))
    revalidatePath(`/finance/${businessId}/upload`)
    revalidatePath(`/finance/${businessId}/valuation`)
    return { ok: true }
  } catch (e) {
    console.error('[applyPendingUpload]', e)
    const m = e instanceof Error ? e.message : ''
    if (m.includes('fin_upload_overlap')) return { error: '같은 달에 이미 넣은 자료가 있습니다 — «새 값으로 바꾸기» 또는 «기존 값 두기»를 고르세요.' }
    if (m.includes('fin_upload_closed')) return { error: '마감된 달입니다 — 대표 · CFO가 이유를 적어야 넣을 수 있습니다.' }
    if (m.includes('ledger_post_live') || m.includes('cost_candidate_live')) return { error: '이 자료의 줄이 장부 반영 · 원가 LOT로 이미 쓰였습니다 — 그쪽을 먼저 무효로 하세요.' }
    if (m.includes('fin_replace_restricted')) return { error: '원료 출고 · 재고 자료의 «바꾸기»는 대표 · CFO만 합니다 — «기존 값 두기»를 고르거나 대표 · CFO에게 요청하세요.' }
    if (m.includes('fin_material_hidden')) return { error: MATERIAL_HIDDEN }
    if (m.includes('fin_valuation_final_exists')) return { error: '그 구분의 확정된 평가금액이 이미 있습니다 — «재고 · 평가» 화면에서 이유를 적고 바꾸세요.' }
    if (m.includes('fin_value_state')) return { error: '빈칸 · 0 표시가 맞지 않는 칸이 있습니다(빈칸은 0이 아닙니다).' }
    return { error: finUploadError(e) }
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
    revalidatePath(`/finance/${text(businessId, 40)}/upload`)
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
    const out = await reinterpretPending({ repo, businessId: biz, classify: budget > 0 ? realClassifier(repo, biz) : null, aiBudget: budget, deadline: Date.now() + 280_000 }, id)
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
