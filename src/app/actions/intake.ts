'use server'

import { revalidatePath } from 'next/cache'

import { ATTACHMENT_MAX_BYTES, attachmentMime } from '@/lib/attachments/rules'
import { currentUser } from '@/lib/auth/session'
import { readIntake } from '@/lib/intake/read'
import { getRepository } from '@/lib/repository'
import { INTAKE_KIND, INTAKE_KIND_DOC_TYPE, type IntakeKind } from '@/types'

/**
 * 자료 받는 입구 Server Action(0058 · 설계서 A1 · B③④).
 *
 * 권한을 여기서 판정하지 않는다 — 0058 RLS · stamp · RPC가 한다. 여기서는 입력의 모양만 거르고 DB의 거부를 사람의 말로 바꾼다.
 * 문장은 직원에게 보이는 말이다 — 회장을 «대표»로 쓴다(CLAUDE.md 직원 화면 용어 원칙). 회장 화면은 bossText로 되돌린다.
 *
 * 올리기는 세 걸음(첨부와 같은 길): beginIntakeAction(입구 줄 + 첨부 줄 — intake_begin 한 트랜잭션) → 바이트(live: 브라우저가
 * Storage로 바로 · dummy: attachments.ts uploadAttachmentBytes) → readIntakeAction. 바이트가 실패하면 첨부를 지운다(입구 줄도 같이).
 */

export interface IntakeActionState {
  error?: string
}

/** DB의 거부 낱말 → 사람의 말. 모르는 것은 fallback. */
function explain(e: unknown, fallback: string): IntakeActionState {
  console.error('[intake]', e)
  const m = e instanceof Error ? e.message : String(e)
  const table: [RegExp, string][] = [
    [/intake_document_write_forbidden/, '이 회사 문서를 등록할 권한이 없습니다 — 문서 등록 권한자에게 넘기세요(대표가 사용자 화면의 «모듈 권한 → 문서»에서 켭니다).'],
    [/intake_ai_blocked/, '«AI 안 보냄»으로 막힌 파일은 대표만 문서로 넣습니다.'],
    [/intake_ai_unblock_forbidden/, '«AI 안 보냄» 차단은 대표만 풉니다(사진 · 스캔본의 «배합비 아님» 확인 없음은 올린 사람의 확인이 풉니다).'],
    [/intake_mix_attest_uploader_only/, '«배합비 · 레시피가 아닙니다» 확인은 파일을 올린 사람만 누릅니다.'],
    [/intake_already_loaded/, '이미 다른 메뉴로 넣은 파일입니다.'],
    [/intake_loaded_locked/, '이미 넣은 파일입니다 — 문서를 지워(되돌려) 입구로 돌린 뒤에 고칩니다.'],
    [/intake_kind_missing/, '종류를 먼저 고르세요.'],
    [/intake_not_ready/, '아직 읽는 중입니다. 잠시 뒤 다시 누르세요.'],
    [/intake_not_found/, '입구 줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).'],
    [/intake_title_invalid/, '문서 제목을 1~300자로 적으세요.'],
    [/intake_status_back_to_uploaded/, '읽기 전 상태로는 되돌릴 수 없습니다.'],
    [/intake_items_class_check|attachments_class/, 'Vault 파일은 입구로 받지 않습니다. 문서 화면에서 링크로 등록하세요.'],
    [/attachments_(mime|size)/, '받지 않는 파일입니다. (PDF · Word · Excel · PowerPoint · JPG · PNG, 20MB까지)'],
    [/row-level security|42501|permission denied/, '권한이 없습니다. (이 회사가 보이지 않거나, 이 등급을 다룰 수 없거나, 올린 사람 · 확인 권한자 · 대표가 아닙니다)'],
  ]
  return { error: table.find(([re]) => re.test(m))?.[1] ?? fallback }
}

async function who() {
  const user = await currentUser()
  return user ? { user, actor: { user_id: user.user_id, role: user.role } } : null
}

const pathOf = (businessId: string) => `/business/${encodeURIComponent(businessId)}`

export interface BeginIntakeResult extends IntakeActionState {
  itemId?: string
  attachmentId?: string
  path?: string
}

export async function beginIntakeAction(input: unknown): Promise<BeginIntakeResult> {
  const f = (input ?? {}) as Record<string, unknown>
  const business_id = typeof f.business_id === 'string' ? f.business_id.trim() : ''
  const file_name = typeof f.file_name === 'string' ? f.file_name.trim().slice(0, 255) : ''
  const size_bytes = typeof f.size_bytes === 'number' ? Math.floor(f.size_bytes) : 0
  const security_class = f.security_class
  const mime = attachmentMime(file_name, typeof f.mime === 'string' ? f.mime : '')
  const sha = typeof f.file_sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.file_sha256) ? f.file_sha256 : null

  if (!/^[a-z0-9_]{1,64}$/.test(business_id)) return { error: '어느 회사의 입구인지 알 수 없습니다.' }
  if (security_class === 'Vault') return { error: 'Vault 파일은 올리지 않습니다. 문서 화면에서 링크로 등록하세요.' }
  if (security_class !== 'Normal' && security_class !== 'Restricted') return { error: '등급을 고르세요.' }
  if (!file_name) return { error: '파일 이름이 없습니다.' }
  if (!mime) return { error: 'PDF · Word · Excel · PowerPoint · JPG · PNG만 받습니다.' }
  if (size_bytes < 1 || size_bytes > ATTACHMENT_MAX_BYTES) return { error: '20MB까지 올릴 수 있습니다.' }

  const me = await who()
  if (!me) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const r = await (await getRepository()).beginIntake(
      { business_id, security_class, file_name, mime, size_bytes, file_sha256: sha, mix_attested: f.mix_attested === true },
      me.actor,
    )
    return { itemId: r.item_id, attachmentId: r.attachment_id, path: r.storage_path }
  } catch (e) {
    return explain(e, '올리지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}

/** 바이트가 안 올라갔을 때 — 첨부를 지우면 입구 줄도 같이 간다(0058 FK cascade). */
export async function cancelIntakeAction(attachmentId: string): Promise<IntakeActionState> {
  const me = await who()
  if (!me) return {}
  try {
    await (await getRepository()).deleteAttachment(attachmentId, me.actor)
  } catch (e) {
    console.error('[intake] 취소 실패', e)
  }
  return {}
}

export interface ReadIntakeState extends IntakeActionState {
  status?: string
  message?: string
}

/** 읽기 한 번(처음이든 «다시 읽기»든). 실패해도 파일은 남는다 — failed와 이유 문장 · «직접 종류 고르기». */
export async function readIntakeAction(itemId: string): Promise<ReadIntakeState> {
  return runRead(itemId)
}

async function runRead(itemId: string, opts: { chairmanOverrodeMix?: boolean } = {}): Promise<ReadIntakeState> {
  const me = await who()
  if (!me) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const repo = await getRepository()
  const item = await repo.getIntakeItem(itemId).catch(() => null)
  if (!item) return { error: '입구 줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).' }
  const r = await readIntake(repo, itemId, me.actor, opts)
  revalidatePath(pathOf(item.business_id))
  return { status: r.status, message: r.message }
}

/** 사진 · 스캔본 «배합비 · 레시피가 아닙니다»(올린 사람만) → 곧바로 읽기. not_attested 차단은 이 확인이 푼다(0058). */
export async function attestIntakeAction(itemId: string): Promise<ReadIntakeState> {
  const me = await who()
  if (!me) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const repo = await getRepository()
  try {
    await repo.updateIntakeItem(itemId, { mix_attested: true }, me.actor)
  } catch (e) {
    return explain(e, '확인을 적지 못했습니다.')
  }
  return readIntakeAction(itemId)
}

/** 대표가 «AI 안 보냄»을 푼다(이유와 무관) → 곧바로 읽기. 감지가 다시 돈다(글자 파일이면 또 걸릴 수 있다). */
export async function liftIntakeBlockAction(itemId: string): Promise<ReadIntakeState> {
  const me = await who()
  if (!me) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (me.user.role !== 'Chairman') return { error: '«AI 안 보냄» 차단은 대표만 풉니다.' }
  const repo = await getRepository()
  let wasMix = false
  try {
    const item = await repo.getIntakeItem(itemId)
    if (!item) return { error: '입구 줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).' }
    wasMix = item.ai_blocked_reason === 'mix_ratio'
    await repo.updateIntakeItem(itemId, { status: 'reading' }, me.actor)
  } catch (e) {
    return explain(e, '차단을 풀지 못했습니다.')
  }
  // 배합비 감지를 대표가 «배합비 아님»으로 풀었으면 같은 규칙으로 다시 걸지 않는다(잘못 걸음 — 지분표 등). 모델 판정은 그대로.
  return runRead(itemId, { chairmanOverrodeMix: wasMix })
}

/** 종류 확인 · 바꾸기(«직접 종류 고르기» 포함). 문서 종류는 다시 읽지 않는다(설계서 A1-3). 실패 · 읽기 전 줄은 «제안»으로. */
export async function setIntakeKindAction(itemId: string, kind: unknown): Promise<IntakeActionState> {
  const me = await who()
  if (!me) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (!INTAKE_KIND.includes(kind as IntakeKind)) return { error: '종류를 고르세요.' }
  const repo = await getRepository()
  try {
    const item = await repo.getIntakeItem(itemId)
    if (!item) return { error: '입구 줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).' }
    // 읽기 실패 · 읽기 전 줄을 사람이 분류하면 «제안» 단계로 — AI 없이도 끝까지 갈 수 있다(A6). no_ai 줄은 상태를 두고 종류만.
    const status = item.status === 'failed' || item.status === 'uploaded' || item.status === 'kept' ? 'proposed' : undefined
    await repo.updateIntakeItem(itemId, { kind: kind as IntakeKind, ...(status ? { status } : {}) }, me.actor)
    revalidatePath(pathOf(item.business_id))
    return {}
  } catch (e) {
    return explain(e, '종류를 바꾸지 못했습니다.')
  }
}

/** «입구에만 두기» — 보관(kept). 재무제표 · 단가표는 이 블록에서 그 메뉴로 넣지 않는다. */
export async function keepIntakeAction(itemId: string): Promise<IntakeActionState> {
  const me = await who()
  if (!me) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const repo = await getRepository()
  try {
    const item = await repo.getIntakeItem(itemId)
    if (!item) return { error: '입구 줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).' }
    await repo.updateIntakeItem(itemId, { status: 'kept' }, me.actor)
    revalidatePath(pathOf(item.business_id))
    return {}
  } catch (e) {
    return explain(e, '보관하지 못했습니다.')
  }
}

export interface LoadIntakeResult extends IntakeActionState {
  documentId?: string
}

/**
 * 확인 → 문서(intake_move_to_document). 종류가 아직 없으면 제안의 종류(«이 메뉴에 초안 만들기»)나 'other'(«그냥 보관(문서)»)를
 * 먼저 확인 도장으로 적는다 — 확인한 사람이 곧 적재한 사람이다. 등록 권한(0048)은 RPC가 판정한다.
 */
export async function loadIntakeToDocumentAction(itemId: string, input: unknown): Promise<LoadIntakeResult> {
  const me = await who()
  if (!me) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const f = (input ?? {}) as Record<string, unknown>
  const title = typeof f.title === 'string' ? f.title.trim().slice(0, 300) : ''
  const asPlainDocument = f.plain === true
  if (!title) return { error: '문서 제목을 적으세요.' }
  const repo = await getRepository()
  try {
    const item = await repo.getIntakeItem(itemId)
    if (!item) return { error: '입구 줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).' }
    const kind: IntakeKind = item.kind ?? (asPlainDocument ? 'other' : (item.proposal?.kind ?? 'other'))
    if (item.kind !== kind) await repo.updateIntakeItem(itemId, { kind }, me.actor)
    const docType =
      typeof f.doc_type === 'string' && f.doc_type.trim()
        ? f.doc_type.trim().slice(0, 60)
        : (item.proposal?.fields.doc_type ?? (asPlainDocument ? '기타' : INTAKE_KIND_DOC_TYPE[kind]))
    const documentId = await repo.moveIntakeToDocument(itemId, { title, doc_type: docType }, me.actor)
    revalidatePath(pathOf(item.business_id))
    revalidatePath('/documents')
    return { documentId }
  } catch (e) {
    return explain(e, '문서로 넣지 못했습니다.')
  }
}

/** 되돌리기 = 그 문서의 soft delete(0042) — 0058 트리거가 원본을 입구 줄로 돌린다. 적재한 사람 · 대표만(0048 고치기). */
export async function undoIntakeLoadAction(itemId: string): Promise<IntakeActionState> {
  const me = await who()
  if (!me) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const repo = await getRepository()
  try {
    const item = await repo.getIntakeItem(itemId)
    if (!item || item.status !== 'loaded' || !item.loaded_id) return { error: '되돌릴 적재가 없습니다.' }
    await repo.deleteDocument(item.loaded_id, me.actor)
    revalidatePath(pathOf(item.business_id))
    revalidatePath('/documents')
    return {}
  } catch (e) {
    return explain(e, '되돌리지 못했습니다(적재한 사람 · 대표만 되돌립니다).')
  }
}
