'use server'

import { revalidatePath } from 'next/cache'

import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { aiLimits, realClassifier } from '@/lib/finance-upload/ai'
import { realDocReader } from '@/lib/finance-upload/ai-doc'
import { isUploadKind, kindSpec } from '@/lib/finance-upload/kinds'
import { UPLOAD_MAX_BYTES } from '@/lib/finance-upload/open'
import { mapColumns, readRows, validate, type Classification } from '@/lib/finance-upload/pipeline'
import { finUploadError, fromGrid, processUpload, saveTxGroupsFor, type DocOptions, type FileCard } from '@/lib/finance-upload/process'
import { featureOn } from '@/lib/features-server'
import { getRepository } from '@/lib/repository'
import type { FinRow, FinUpload } from '@/types'

/** 0073 기능 스위치로 꺼진 기능의 문장. */
const OFF = '지금은 쓸 수 없는 기능입니다.'

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

export async function uploadFinanceFiles(form: FormData): Promise<UploadResult> {
  const user = await currentUser()
  if (!user) return { cards: [], error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const businessId = text(form.get('business_id'), 40)
  if (!BIZ.test(businessId)) return { cards: [], error: '회사를 알 수 없습니다.' }
  // 0073 기능 스위치 «자료 올리기» — 꺼져 있으면 거부(화면도 404).
  if (!(await featureOn(user, 'finance_upload', businessId))) return { cards: [], error: OFF }
  if (!canKeepBooks(user, businessId)) return { cards: [], error: '이 회사의 재무를 넣을 권한이 없습니다.' }
  const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, 10)
  if (!files.length) return { cards: [], error: '파일을 놓아 주세요.' }
  const repo = await getRepository()
  // 하루 AI 한도 — 이 회사의 오늘(KST) 올리기의 AI 호출 합.
  const { perFile, perDay } = aiLimits()
  const today = kstDay(new Date().toISOString())
  const usedToday = (await repo.listFinUploads(businessId).catch(() => [] as FinUpload[])).filter((u) => kstDay(u.created_at) === today).reduce((a, u) => a + u.ai_used, 0)
  let dayLeft = Math.max(0, perDay - usedToday)
  const classify = realClassifier(repo, businessId)
  // C단계 PDF · 사진 — 기능 스위치 «PDF · 사진 읽기»(0073, 기본 대표만). 꺼지면 «준비 중», 엑셀은 그대로. 한도 env가 없으면 읽기 도구 없음(→ 미리보기).
  const allowed = await featureOn(user, 'finance_docs', businessId)
  const docs: DocOptions = { allowed, read: allowed && perFile > 0 && perDay > 0 ? realDocReader(repo, businessId) : null }
  if (allowed && files.some((f) => /\.(pdf|jpe?g|png)$/i.test(f.name) || /^(application\/pdf|image\/)/.test(f.type))) {
    // 회사 이름 대조 · 공식 결산 계정 맞추기 — PDF · 사진이 있을 때만 읽는다.
    const [businesses, ledger] = await Promise.all([repo.listBusinesses().catch(() => []), repo.loadFinanceLedger().catch(() => null)])
    docs.businessName = businesses.find((b) => b.business_id === businessId)?.name
    docs.accounts = (ledger?.accounts ?? []).filter((a) => a.business_id === businessId && a.active).map((a) => ({ account_code: a.account_code, name: a.name, section: a.section }))
  }
  const cards: FileCard[] = []
  for (const file of files) {
    if (file.size > UPLOAD_MAX_BYTES) {
      cards.push({ file_name: file.name, sheet: null, kind: 'unknown', period: null, status: 'failed', upload_id: null, rows: 0, message: '20MB가 넘는 파일입니다.', why: [], ai_used: 0, confidence: 'none' })
      continue
    }
    const budget = Math.min(perFile, dayLeft)
    try {
      const out = await processUpload({ repo, businessId, fileName: file.name.slice(0, 255), bytes: new Uint8Array(await file.arrayBuffer()), classify: budget > 0 ? classify : null, aiBudget: budget, docs })
      dayLeft -= out.reduce((a, c) => a + c.ai_used, 0)
      cards.push(...out)
    } catch (e) {
      console.error('[uploadFinanceFiles]', e)
      cards.push({ file_name: file.name, sheet: null, kind: 'unknown', period: null, status: 'failed', upload_id: null, rows: 0, message: finUploadError(e), why: [], ai_used: 0, confidence: 'none' })
    }
  }
  revalidatePath(`/finance/${businessId}/upload`)
  return { cards }
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
    const meta = pending.meta ?? {}
    const cols = input.columns && typeof input.columns === 'object' ? (input.columns as Record<string, unknown>) : null
    const chosen: Record<string, number> = {}
    if (cols) for (const [k, v] of Object.entries(cols)) if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 200) chosen[k] = v as number
    const upload = (await repo.listFinUploads(businessId)).find((u) => u.upload_id === id)
    const kindChanged = upload?.kind !== kind
    const colsChanged = !!cols && JSON.stringify(chosen) !== JSON.stringify(meta.columns ?? {})
    let rows = pending.rows
    let people = pending.people ?? null
    if ((kindChanged || colsChanged) && pending.grid) {
      // 사람이 종류 · 칸을 고쳤다 — 버리기 뒤 칸 격자로 다시 읽는다(숫자는 코드가 읽는다).
      const sheet = fromGrid(upload?.sheet_name ?? 'sheet', pending.grid)
      const headerRow = meta.header_row ?? 0
      const columns = colsChanged ? chosen : mapColumns(kindSpec(kind), sheet.rows[headerRow] ?? [])
      const cls: Classification = { kind, confidence: 'medium', headerRow, columns, reason: '사람이 고름', source: 'code' }
      const read = readRows(sheet, cls)
      const check = validate(kind, read, period)
      if (check.errors.length) return { error: '고친 종류 · 칸으로 다시 읽었더니 맞지 않습니다.', problems: check.errors }
      rows = read.rows as FinRow[]
      people = kind === 'payroll' ? (read.people as FinRow[]) : null
      // g. 배우기 — 시트 모양 → 사람이 고른 종류 · 칸(숫자 없음).
      if (meta.sig) await repo.saveFinUploadShape({ business_id: businessId, header_sig: meta.sig, sheet_name: upload?.sheet_name ?? null, kind, column_map: columns }).catch((e) => console.error('[applyPendingUpload] shape', e))
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
    if (m.includes('fin_valuation_final_exists')) return { error: '그 구분의 확정된 평가금액이 이미 있습니다 — «재고 · 평가» 화면에서 이유를 적고 바꾸세요.' }
    if (m.includes('fin_value_state')) return { error: '빈칸 · 0 표시가 맞지 않는 칸이 있습니다(빈칸은 0이 아닙니다).' }
    return { error: finUploadError(e) }
  }
}

export async function revertUpload(uploadId: unknown, businessId: unknown, reason: unknown): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다.' }
  if (!(await featureOn(user, 'finance_upload', text(businessId, 40)))) return { error: OFF }
  const id = text(uploadId, 64)
  if (!UUID.test(id)) return { error: '올리기를 알 수 없습니다.' }
  try {
    const ok = await (await getRepository()).finUploadRevert(id, text(reason, 500) || null)
    revalidatePath(`/finance/${text(businessId, 40)}/upload`)
    return ok ? { ok: true } : { error: '이미 되돌렸거나 넣은 것이 아닙니다.' }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (m.includes('fin_upload_revert_expired')) return { error: '넣은 지 7일이 지나 되돌릴 수 없습니다 — 정정 자료를 올리세요.' }
    if (m.includes('fin_upload_closed')) return { error: '마감된 달은 대표 · CFO만 되돌립니다.' }
    return { error: finUploadError(e) }
  }
}

export async function cancelUpload(uploadId: unknown, businessId: unknown): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다.' }
  if (!(await featureOn(user, 'finance_upload', text(businessId, 40)))) return { error: OFF }
  const id = text(uploadId, 64)
  if (!UUID.test(id)) return { error: '올리기를 알 수 없습니다.' }
  try {
    await (await getRepository()).finUploadCancel(id)
    revalidatePath(`/finance/${text(businessId, 40)}/upload`)
    return { ok: true }
  } catch (e) {
    return { error: finUploadError(e) }
  }
}
