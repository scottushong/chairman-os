/**
 * 공통 첨부 부품(5단계)의 순수 규칙 — 끌어다 놓은(또는 고른) 파일 묶음을 «올릴 것 · 거절 · 넘김»으로 가른다.
 *
 * 화면 부품(components/ui/file-drop-zone.tsx)은 이 판정만 믿고 순서대로 올린다. 규칙 자체(형식 · 상한)는
 * 칸마다 자기 lib에 그대로 있다(lib/attachments/rules.ts · lib/initiative-logo.ts · lib/profile-photo.ts) —
 * 여기서는 그 규칙을 «파일 한 개 → 거절 사유 또는 null» 모양으로 맞출 뿐이다. 서버 액션이 마지막 문지기다.
 *
 * 브라우저 없이 돈다(scripts/check-file-drop.ts).
 */

/** File의 판정에 쓰는 부분만. 검사 스크립트가 가짜 파일로 돌릴 수 있게. */
export interface FileLike {
  name: string
  type: string
  size: number
}

/** 파일 한 개 → 거절 사유(한국어, 형식 · 상한 포함) 또는 null(통과). */
export type FileCheck = (file: FileLike) => string | null

/** 2_097_152 → «2MB», 20 * 1024 * 1024 → «20MB». 정수가 아니면 소수 한 자리. */
export function limitLabel(bytes: number): string {
  const mb = bytes / 1_048_576
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`
}

/** 1.2MB · 340KB — 거절 문구에 지금 크기를 같이 적는다. */
function sizeLabel(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1_048_576).toFixed(1)}MB`
}

/**
 * 칸 하나의 규칙으로 검사기를 만든다.
 * - `typeOk`: 형식 판정(칸마다 다르다 — 첨부는 확장자도 본다, 로고 · 사진은 서버처럼 file.type만).
 * - `formats`: 사람이 읽는 형식 목록(«PNG · JPG · WebP»).
 * - `maxBytes`: 상한. `sizeExempt`가 참인 파일은 여기서 크기를 보지 않는다(첨부 사진 — 올리기 전에 줄인다).
 */
export function makeFileCheck(rule: {
  typeOk: (file: FileLike) => boolean
  formats: string
  maxBytes: number
  sizeExempt?: (file: FileLike) => boolean
}): FileCheck {
  const allowed = `${rule.formats}, ${limitLabel(rule.maxBytes)}까지 받습니다.`
  return (file) => {
    if (!rule.typeOk(file)) return `받지 않는 형식입니다. ${allowed}`
    if (file.size === 0) return `빈 파일입니다. ${allowed}`
    if (file.size > rule.maxBytes && !rule.sizeExempt?.(file)) {
      return `${sizeLabel(file.size)}라 너무 큽니다. ${allowed}`
    }
    return null
  }
}

export type DropVerdict<T> =
  | { file: T; verdict: 'take' }
  | { file: T; verdict: 'reject'; reason: string }
  | { file: T; verdict: 'skip'; reason: string }

/**
 * 놓은 순서 그대로 판정한다.
 * - 규칙에 걸린 파일은 곧바로 «거절»(사유와 함께) — 같은 묶음의 다른 파일은 그대로 올라간다.
 * - `max`(한 장만 받는 칸이면 1)를 넘는 통과 파일은 «넘김» — 앞에서부터 `max`개만 올린다.
 */
export function planDrop<T extends FileLike>(files: readonly T[], check: FileCheck, max?: number): DropVerdict<T>[] {
  let taken = 0
  return files.map((file) => {
    const reason = check(file)
    if (reason) return { file, verdict: 'reject', reason }
    if (max !== undefined && taken >= max) {
      return { file, verdict: 'skip', reason: max === 1 ? '한 장만 받습니다 — 앞의 파일만 올렸습니다.' : `${max}개까지 받습니다 — 앞의 파일만 올렸습니다.` }
    }
    taken += 1
    return { file, verdict: 'take' }
  })
}

/** 묶음이 끝난 뒤 한 줄 — aria-live로 읽힌다. */
export function dropSummary(counts: { done: number; failed: number; rejected: number; skipped: number }): string {
  const parts: string[] = []
  if (counts.done) parts.push(`${counts.done}개 올렸습니다`)
  if (counts.failed) parts.push(`${counts.failed}개 실패`)
  if (counts.rejected) parts.push(`${counts.rejected}개는 형식 · 크기가 맞지 않아 받지 않았습니다`)
  if (counts.skipped) parts.push(`${counts.skipped}개는 넘겼습니다`)
  return parts.length ? `${parts.join(' · ')}.` : '올린 파일이 없습니다.'
}
