'use server'

import { revalidatePath } from 'next/cache'

import { structureMemo, summarizeAttachment } from '@/lib/attachments/summarize'
import { ATTACHMENT_MAX_BYTES, attachmentMime, entityPath } from '@/lib/attachments/rules'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { ATTACHMENT_CLASS, ATTACHMENT_ENTITY, type AttachmentClass, type AttachmentEntity } from '@/types'

/**
 * Phase 10 첨부 Server Action.
 *
 * 권한을 여기서 판정하지 않는다 — 0045 RLS가 대상 · 등급 · 올린 사람을 본다. 여기서는 입력의 모양만 거르고
 * DB의 거부를 사람의 말로 바꾼다.
 *
 * 올리기는 세 걸음이다(DEFERRED Phase 10): beginAttachment(줄 — 경로는 DB가 정한다) →
 * 바이트(live: 브라우저가 Storage로 바로 · dummy: uploadAttachmentBytes) → summarizeAttachmentAction.
 * 바이트가 실패하면 cancelAttachment가 줄을 지운다 — 파일 없는 줄이 목록에 남지 않게.
 */

export interface AttachmentActionState {
  error?: string
}

function denied(e: unknown, fallback = '저장하지 못했습니다. 잠시 후 다시 시도하세요.'): AttachmentActionState {
  console.error('[attachments]', e)
  const m = e instanceof Error ? e.message : ''
  if (/row-level security|42501|attachments_insert|permission denied/.test(m)) {
    return { error: '권한이 없습니다. (대상을 볼 수 없거나, 이 등급을 다룰 수 없거나, 올린 사람 · 회장이 아닙니다)' }
  }
  if (/attachments_(mime|size|class|entity)/.test(m)) return { error: '받지 않는 파일입니다. (PDF · Word · Excel · PowerPoint · PNG · JPG, 20MB까지)' }
  return { error: fallback }
}

async function actor() {
  const user = await currentUser()
  return user ? { user_id: user.user_id, role: user.role } : null
}

export interface BeginResult extends AttachmentActionState {
  id?: string
  path?: string
  status?: string
}

export async function beginAttachment(input: unknown): Promise<BeginResult> {
  const f = (input ?? {}) as Record<string, unknown>
  const entity_table = f.entity_table as AttachmentEntity
  const entity_id = typeof f.entity_id === 'string' ? f.entity_id.trim() : ''
  const file_name = typeof f.file_name === 'string' ? f.file_name.trim().slice(0, 255) : ''
  const size_bytes = typeof f.size_bytes === 'number' ? Math.floor(f.size_bytes) : 0
  const security_class = f.security_class as AttachmentClass
  const mime = attachmentMime(file_name, typeof f.mime === 'string' ? f.mime : '')

  if (!ATTACHMENT_ENTITY.includes(entity_table) || !/^[A-Za-z0-9_-]{1,64}$/.test(entity_id)) return { error: '어디에 붙일지 알 수 없습니다.' }
  if (!ATTACHMENT_CLASS.includes(security_class)) return { error: '등급을 고르세요.' }
  if (!file_name) return { error: '파일 이름이 없습니다.' }
  if (!mime) return { error: 'PDF · Word · Excel · PowerPoint · PNG · JPG만 받습니다.' }
  if (size_bytes < 1 || size_bytes > ATTACHMENT_MAX_BYTES) return { error: '20MB까지 올릴 수 있습니다.' }

  const who = await actor()
  if (!who) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const a = await repo.createAttachment({ entity_table, entity_id, file_name, mime, size_bytes, security_class }, who)
    return { id: a.attachment_id, path: a.storage_path, status: a.status }
  } catch (e) {
    return denied(e)
  }
}

/** 서버로 바이트를 받는 길 — dummy의 유일한 길. live는 브라우저가 Storage로 바로 올린다(Vercel 4.5MB 한도). */
export async function uploadAttachmentBytes(attachmentId: string, form: FormData): Promise<AttachmentActionState> {
  const file = form.get('file')
  if (!(file instanceof File)) return { error: '파일이 없습니다.' }
  if (file.size > ATTACHMENT_MAX_BYTES) return { error: '20MB까지 올릴 수 있습니다.' }
  try {
    const repo = await getRepository()
    const a = await repo.getAttachment(attachmentId)
    if (!a) return { error: '첨부를 찾지 못했습니다.' }
    await repo.putAttachmentObject(a.storage_path, await file.arrayBuffer(), a.mime)
    return {}
  } catch (e) {
    return denied(e, '파일을 올리지 못했습니다.')
  }
}

export async function cancelAttachment(attachmentId: string): Promise<AttachmentActionState> {
  const who = await actor()
  if (!who) return {}
  try {
    await (await getRepository()).deleteAttachment(attachmentId, who)
  } catch (e) {
    console.error('[attachments] 취소 실패', e)
  }
  return {}
}

export interface SummarizeState extends AttachmentActionState {
  status?: string
}

/** 요약 한 번(처음이든 «다시 요약»이든). 실패해도 첨부는 남는다 — 상태가 failed로 서고 이유가 적힌다. */
export async function summarizeAttachmentAction(attachmentId: string): Promise<SummarizeState> {
  if (!(await actor())) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const repo = await getRepository()
  const a = await repo.getAttachment(attachmentId)
  if (!a) return { error: '첨부를 찾지 못했습니다.' }
  const result = await summarizeAttachment(repo, attachmentId)
  revalidatePath(entityPath(a.entity_table, a.entity_id))
  revalidatePath('/documents')
  return { status: result.status, error: result.error }
}

export async function deleteAttachmentAction(attachmentId: string): Promise<AttachmentActionState> {
  const who = await actor()
  if (!who) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const a = await repo.getAttachment(attachmentId)
    await repo.deleteAttachment(attachmentId, who)
    if (a) revalidatePath(entityPath(a.entity_table, a.entity_id))
    revalidatePath('/documents')
    return {}
  } catch (e) {
    return denied(e, '지우지 못했습니다.')
  }
}

/** 내려받기 = 감사 한 줄 + 10분짜리 서명 URL. */
export async function downloadAttachmentAction(attachmentId: string): Promise<AttachmentActionState & { url?: string }> {
  try {
    const url = await (await getRepository()).downloadAttachment(attachmentId)
    return url ? { url } : { error: '파일을 열 수 없습니다(없거나 볼 권한이 없습니다).' }
  } catch (e) {
    return denied(e, '파일을 열지 못했습니다.')
  }
}

/** Vault 지정자 넣기 · 빼기. 회장만(0045). */
export async function setAttachmentViewerAction(attachmentId: string, userId: string, on: boolean): Promise<AttachmentActionState> {
  const who = await actor()
  if (!who) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: '사람을 고르세요.' }
  try {
    const repo = await getRepository()
    await repo.setAttachmentViewer(attachmentId, userId, on, who)
    const a = await repo.getAttachment(attachmentId)
    if (a) revalidatePath(entityPath(a.entity_table, a.entity_id))
    return {}
  } catch (e) {
    return denied(e, '지정하지 못했습니다.')
  }
}

/** «AI로 정리» — 제안만 돌려준다. 저장은 회장이 받을 때 saveInitiativeNoteAction이 한다. */
export async function structureMemoAction(initiativeId: string, memo: string): Promise<AttachmentActionState & { text?: string; dummy?: boolean }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  // 회장 메모는 회장만 읽고 쓴다(0017 initiative_notes_all) — 남의 손으로 메모가 AI에 나가지 않게.
  if (user.role !== 'Chairman') return { error: '회장 메모는 회장만 정리합니다.' }
  if (memo.length > 5_000) return { error: '5,000자를 넘는 메모는 정리하지 않습니다.' }
  return structureMemo(await getRepository(), initiativeId, memo)
}
