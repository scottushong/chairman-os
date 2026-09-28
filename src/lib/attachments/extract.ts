import 'server-only'

import { strFromU8, unzipSync } from 'fflate'

import { ATTACHMENT_MIME, isImageMime } from './rules'

/**
 * 첨부 본문 추출 — 서버에서만, 메모리에서만. **추출한 글은 어디에도 저장하지 않는다**(0045 머리 주석).
 * 요약을 만들고 나면 이 함수의 결과는 버려진다.
 *
 * 형식별 도구(DEFERRED Phase 10):
 *   PDF  unpdf — 서버리스용 PDF.js 번들(워커 없음). 쪽마다 글을 따로 받아 긴 문서를 쪽 단위로 자른다.
 *   docx mammoth(raw text)
 *   xlsx exceljs — npm `xlsx` 0.18.x는 미패치 CVE가 있어 쓰지 않는다(믿을 수 없는 파일이다).
 *   pptx fflate로 풀어 ppt/slides/slideN.xml의 <a:t>만 모은다.
 *   이미지 추출 없음 — 그대로 Claude vision으로 간다.
 *
 * OOXML 셋은 zip이다. 풀기 전에 **압축 해제 크기 합**을 잰다 — 20MB zip이 수 GB로 부푸는 zip bomb을
 * 함수 메모리 전에 끊는다.
 */

export type Extracted =
  | { kind: 'text'; units: string[]; unitLabel: '쪽' | '장' | '시트' | '문서'; chars: number }
  | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg'; base64: string }

export class ExtractError extends Error {}

const ZIP_MAX_UNPACKED = 200 * 1024 * 1024
const ZIP_MAX_ENTRIES = 5_000
/** 표 한 장에서 읽는 줄 수 상한. 수십만 줄짜리 원장을 통째로 요약에 넣지 않는다. */
const XLSX_MAX_ROWS = 3_000

function guardZip(bytes: Uint8Array) {
  let total = 0
  let entries = 0
  try {
    // filter가 false를 돌려주면 풀지 않는다 — 머리(중앙 디렉터리)의 크기만 읽는다.
    unzipSync(bytes, {
      filter(file) {
        total += file.originalSize
        entries += 1
        return false
      },
    })
  } catch {
    throw new ExtractError('파일이 손상되었거나 Office 문서 형식이 아닙니다.')
  }
  if (total > ZIP_MAX_UNPACKED || entries > ZIP_MAX_ENTRIES) {
    throw new ExtractError('압축을 풀면 너무 큰 문서입니다(200MB 초과). 요약하지 않습니다.')
  }
}

async function pdf(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const doc = await getDocumentProxy(bytes)
  const { text } = await extractText(doc, { mergePages: false })
  return text.map((t) => t.replace(/[ \t]+/g, ' ').trim())
}

async function docx(bytes: Uint8Array): Promise<string[]> {
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return [value.replace(/\n{3,}/g, '\n\n').trim()]
}

async function xlsx(bytes: Uint8Array): Promise<string[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  // exceljs의 타입은 옛 Buffer 모양을 요구한다 — 바이트는 그대로다.
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  const sheets: string[] = []
  wb.eachSheet((ws) => {
    const lines: string[] = [`## 시트: ${ws.name}`]
    let n = 0
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (n++ >= XLSX_MAX_ROWS) return
      const cells: string[] = []
      row.eachCell({ includeEmpty: false }, (cell) => {
        const t = (cell.text ?? '').toString().trim()
        if (t) cells.push(t)
      })
      if (cells.length) lines.push(cells.join('\t'))
    })
    if (n > XLSX_MAX_ROWS) lines.push(`(… ${n - XLSX_MAX_ROWS}줄 더 있음 — 읽지 않음)`)
    sheets.push(lines.join('\n'))
  })
  return sheets
}

function pptx(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) })
  return Object.keys(files)
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
    .map((name, i) => {
      const xml = strFromU8(files[name])
      const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]))
      return `## 슬라이드 ${i + 1}\n${runs.join(' ').replace(/\s+/g, ' ').trim()}`
    })
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

export async function extractAttachment(buffer: ArrayBuffer, mime: string): Promise<Extracted> {
  const bytes = new Uint8Array(buffer)
  if (isImageMime(mime)) {
    return { kind: 'image', mediaType: mime as 'image/png' | 'image/jpeg', base64: Buffer.from(bytes).toString('base64') }
  }

  let units: string[]
  let unitLabel: '쪽' | '장' | '시트' | '문서'
  try {
    switch (mime) {
      case ATTACHMENT_MIME.pdf:
        units = await pdf(bytes)
        unitLabel = '쪽'
        break
      case ATTACHMENT_MIME.docx:
        guardZip(bytes)
        units = await docx(bytes)
        unitLabel = '문서'
        break
      case ATTACHMENT_MIME.xlsx:
        guardZip(bytes)
        units = await xlsx(bytes)
        unitLabel = '시트'
        break
      case ATTACHMENT_MIME.pptx:
        guardZip(bytes)
        units = pptx(bytes)
        unitLabel = '장'
        break
      default:
        throw new ExtractError('요약할 수 없는 형식입니다.')
    }
  } catch (e) {
    if (e instanceof ExtractError) throw e
    console.error('[attachments] 추출 실패', e)
    throw new ExtractError('파일에서 글을 읽지 못했습니다(손상되었거나 암호가 걸린 파일).')
  }

  const chars = units.reduce((n, u) => n + u.length, 0)
  if (chars < 20) {
    throw new ExtractError(
      mime === ATTACHMENT_MIME.pdf
        ? '글자를 찾지 못했습니다 — 스캔한 PDF로 보입니다. 사진(이미지)으로 올리면 요약합니다.'
        : '글자를 찾지 못했습니다.',
    )
  }
  return { kind: 'text', units, unitLabel, chars }
}
