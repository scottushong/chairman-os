/**
 * 첨부 읽기 검사 — 모델을 부르지 않는다(네트워크 없음): npm run check:attachments
 *
 *   1) 이미지 한도 계산 — base64는 4/3배다. 줄이는 문턱(3.75MB)이 base64 5MB를 넘지 않는가.
 *      예전 문턱 4.5MB는 base64 6MB였다(Bedrock · Google Cloud 5MB 한도를 넘는다).
 *   2) PDF 길 판정 — 글자층이 있으면 글, 거의 없으면 document 블록, 쪽 · 크기 천장을 넘으면 이유와 함께 멈춤.
 *   3) 실제 PDF 두 벌(손으로 만든 글자 있는 것 · 글자 없는 것)을 unpdf로 읽어 길이 맞게 갈리는가,
 *      document 블록에 들어가는 바이트가 원본과 같은가(PDF.js가 버퍼를 비우지 않았는가).
 *   4) 실패 문장 모양 — «이 파일은 아직 읽을 수 없습니다 — <이유>. 파일은 올라갔습니다.»
 *
 *   npx tsx --conditions=react-server scripts/check-attachments.ts
 */
import assert from 'node:assert/strict'

import { ExtractError, extractAttachment } from '../src/lib/attachments/extract'
import {
  API_IMAGE_MAX_BASE64,
  IMAGE_SOFT_MAX_BYTES,
  IMAGE_TARGET_BASE64,
  PDF_DOC_MAX_PAGES,
  base64Length,
  convertibleImage,
  imageNeedsShrink,
  imageRejectReason,
  pdfRoute,
  unconvertibleMessage,
  unreadableMessage,
} from '../src/lib/attachments/limits'
import { ATTACHMENT_MIME } from '../src/lib/attachments/rules'
import { dummySummary, mediaContent } from '../src/lib/attachments/summarize'

const MB = 1024 * 1024
let passed = 0
const ok = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve(fn()).then(() => {
    passed++
    console.log(`  ✓ ${name}`)
  })

/** 쪽마다 내용 스트림 하나인 최소 PDF. text가 빈 문자열이면 글자층 없는 쪽(스캔본 흉내 — 사각형만 그린다). */
function makePdf(pages: string[]): Uint8Array {
  const objs: string[] = []
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`
  const fontObj = 3 + pages.length * 2
  pages.forEach((text, i) => {
    const page = 3 + i * 2
    const stream = text ? `BT /F1 12 Tf 50 700 Td (${text}) Tj ET` : '0 0 0 rg 50 50 200 200 re f'
    objs[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`
    objs[page + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  objs[fontObj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let n = 1; n < objs.length; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

async function main() {
  console.log('1) 이미지 한도')
  await ok('base64 길이 = 4 × ⌈n/3⌉', () => {
    assert.equal(base64Length(0), 0)
    assert.equal(base64Length(1), 4)
    assert.equal(base64Length(3), 4)
    assert.equal(base64Length(4), 8)
    assert.equal(base64Length(3 * MB), 4 * MB)
  })
  await ok('줄이는 문턱 3.75MB = base64 정확히 5MB, 1바이트 더하면 넘는다', () => {
    assert.equal(IMAGE_SOFT_MAX_BYTES, 3_932_160)
    assert.equal(base64Length(IMAGE_SOFT_MAX_BYTES), IMAGE_TARGET_BASE64)
    assert.ok(base64Length(IMAGE_SOFT_MAX_BYTES + 1) > IMAGE_TARGET_BASE64)
  })
  await ok('예전 문턱 4.5MB는 base64 6MB였다(5MB 한도 초과)', () => {
    assert.ok(base64Length(4.5 * MB) > 5 * MB)
  })
  await ok('줄일지: 3.5MB 아니오 · 4MB 예 · 1MB라도 9000px 예 · 8000px 아니오', () => {
    assert.equal(imageNeedsShrink(3.5 * MB, 4000, 3000), false)
    assert.equal(imageNeedsShrink(4 * MB, 4000, 3000), true)
    assert.equal(imageNeedsShrink(1 * MB, 9000, 1000), true)
    assert.equal(imageNeedsShrink(1 * MB, 8000, 8000), false)
  })
  await ok('서버 문: 직접 API 10MB(base64)까지 받고 넘으면 이유', () => {
    assert.equal(API_IMAGE_MAX_BASE64, 10 * MB)
    assert.equal(imageRejectReason(7.5 * MB), null) // base64 = 10MB 정확히
    assert.match(imageRejectReason(8 * MB) ?? '', /사진이 너무 큽니다\(8\.0MB\)/)
  })
  await ok('서버: 10MB 넘는 사진은 추출에서 멈춘다', async () => {
    await assert.rejects(extractAttachment(new ArrayBuffer(8 * MB), 'image/jpeg'), ExtractError)
  })
  await ok('HEIC · WebP · GIF는 JPEG로 바꿀 후보, PNG · JPG는 아니다', () => {
    assert.equal(convertibleImage('IMG_0001.HEIC', ''), 'heic')
    assert.equal(convertibleImage('photo', 'image/heif'), 'heic')
    assert.equal(convertibleImage('a.webp', ''), 'webp')
    assert.equal(convertibleImage('a.gif', 'image/gif'), 'gif')
    assert.equal(convertibleImage('a.jpg', 'image/jpeg'), null)
    assert.equal(convertibleImage('a.pdf', 'application/pdf'), null)
  })

  console.log('2) PDF 길 판정')
  await ok('글자층 있음 → text', () => assert.deepEqual(pdfRoute(10, 5_000, 2 * MB), { route: 'text' }))
  await ok('글자 0 → document', () => assert.deepEqual(pdfRoute(10, 0, 5 * MB), { route: 'document' }))
  await ok('쪽 번호 · 도장 정도(쪽당 20자) → document', () => assert.deepEqual(pdfRoute(3, 60, 1 * MB), { route: 'document' }))
  await ok(`스캔본 ${PDF_DOC_MAX_PAGES}쪽은 보내고 ${PDF_DOC_MAX_PAGES + 1}쪽은 이유와 함께 멈춘다`, () => {
    assert.deepEqual(pdfRoute(PDF_DOC_MAX_PAGES, 0, 5 * MB), { route: 'document' })
    const r = pdfRoute(PDF_DOC_MAX_PAGES + 1, 0, 5 * MB)
    assert.equal(r.route, 'reject')
    assert.match(r.route === 'reject' ? r.reason : '', /31쪽입니다.*30쪽까지/)
  })
  await ok('스캔본 base64가 30MB를 넘으면 멈춘다(요청 32MB 한도)', () => {
    assert.equal(pdfRoute(5, 0, 20 * MB).route, 'document') // 20MB(첨부 상한) → base64 26.7MB
    assert.equal(pdfRoute(5, 0, 23 * MB).route, 'reject')
  })
  await ok('쪽 없는 PDF는 멈춘다', () => assert.equal(pdfRoute(0, 0, 1000).route, 'reject'))

  console.log('3) 실제 PDF')
  const scanned = makePdf(['', ''])
  const texty = makePdf(['Purchase price list - raw material A 1,200 KRW per kg - supplier Hanil Chemical'])
  await ok('글자 있는 PDF → 글 길(text, 1쪽)', async () => {
    const x = await extractAttachment(buf(texty), ATTACHMENT_MIME.pdf)
    assert.equal(x.kind, 'text')
    assert.equal(x.kind === 'text' ? x.units.length : 0, 1)
  })
  await ok('글자 없는 PDF → document 길(pdf, 2쪽) · 바이트가 원본과 같다', async () => {
    const x = await extractAttachment(buf(scanned), ATTACHMENT_MIME.pdf)
    assert.equal(x.kind, 'pdf')
    if (x.kind !== 'pdf') return
    assert.equal(x.pages, 2)
    assert.deepEqual(new Uint8Array(Buffer.from(x.base64, 'base64')), scanned)
  })
  await ok('document 블록 모양 — PDF가 먼저(base64 · application/pdf), 지시는 scanned_pdf', async () => {
    const x = await extractAttachment(buf(scanned), ATTACHMENT_MIME.pdf)
    const c = mediaContent('결산서.pdf', x)!
    assert.equal(c.length, 2)
    const [doc, text] = c
    assert.equal(doc.type, 'document')
    assert.deepEqual(doc.type === 'document' ? { ...doc.source, data: '' } : null, { type: 'base64', media_type: 'application/pdf', data: '' })
    assert.equal(text.type === 'text' ? JSON.parse(text.text).mode : null, 'scanned_pdf')
    assert.equal(text.type === 'text' ? JSON.parse(text.text).pages : null, 2)
  })
  await ok('글로 읽은 파일은 media 블록이 없다(구간 요약 길)', async () => {
    assert.equal(mediaContent('a.pdf', await extractAttachment(buf(texty), ATTACHMENT_MIME.pdf)), null)
  })
  await ok('이미지는 image 블록', () => {
    const c = mediaContent('a.jpg', { kind: 'image', mediaType: 'image/jpeg', base64: 'AAAA' })!
    assert.equal(c[0].type, 'image')
  })
  await ok('31쪽 스캔본 → ExtractError(쪽 수가 이유에 있다)', async () => {
    const big = makePdf(Array.from({ length: 31 }, () => ''))
    await assert.rejects(extractAttachment(buf(big), ATTACHMENT_MIME.pdf), (e: unknown) => e instanceof ExtractError && /31쪽/.test(e.message))
  })
  await ok('dummy(키 없음) 스캔본 요약은 DUMMY로 밝힌다', async () => {
    const s = dummySummary('결산서.pdf', await extractAttachment(buf(scanned), ATTACHMENT_MIME.pdf))
    assert.equal(s.dummy, true)
    assert.match(s.summary[0], /스캔 PDF 2쪽/)
  })

  console.log('4) 실패 문장')
  await ok('«이 파일은 아직 읽을 수 없습니다 — 이유. 파일은 올라갔습니다.» — 마침표 한 번', () => {
    assert.equal(unreadableMessage('글자를 찾지 못했습니다.'), '이 파일은 아직 읽을 수 없습니다 — 글자를 찾지 못했습니다. 파일은 올라갔습니다.')
    assert.equal(unreadableMessage('스캔한 PDF가 31쪽입니다'), '이 파일은 아직 읽을 수 없습니다 — 스캔한 PDF가 31쪽입니다. 파일은 올라갔습니다.')
  })
  await ok('HEIC를 못 열면 «올리지 않았습니다»(올라간 척하지 않는다)', () => {
    const m = unconvertibleMessage('IMG_1.HEIC', 'heic')
    assert.match(m, /^IMG_1\.HEIC: 이 사진은 아직 올릴 수 없습니다 — HEIC/)
    assert.match(m, /파일은 올리지 않았습니다\.$/)
  })

  console.log(`\n첨부 읽기 검사 ${passed}개 통과`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
