import type { AttachmentClass, AttachmentEntity } from '@/types'

/**
 * 첨부 규칙 — 화면(드롭 · 버튼)과 서버 액션이 같은 값을 본다. DB(0045 check 제약)가 마지막 문지기다.
 */

/** 20MB. 0045 attachments_size_check와 같다. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024

/** Claude 이미지 한 장의 상한(5MB)보다 조금 아래. 넘으면 브라우저가 줄여 올린다. */
export const IMAGE_SOFT_MAX_BYTES = 4.5 * 1024 * 1024

export const ATTACHMENT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
} as const

export const ATTACHMENT_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg'

const MIMES = new Set<string>(Object.values(ATTACHMENT_MIME))

/**
 * 파일 형식 판정. 브라우저가 주는 type은 OS마다 비거나 틀린다(Windows의 .xlsx가 빈 문자열인 일이 흔하다) —
 * 확장자로 한 번 더 본다. 둘 다 아니면 null.
 */
export function attachmentMime(fileName: string, browserType: string): string | null {
  if (MIMES.has(browserType)) return browserType
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return (ATTACHMENT_MIME as Record<string, string>)[ext] ?? null
}

export const isImageMime = (mime: string) => mime === 'image/png' || mime === 'image/jpeg'

export const ATTACHMENT_CLASS_LABEL: Record<AttachmentClass, string> = {
  Normal: '일반',
  Restricted: '제한',
  Vault: 'Vault',
}

export const ATTACHMENT_CLASS_HINT: Record<AttachmentClass, string> = {
  Normal: '대상이 보이는 사람 전원 · AI 요약',
  Restricted: '제한 등급 이상 · AI 요약(외부 AI 전송 기록)',
  Vault: '파일은 받지 않음 · 링크로 등록',
}

/** 대상 상세 화면 경로 — 저장 뒤 다시 그릴 자리. */
export function entityPath(table: AttachmentEntity, id: string): string {
  switch (table) {
    case 'initiatives':
      return `/initiatives/${id}`
    case 'businesses':
      return `/business/${id}`
    case 'documents':
      return `/documents/${id}`
    case 'decisions':
      return '/approvals'
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
