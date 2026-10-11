import type { IntakeItem } from '@/types'

/**
 * 0058 intake_items의 dummy 저장소 — dummy-intake.ts(입구 메서드)와 dummy-attachments.ts(원본 첨부의 삭제 · AI 전송 문)가
 * 같이 본다. 두 파일이 서로를 부르지 않게 저장소만 따로 둔다. globalThis에 둔다(dev 서버가 모듈을 다시 읽어도 남게).
 */
interface Store {
  rows: IntakeItem[]
}

const g = globalThis as unknown as { __chairmanDummyIntake?: Store }
export const intakeStore: Store = (g.__chairmanDummyIntake ??= { rows: [] })

/** 0058 intake_attachment_loaded — 문서로 적재 중인 원본은 지우지 못한다. */
export function dummyIntakeAttachmentLoaded(attachmentId: string): boolean {
  return intakeStore.rows.some((r) => r.attachment_id === attachmentId && r.status === 'loaded')
}

/** 0058 intake_ai_blocked — 끈적한 차단 · no_ai · 확인 없는 사진이면 AI로 못 간다. */
export function dummyIntakeAiBlocked(attachmentId: string, mime: string): boolean {
  return intakeStore.rows.some(
    (r) => r.attachment_id === attachmentId && (r.ai_blocked_reason !== null || r.status === 'no_ai' || (mime.startsWith('image/') && !r.mix_attested_at)),
  )
}

/** 0058 FK on delete cascade — 원본 첨부를 지우면 입구 줄도 같이 간다. */
export function dummyIntakeDropByAttachment(attachmentId: string): void {
  intakeStore.rows = intakeStore.rows.filter((r) => r.attachment_id !== attachmentId)
}

/** 0058 attachments_intake_owner — 입구 원본은 그 줄을 만든 본인이, 그 줄의 첨부 id · 등급으로, 읽기 전에만 올린다. */
export function dummyIntakeOwnsAttachment(itemId: string, attachmentId: string, userId: string, cls: string): boolean {
  return intakeStore.rows.some(
    (r) => r.item_id === itemId && r.attachment_id === attachmentId && r.created_by === userId && r.security_class === cls && r.status === 'uploaded',
  )
}

/** 0058 attachment_object_uploadable — 입구 원본의 재업로드 창은 읽기 전(uploaded)에만. */
export function dummyIntakeSealed(attachmentId: string): boolean {
  return intakeStore.rows.some((r) => r.attachment_id === attachmentId && r.status !== 'uploaded')
}
