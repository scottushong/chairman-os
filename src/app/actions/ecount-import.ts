'use server'

import { revalidatePath } from 'next/cache'

import { ATTACHMENT_MIME } from '@/lib/attachments/rules'
import { canImportEcount, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { ecountAuditNote, ecountFileProblem } from '@/lib/ecount/excel/file-rules'
import {
  EcountExcelError,
  outlineWorkbook,
  readEcountWorkbook,
  sha256Hex,
  type EcountSheet,
  type SheetOutline,
} from '@/lib/ecount/excel/workbook'
import { getRepository, type ChairmanRepository } from '@/lib/repository'
import { FINANCE_IMPORT_KIND, FINANCE_IMPORT_KIND_LABEL_KO, type FinanceImport, type FinanceImportKind, type SessionUser } from '@/types'

/**
 * ECOUNT 엑셀 업로드 — 공통 기반(설계서 docs/superpowers/specs/2026-10-02-ecount-excel-import.md A절 · E절 1단계).
 *
 * 흐름(서버가 원본을 두 번 읽는다):
 *   1. startEcountImport   → finance_imports draft 한 줄(0050)
 *   2. beginAttachment(entity_table='finance_imports') → 브라우저가 Storage로 직접 업로드. **AI 요약은 부르지 않는다.**
 *   3. previewEcountImport → 서버가 Storage에서 원본을 다시 읽어 sha256 · 개요를 적는다(DB 쓰기는 그 draft 한 줄뿐)
 *   4. commitEcountImport  → 같은 원본을 다시 읽고 sha256이 미리보기 때와 같은지 본 뒤 대상별 등록
 *   5. cancelEcountImport  → 원본 첨부 취소 **먼저** → cancelled(0050 머리 주석 :25 — cancelled 뒤에는 원본을 못 지운다)
 *
 * **대상별(계정과목 · 연간 · 월별) 파싱 · 판정 · 등록 RPC는 아직 없다** — 열 구성(ECOUNT 화면 캡처) 확인 뒤
 * 단계마다 KIND_STAGES에 붙인다. 그 전까지 미리보기 · 등록은 공통부까지 하고 «아직 지원하지 않는 종류»로 멈춘다.
 *
 * 믿지 않는 것: 화면이 보낸 business_id · import_id · 행. 회사는 업로드 줄(DB가 RLS로 내준 것)에서 다시 읽고,
 * 업로드는 «본인 · draft · 그 회사 장부 권한»을 매번 다시 판정한다. 최종 판정은 0050 RLS(can_keep_books)다.
 */

export interface EcountImportState {
  error?: string
  importId?: string
}

export interface EcountPreviewState extends EcountImportState {
  /** 공통부가 읽은 시트 개요(금액 원문 없음). */
  outline?: SheetOutline[]
  /** 대상별 미리보기가 아직 없으면 true(error에 «아직 지원하지 않는 종류») — 화면이 «미리보기: 열 구성 확인 후 제공»을 보여 준다. */
  pending?: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 직원 화면이다 — «회장»이 아니라 «대표»(CLAUDE.md 직원 화면 용어 원칙). statements.ts와 같은 문장. */
const NO_BOOKS = '이 회사의 재무를 넣을 권한이 없습니다. (대표 · 그룹 CFO · 해당 회사 대표이사 · 대표가 재무 입력 권한을 준 사람)'
const UNSUPPORTED = '아직 지원하지 않는 종류입니다 — 미리보기와 등록은 ECOUNT 열 구성을 확인한 뒤 제공합니다.'

function denied(where: string, e: unknown, fallback: string): EcountImportState {
  console.error(`[ecount-import] ${where}`, e)
  const m = e instanceof Error ? e.message : ''
  if (/42501|row-level security|permission denied/.test(m)) return { error: NO_BOOKS }
  if (/finance_import_closed/.test(m)) return { error: '이미 등록되었거나 취소된 업로드입니다. 다시 올리려면 새로 시작하세요.' }
  if (/finance_import_hash_immutable/.test(m)) return { error: '미리보기 때와 다른 파일입니다. 취소하고 새로 올리세요.' }
  if (/PGRST205|42P01/.test(m)) return { error: 'ECOUNT 업로드 준비가 아직 끝나지 않았습니다(DB 반영 전). 잠시 후 다시 시도하세요.' }
  return { error: fallback }
}

function importPath(businessId: string) {
  return `/finance/${encodeURIComponent(businessId)}/import`
}

/** 본인의 진행 중(draft) 업로드 + 그 회사 장부 권한. 회사는 화면이 아니라 업로드 줄에서 읽는다. */
async function ownDraft(
  repo: ChairmanRepository,
  user: SessionUser,
  importId: unknown,
): Promise<{ imp: FinanceImport } | { error: string }> {
  if (typeof importId !== 'string' || !UUID.test(importId)) return { error: '어떤 업로드인지 알 수 없습니다.' }
  // RLS(can_read_books)가 안 보이는 회사의 업로드를 주지 않는다 — 없음과 볼 수 없음을 가르지 않는다.
  const imp = await repo.getFinanceImport(importId)
  if (!imp) return { error: '업로드를 찾지 못했습니다.' }
  if (imp.status !== 'draft') return { error: '이미 등록되었거나 취소된 업로드입니다. 다시 올리려면 새로 시작하세요.' }
  if (imp.created_by !== user.user_id) return { error: '올린 사람만 이 업로드를 이어 가거나 취소할 수 있습니다.' }
  if (!canImportEcount(user, imp.business_id)) return { error: NO_BOOKS }
  return { imp }
}

/**
 * 원본을 Storage에서 **서버가 다시** 읽는다. 원본은 업로드 한 건에 하나(beginAttachment가 둘째를 막는다) —
 * 둘 이상이면 어느 파일을 읽을지 흐려지므로 멈춘다. 읽기는 올린 본인 세션이다(0045 — 올린 사람은 통행증 없이 연다).
 */
async function readOriginal(
  repo: ChairmanRepository,
  imp: FinanceImport,
  user: SessionUser,
): Promise<{ bytes: Uint8Array; sha: string; fileName: string } | { error: string }> {
  const files = await repo.listAttachments('finance_imports', imp.import_id)
  if (files.length === 0) return { error: '원본 파일이 아직 올라가지 않았습니다. 취소하고 새로 올리세요.' }
  if (files.length > 1) return { error: '원본이 둘 이상입니다. 취소하고 새로 올리세요.' }
  const file = files[0]
  // 회사는 DB 트리거가 업로드에서 낸 값이다(0050 attachments_stamp) — 어긋나면 읽지 않는다.
  if (file.business_id !== imp.business_id) return { error: '원본의 회사가 업로드와 다릅니다. 취소하고 새로 올리세요.' }
  if (file.uploaded_by !== user.user_id) return { error: '원본을 올린 사람이 업로드를 만든 사람과 다릅니다. 취소하고 새로 올리세요.' }
  if (file.mime !== ATTACHMENT_MIME.xlsx) return { error: '원본이 엑셀(xlsx)이 아닙니다. 취소하고 새로 올리세요.' }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await repo.readAttachmentObject(file.storage_path))
  } catch (e) {
    console.error('[ecount-import] 원본 읽기', e)
    return { error: '원본 파일을 읽지 못했습니다(업로드가 끝나지 않았을 수 있습니다). 취소하고 새로 올리세요.' }
  }
  // 줄은 섰는데 바이트가 다 오지 않은 경우 — 반쪽 파일을 파싱하지 않는다.
  if (bytes.byteLength !== file.size_bytes) return { error: '원본 파일이 다 올라가지 않았습니다. 취소하고 새로 올리세요.' }
  return { bytes, sha: sha256Hex(bytes), fileName: file.file_name }
}

async function parse(bytes: Uint8Array): Promise<{ sheets: EcountSheet[] } | { error: string }> {
  try {
    return { sheets: await readEcountWorkbook(bytes) }
  } catch (e) {
    if (e instanceof EcountExcelError) return { error: e.message }
    console.error('[ecount-import] 파싱', e)
    return { error: '엑셀 파일을 읽지 못했습니다. 엑셀에서 열어 xlsx로 다시 저장한 뒤 올리세요.' }
  }
}

/**
 * 대상별 단계 — 열 구성 확인 뒤 하나씩 붙인다(설계서 B · E 2~4단계). 비어 있는 종류는 «아직 지원하지 않는 종류».
 *   preview  파싱한 시트 → 판정(차단 · 경고 · 매핑 제안). DB 쓰기 없음.
 *   commit   같은 판정을 다시 한 뒤 대상별 RPC 한 트랜잭션(감사 note = ecountAuditNote). committed 전이는 RPC가 한다.
 */
interface KindStage {
  preview(ctx: { imp: FinanceImport; sheets: EcountSheet[] }): Promise<EcountPreviewState>
  commit(ctx: { imp: FinanceImport; sheets: EcountSheet[]; sha: string; note: (period: string | null) => string }): Promise<EcountImportState>
}
const KIND_STAGES: Partial<Record<FinanceImportKind, KindStage>> = {}

export async function startEcountImport(businessId: unknown, kind: unknown, fileName: unknown): Promise<EcountImportState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const business_id = typeof businessId === 'string' ? businessId.trim() : ''
  const file_name = typeof fileName === 'string' ? fileName.trim().slice(0, 255) : ''
  if (!FINANCE_IMPORT_KIND.includes(kind as FinanceImportKind)) return { error: '무엇을 올리는지 알 수 없습니다.' }
  if (!business_id) return { error: '어느 회사의 업로드인지 알 수 없습니다.' }
  if (!file_name) return { error: '파일 이름이 없습니다.' }
  const fileProblem = ecountFileProblem(file_name)
  if (fileProblem) return { error: fileProblem }
  // ECOUNT 코드 체계 회사 + 그 회사 장부 권한(안내). 최종 판정은 0050 finance_imports_insert(can_keep_books).
  if (!canImportEcount(user, business_id)) {
    return { error: canKeepBooks(user, business_id) ? 'ECOUNT 업로드는 ECOUNT를 쓰는 회사만 합니다.' : NO_BOOKS }
  }

  try {
    const repo = await getRepository()
    // 보이는 회사인가(0002 has_business) — 화면이 보낸 id를 그대로 믿지 않는다.
    if (!(await repo.listBusinesses()).some((b) => b.business_id === business_id)) return { error: '회사를 찾지 못했습니다.' }
    const imp = await repo.createFinanceImport(
      { business_id, kind: kind as FinanceImportKind, file_name },
      { user_id: user.user_id, role: user.role },
    )
    // 화면 갱신은 올리기가 끝난 뒤 한 번(원본 없는 draft가 목록에 잠깐 서지 않게) — 업로드 단이 router.refresh한다.
    return { importId: imp.import_id }
  } catch (e) {
    return denied('start', e, '업로드를 시작하지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}

/** 취소 — 원본 첨부를 먼저 지우고(draft일 때만 지워진다) cancelled로. 첨부를 못 지우면 취소하지 않는다. */
export async function cancelEcountImport(importId: unknown): Promise<EcountImportState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const own = await ownDraft(repo, user, importId)
    if ('error' in own) return own
    const actor = { user_id: user.user_id, role: user.role }
    for (const a of await repo.listAttachments('finance_imports', own.imp.import_id)) {
      try {
        await repo.deleteAttachment(a.attachment_id, actor)
      } catch (e) {
        console.error('[ecount-import] 원본 취소', e)
        return { error: '원본 파일을 지우지 못해 취소하지 않았습니다. 잠시 후 다시 시도하세요.' }
      }
    }
    await repo.cancelFinanceImport(own.imp.import_id, actor)
    revalidatePath(importPath(own.imp.business_id))
    revalidatePath('/documents')
    return { importId: own.imp.import_id }
  } catch (e) {
    return denied('cancel', e, '취소하지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}

/** 미리보기 — 공통부(원본 다시 읽기 · sha256 · 개요 기록)까지. 대상별 판정은 열 구성 확인 뒤. */
export async function previewEcountImport(importId: unknown): Promise<EcountPreviewState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const own = await ownDraft(repo, user, importId)
    if ('error' in own) return own
    const { imp } = own
    const original = await readOriginal(repo, imp, user)
    if ('error' in original) return original
    // 한 번 적힌 해시와 다르면 다른 파일이다(0050 — 해시는 못 바꾼다).
    if (imp.file_sha256 && imp.file_sha256 !== original.sha) return { error: '미리보기 때와 다른 파일입니다. 취소하고 새로 올리세요.' }
    const parsed = await parse(original.bytes)
    if ('error' in parsed) return parsed

    const outline = outlineWorkbook(parsed.sheets)
    await repo.recordFinanceImportPreview(
      imp.import_id,
      { file_sha256: original.sha, summary: { stage: 'outline', sheets: outline } },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath(importPath(imp.business_id))

    const stage = KIND_STAGES[imp.kind]
    // 공통부는 끝났다(원본 · 해시 · 개요). 대상별 판정이 없으면 «아직 지원하지 않는 종류» — 화면은 pending을 보고
    // 빨간 오류가 아니라 «미리보기: 열 구성 확인 후 제공» 상태로 그린다.
    if (!stage) return { importId: imp.import_id, outline, pending: true, error: `${FINANCE_IMPORT_KIND_LABEL_KO[imp.kind]}: ${UNSUPPORTED}` }
    return { ...(await stage.preview({ imp, sheets: parsed.sheets })), importId: imp.import_id, outline }
  } catch (e) {
    return denied('preview', e, '미리보기를 만들지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}

/**
 * 등록 — 같은 원본을 다시 읽고 다시 판정한다. 화면이 보낸 행은 받지 않는다(받는 것은 import_id뿐).
 * 미리보기가 적은 sha256과 지금 읽은 파일이 같아야 한다.
 */
export async function commitEcountImport(importId: unknown): Promise<EcountImportState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const own = await ownDraft(repo, user, importId)
    if ('error' in own) return own
    const { imp } = own
    if (!imp.file_sha256) return { error: '미리보기를 먼저 하세요.' }
    const original = await readOriginal(repo, imp, user)
    if ('error' in original) return original
    if (original.sha !== imp.file_sha256) return { error: '미리보기 때와 다른 파일입니다. 취소하고 새로 올리세요.' }

    const stage = KIND_STAGES[imp.kind]
    if (!stage) return { error: `${FINANCE_IMPORT_KIND_LABEL_KO[imp.kind]}: ${UNSUPPORTED}` }

    const parsed = await parse(original.bytes)
    if ('error' in parsed) return parsed
    const note = (period: string | null) =>
      ecountAuditNote({ kind: imp.kind, period, fileName: original.fileName, importId: imp.import_id })
    const result = await stage.commit({ imp, sheets: parsed.sheets, sha: original.sha, note })
    const base = `/finance/${encodeURIComponent(imp.business_id)}`
    revalidatePath(importPath(imp.business_id))
    revalidatePath(base, 'layout')
    revalidatePath('/finance')
    return { ...result, importId: imp.import_id }
  } catch (e) {
    return denied('commit', e, '등록하지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}
