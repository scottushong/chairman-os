/**
 * C단계 1. 열기(코드) — PDF · 사진. AI 전에 도는 부분이다(새 의존성 없음: unpdf · sharp만).
 *
 *   PDF   unpdf(PDF.js)로 쪽마다 글 조각을 받아 **줄(같은 높이) · 칸(틈)** 으로 다시 세운다(칸 사이는 탭).
 *         글이 거의 없으면(쪽당 20자 미만) 스캔으로 본다 — 쪽 그림으로 바꾸려면 canvas 같은 새 의존성이 필요해서,
 *         스캔 PDF는 **PDF 그대로** 모델에 document 블록으로 보낸다(Claude가 스캔 PDF를 쪽 그림으로 읽는다). 10쪽까지.
 *   사진  sharp로 EXIF 방향대로 바로 세우고(rotate()), 작은 기울기(±10°)는 가로 투영 분산이 가장 큰 각도를 찾아 펴고
 *         (글줄 · 표 줄이 수평일 때 줄마다 검은 점이 한 줄로 몰린다), 긴 변 1,568px JPEG로 줄인다(모델 권장 크기 — 토큰 절약).
 */
import sharp from 'sharp'

export type DocFormat = 'pdf_text' | 'pdf_scan' | 'image'

export const DOC_MAX_PAGES = 10
const MIN_CHARS_PER_PAGE = 20
const IMAGE_MAX_SIDE = 1568

export interface OpenedDoc {
  format: DocFormat
  pages: number
  /** 글 층 — 쪽마다 줄(칸 사이 \t). 스캔 · 사진은 ''. */
  text: string
  /** 막기(급여 · 제조지시 · 배합비 · 결산서) 판정용 — 스캔으로 본 PDF라도 조금 있는 글은 여기 둔다(AI에는 안 보냄). */
  guardText: string
  /** 글 PDF의 줄 · 칸(x 위치) — AI 없이 칸을 맞출 때(쪽 구분 없이 이어 붙임) */
  layout?: LayoutCell[][]
  /** 모델에 보낼 것(글 PDF는 글만 보낸다 — 버리기를 거친 글). */
  media: { kind: 'text' } | { kind: 'pdf'; data: Uint8Array } | { kind: 'image'; data: Uint8Array; mediaType: 'image/jpeg' }
  /** 고친 것(화면 · 기록) — «EXIF 방향 6 → 바로 세움» · «기울기 3.5° 폄» */
  fixes: string[]
  /** 사진에서 잰 기울기(도, 시계 방향 +) — 검사용 */
  skew?: number
}

export class DocOpenError extends Error {}

interface TextItem {
  str: string
  transform: number[]
  width: number
}

export interface LayoutCell {
  t: string
  x: number
}

export const lineText = (cells: LayoutCell[]) => cells.map((c) => c.t).join('\t')

/** 쪽의 글 조각 → 줄 · 칸(x 위치와 함께). 같은 높이(±2)를 한 줄로, 줄 안에서는 x 순서. */
export function itemsToLines(items: TextItem[]): LayoutCell[][] {
  const rows: { y: number; items: TextItem[] }[] = []
  for (const it of items) {
    if (!it.str) continue
    const y = it.transform[5]
    const row = rows.find((r) => Math.abs(r.y - y) <= 2)
    if (row) row.items.push(it)
    else rows.push({ y, items: [it] })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map((r) => {
      const sorted = r.items.sort((a, b) => a.transform[4] - b.transform[4])
      // 빈칸 조각은 건너뛰고 글 조각 사이의 틈으로 정한다: 글자 1.6개보다 넓으면 칸(탭), 4분의 1보다 넓으면 띄어쓰기.
      const cells: LayoutCell[] = []
      let end = -Infinity
      for (const it of sorted) {
        if (!it.str.trim()) continue
        const x = it.transform[4]
        const fs = Math.abs(it.transform[0]) || 10
        const gap = x - end
        const last = cells[cells.length - 1]
        if (!last || gap > fs * 1.6) cells.push({ t: it.str.trim(), x })
        else last.t += (gap > fs * 0.25 ? ' ' : '') + it.str.trim()
        end = x + (it.width || 0)
      }
      return cells
    })
    .filter((c) => c.length > 0)
}

export async function pdfPages(bytes: Uint8Array): Promise<LayoutCell[][][]> {
  const { getDocumentProxy } = await import('unpdf')
  let doc
  try {
    // PDF.js는 받은 버퍼를 비울 수 있다 — 스캔이면 원본 바이트를 다시 보내야 해서 복사본을 준다.
    doc = await getDocumentProxy(bytes.slice())
  } catch {
    throw new DocOpenError('PDF가 깨졌거나 암호가 걸려 열 수 없습니다 — 암호를 풀어 다시 저장해 올려 주세요.')
  }
  if (doc.numPages > DOC_MAX_PAGES) throw new DocOpenError(`PDF가 ${doc.numPages}쪽입니다 — ${DOC_MAX_PAGES}쪽까지 받습니다. 나눠 올리거나 엑셀로 올려 주세요.`)
  const out: LayoutCell[][][] = []
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    out.push(itemsToLines(tc.items.filter((i): i is TextItem & typeof i => 'str' in i) as TextItem[]))
  }
  return out
}

/**
 * 기울기 재기 — 회색 작은 그림(raw)에서 어두운 점을 모아 −10°~+10°(0.25° 걸음)마다 «돌린 y» 막대그림의 제곱합을 잰다.
 * 수평 줄이 많을수록 값이 크다. 돌려주는 값은 내용이 시계 방향으로 기운 각도(+)다.
 */
export function measureSkew(data: Uint8Array | Buffer, width: number, height: number): number {
  const xs: number[] = []
  const ys: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] < 110) {
        xs.push(x)
        ys.push(y)
      }
    }
  }
  if (xs.length < 50) return 0
  const step = Math.max(1, Math.floor(xs.length / 30_000))
  const span = Math.ceil(Math.hypot(width, height)) * 2 + 4
  let best = 0
  let bestScore = -1
  for (let a = -10; a <= 10.0001; a += 0.25) {
    const r = (a * Math.PI) / 180
    const s = Math.sin(r)
    const c = Math.cos(r)
    const bins = new Float64Array(span)
    for (let i = 0; i < xs.length; i += step) {
      const v = Math.round(ys[i] * c - xs[i] * s) + (span >> 1)
      if (v >= 0 && v < span) bins[v] += 1
    }
    let score = 0
    for (let i = 0; i < span; i += 1) score += bins[i] * bins[i]
    if (score > bestScore) {
      bestScore = score
      best = a
    }
  }
  return Math.round(best * 100) / 100
}

/** 사진 바로 세우기(EXIF) → 기울기 펴기 → 1,568px JPEG. */
export async function normalizePhoto(bytes: Uint8Array): Promise<{ data: Uint8Array; fixes: string[]; skew: number }> {
  const fixes: string[] = []
  let meta
  try {
    meta = await sharp(bytes).metadata()
  } catch {
    throw new DocOpenError('사진이 깨져 열 수 없습니다 — 다시 찍거나 원본을 올려 주세요.')
  }
  if (meta.orientation && meta.orientation !== 1) fixes.push(`EXIF 방향 ${meta.orientation} → 바로 세움`)
  const upright = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).png().toBuffer()
  const small = await sharp(upright).greyscale().resize({ width: 600, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true })
  const skew = measureSkew(small.data, small.info.width, small.info.height)
  let img = sharp(upright)
  if (Math.abs(skew) >= 0.5) {
    img = sharp(await sharp(upright).rotate(-skew, { background: '#ffffff' }).png().toBuffer())
    fixes.push(`기울기 ${Math.abs(skew)}° 폄`)
  }
  const data = await img.resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  return { data: new Uint8Array(data), fixes, skew }
}

export async function openDocument(bytes: Uint8Array, format: 'pdf' | 'image'): Promise<OpenedDoc> {
  if (format === 'image') {
    const p = await normalizePhoto(bytes)
    return { format: 'image', pages: 1, text: '', guardText: '', media: { kind: 'image', data: p.data, mediaType: 'image/jpeg' }, fixes: p.fixes, skew: p.skew }
  }
  const pages = await pdfPages(bytes)
  const all = pages.map((p) => p.map(lineText).join('\n')).join('\n')
  const chars = pages.reduce((a, p) => a + p.map(lineText).join('').replace(/\s/g, '').length, 0)
  if (chars >= MIN_CHARS_PER_PAGE * pages.length) {
    return { format: 'pdf_text', pages: pages.length, text: pages.map((p) => p.map(lineText).join('\n')).join('\n\f\n'), guardText: all, layout: pages.flat(), media: { kind: 'text' }, fixes: [] }
  }
  return { format: 'pdf_scan', pages: pages.length, text: '', guardText: all, media: { kind: 'pdf', data: bytes }, fixes: ['글 층이 없음(스캔) — PDF 그대로 읽힘'] }
}
