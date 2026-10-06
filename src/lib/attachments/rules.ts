import { makeFileCheck } from '@/lib/file-drop'
import { SECURITY_CLASS, type AttachmentClass, type AttachmentEntity, type SecurityClass } from '@/types'

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

/** 사람이 읽는 형식 목록 — 안내 줄과 거절 문구가 같이 쓴다. */
export const ATTACHMENT_FORMATS_KO = 'PDF · Word · Excel · PowerPoint · PNG · JPG'

/**
 * 첨부 칸의 «놓자마자» 검사(공통 첨부 부품). 형식은 attachmentMime, 상한은 20MB.
 * 사진(PNG · JPG)은 여기서 크기를 보지 않는다 — 4.5MB를 넘으면 올리기 전에 줄이고, 줄인 뒤에 20MB를 다시 본다.
 */
export const checkAttachmentFile = makeFileCheck({
  typeOk: (f) => attachmentMime(f.name, f.type) !== null,
  formats: ATTACHMENT_FORMATS_KO,
  maxBytes: ATTACHMENT_MAX_BYTES,
  sizeExempt: (f) => {
    const mime = attachmentMime(f.name, f.type)
    return mime !== null && isImageMime(mime)
  },
})

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

/**
 * 파일로 올릴 수 있는 등급 중 «본인 보안등급 이하에서 가장 높은 것» — 첨부 칸의 기본값.
 * Vault는 파일을 받지 않으므로(링크 등록 길) 기본값이 될 수 없다: 회장(Vault) → 제한, 일반 직원 → 일반.
 * 0045 attachment_class_ok가 본인 등급보다 높은 줄을 42501로 막는다 — 기본이 «제한»이면
 * 일반 등급 직원은 첫 업로드에서 바로 걸렸다. 올릴 등급이 하나도 없으면(Public) null.
 */
export function defaultAttachmentClass(maxClass: SecurityClass): AttachmentClass | null {
  const max = SECURITY_CLASS.indexOf(maxClass)
  const fileClasses: AttachmentClass[] = ['Restricted', 'Normal']
  return fileClasses.find((c) => SECURITY_CLASS.indexOf(c) <= max) ?? null
}

/** 본인 보안등급보다 높은 등급은 고를 수 없다(0045가 어차피 막는다). */
export const attachmentClassAllowed = (cls: AttachmentClass, maxClass: SecurityClass) =>
  SECURITY_CLASS.indexOf(cls) <= SECURITY_CLASS.indexOf(maxClass)
