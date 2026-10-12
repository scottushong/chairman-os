/**
 * C단계(PDF · 사진) 시험용 가짜 파일 — 코드로만 만든다(진짜 회사 파일 · 진짜 구성표 없음, 새 의존성 없음).
 *
 *   textPdf(rows)        글자 있는 PDF. 글꼴 파일을 싣지 않은 Type0(Identity-H) + ToUnicode라 PDF.js가 글을 뽑는다(칸마다 따로 놓음).
 *   scanPdf(jpeg, w, h)  글자 층이 없는 PDF(쪽 하나 = 그림 하나) — 스캔본 흉내.
 *   tablePhoto(...)      표 모양 사진(선 · 막대) — 기울이기(각도) · EXIF 방향(6 = 90° 돌려 찍음)을 줄 수 있다.
 */
import sharp from 'sharp'

const enc = new TextEncoder()

function hex16(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c > 0xffff) continue
    out += c.toString(16).padStart(4, '0')
  }
  return out
}

/** 객체 목록 → PDF 바이트(xref 포함). 객체 i는 i+1번. 스트림 바이트는 그대로 붙인다. */
function assemble(objects: (string | { dict: string; data: Uint8Array })[]): Uint8Array {
  const parts: Uint8Array[] = []
  let len = 0
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b
    parts.push(u)
    len += u.length
  }
  push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(len)
    if (typeof o === 'string') push(`${i + 1} 0 obj\n${o}\nendobj\n`)
    else {
      push(`${i + 1} 0 obj\n${o.dict.replace(/>>\s*$/, `/Length ${o.data.length} >>`)}\nstream\n`)
      push(o.data)
      push('\nendstream\nendobj\n')
    }
  })
  const xref = len
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}`)
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(len)
  let p = 0
  for (const b of parts) {
    out.set(b, p)
    p += b.length
  }
  return out
}

const TO_UNICODE = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
2 beginbfrange
<0000> <7FFF> <0000>
<8000> <FFFF> <8000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`

/** 글자 있는 PDF — rows는 쪽마다 줄 · 칸. 칸은 colWidth 간격으로 따로 놓는다(PDF.js가 칸을 따로 읽게). */
export function textPdf(pages: (string | number | null)[][][], colWidth = 95): Uint8Array {
  const objs: (string | { dict: string; data: Uint8Array })[] = []
  // 1 카탈로그 · 2 쪽들 · 3 글꼴(Type0) · 4 CID 글꼴 · 5 ToUnicode · 6.. 쪽 · 내용
  const pageIds = pages.map((_, i) => 6 + i * 2)
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  objs.push('<< /Type /Font /Subtype /Type0 /BaseFont /FakeGothic /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>')
  objs.push('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FakeGothic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor << /Type /FontDescriptor /FontName /FakeGothic /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >> /DW 1000 /CIDToGIDMap /Identity >>')
  objs.push({ dict: '<< >>', data: enc.encode(TO_UNICODE) })
  pages.forEach((rows, pi) => {
    let content = ''
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell === null || cell === '') return
        const s = typeof cell === 'number' ? cell.toLocaleString('en-US') : cell
        const x = 30 + c * colWidth
        const y = 800 - r * 18
        content += `BT /F1 8 Tf 1 0 0 1 ${x} ${y} Tm <${hex16(s)}> Tj ET\n`
      })
    })
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Math.max(595, 60 + colWidth * Math.max(...rows.map((r) => r.length)))} 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[pi] + 1} 0 R >>`)
    objs.push({ dict: '<< >>', data: enc.encode(content) })
  })
  return assemble(objs)
}

/** 글자 층이 없는 PDF — 쪽 하나에 JPEG 그림 하나(스캔본 흉내). */
export function scanPdf(jpeg: Uint8Array, w: number, h: number): Uint8Array {
  const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q\n`)
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`,
    { dict: `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`, data: jpeg },
    { dict: '<< >>', data: content },
  ])
}

/**
 * 표 모양 사진 — 가로줄 · 글자 대신 막대(칸). angle(도, 시계 방향 +)만큼 기울이고, exif가 있으면 그 방향 값을 단다
 * (6이면 그림을 반시계 90° 돌려 저장 — 보는 프로그램이 EXIF대로 돌려 바로 선다).
 */
export async function tablePhoto(opts: { angle?: number; exif?: number; width?: number; height?: number } = {}): Promise<Uint8Array> {
  const W = opts.width ?? 900
  const H = opts.height ?? 640
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>`
  for (let r = 0; r < 14; r += 1) {
    const y = 60 + r * 38
    svg += `<rect x="50" y="${y}" width="${W - 100}" height="2" fill="#222"/>`
    for (let c = 0; c < 5; c += 1) {
      const w = 60 + ((r * 7 + c * 13) % 70)
      svg += `<rect x="${70 + c * 160}" y="${y + 12}" width="${w}" height="14" fill="#333"/>`
    }
  }
  svg += '</svg>'
  let img = sharp(Buffer.from(svg)).flatten({ background: '#ffffff' })
  if (opts.angle) img = sharp(await img.png().toBuffer()).rotate(opts.angle, { background: '#ffffff' })
  if (opts.exif === 6) {
    // EXIF 6 = «보일 때 시계 90° 돌려라» → 저장은 반시계 90°로.
    const flat = await img.png().toBuffer()
    return new Uint8Array(await sharp(flat).rotate(-90).jpeg({ quality: 85 }).withMetadata({ orientation: 6 }).toBuffer())
  }
  return new Uint8Array(await img.jpeg({ quality: 85 }).toBuffer())
}

/** 스캔 PDF 속 그림(표 사진)과 그 크기. */
export async function scanPdfOfTable(): Promise<Uint8Array> {
  const jpeg = await tablePhoto({ width: 595, height: 842 })
  return scanPdf(jpeg, 595, 842)
}
