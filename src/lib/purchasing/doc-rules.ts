import { makeFileCheck } from '@/lib/file-drop'

/**
 * 구매 첨부(견적서 · 단가표 · 송장) 규칙 — 화면(드롭 칸)과 서버 액션이 같은 값을 본다. DB(0061 cost_purchase_docs check)가 마지막 문지기다.
 *
 * 4MB까지 — 바이트는 **서버 액션으로** 받는다(배합비 검사가 저장 전에 돈다 · Vercel 함수 요청 한도 4.5MB). 브라우저가 Storage로
 * 바로 올리는 길은 없다: 그 길이면 배합비로 보이는 파일이 검사 전에 저장된다.
 * AI에 보내지 않는다(요약 없음). Vault 등급은 받지 않는다.
 */

/** 4MB. 0061 cost_purchase_docs.size_bytes check와 같다. */
export const PURCHASE_DOC_MAX_BYTES = 4 * 1024 * 1024

export const PURCHASE_DOC_MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
} as const

export const PURCHASE_DOC_ACCEPT = '.pdf,.xlsx,.docx,.csv,.png,.jpg,.jpeg'
export const PURCHASE_DOC_FORMATS_KO = 'PDF · Excel · Word · CSV · PNG · JPG'

const MIMES = new Set<string>(Object.values(PURCHASE_DOC_MIME))

/** 브라우저 type이 비거나 틀린 일이 흔하다(Windows .xlsx · .csv) — 확장자로 한 번 더 본다. */
export function purchaseDocMime(fileName: string, browserType: string): string | null {
  if (MIMES.has(browserType)) return browserType
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return (PURCHASE_DOC_MIME as Record<string, string>)[ext] ?? null
}

export const isImageDoc = (mime: string) => mime === 'image/png' || mime === 'image/jpeg'

export const checkPurchaseDocFile = makeFileCheck({
  typeOk: (f) => purchaseDocMime(f.name, f.type) !== null,
  formats: PURCHASE_DOC_FORMATS_KO,
  maxBytes: PURCHASE_DOC_MAX_BYTES,
})

/**
 * 저장 경로에 쓸 파일 이름. 0061 cost_purchase_docs_path가 '..'을 막고, Storage 키는 슬래시 · 제어 문자에 약하다.
 * 한글은 그대로 둔다(사람이 알아보는 이름). 200자(0061 file_name 상한)로 자른다.
 */
export function safeDocFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .trim()
  return (cleaned || 'file').slice(0, 200)
}

/**
 * Storage 키에 쓰는 이름 — ASCII만(Supabase Storage는 한글 키를 «Invalid key»로 거부한다). 보이는 이름은 file_name 칸이 따로 갖는다.
 * 확장자는 남긴다. 남는 글자가 없으면 'doc.<확장자>'.
 */
export function storageDocName(name: string): string {
  const safe = safeDocFileName(name)
  const m = /^(.+)\.([A-Za-z0-9]{1,8})$/.exec(safe)
  const ext = m ? m[2].toLowerCase() : ''
  const stem = (m ? m[1] : safe).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  return `${stem || 'doc'}${ext ? `.${ext}` : ''}`
}

/** CSV 한 줄을 칸으로 — 따옴표 안의 쉼표는 칸을 가르지 않는다. mix-ratio의 표 읽기는 탭으로 가른다. */
export function csvToTabbed(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const cells: string[] = []
      let cur = ''
      let quoted = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"') {
          if (quoted && line[i + 1] === '"') {
            cur += '"'
            i++
          } else quoted = !quoted
        } else if (c === ',' && !quoted) {
          cells.push(cur)
          cur = ''
        } else cur += c
      }
      cells.push(cur)
      return cells.map((x) => x.replace(/\t/g, ' ').trim()).join('\t')
    })
    .join('\n')
}
