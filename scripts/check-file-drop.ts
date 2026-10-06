/**
 * 5단계 공통 첨부 부품의 순수 판정 검증 (브라우저 없음): npm run check:file-drop
 *
 * 무엇을 재나
 *   1) 놓은 순서 그대로 판정한다 — 올리는 순서가 곧 놓은 순서다.
 *   2) 형식 · 크기 위반은 파일마다 거절되고 사유에 «받는 형식 · 상한»이 한국어로 들어간다.
 *      같은 묶음의 맞는 파일은 그대로 «올릴 것»으로 남는다.
 *   3) 한 장만 받는 칸(로고 · 사진, max=1)은 맞는 파일 중 첫 장만 올리고 나머지는 «넘김»(그렇다고 말한다).
 *   4) 칸마다 규칙이 그대로다 — 첨부: 확장자로도 판정(Windows .xlsx 빈 type) · 20MB · 사진은 줄이므로 크기 면제,
 *      로고 · 사진: 서버 액션처럼 file.type만 · 2MB · SVG 없음.
 */
import assert from 'node:assert/strict'

import { checkAttachmentFile, ATTACHMENT_MAX_BYTES } from '../src/lib/attachments/rules'
import { dropSummary, limitLabel, planDrop, type FileLike } from '../src/lib/file-drop'
import { checkLogoFile, LOGO_MAX_BYTES } from '../src/lib/initiative-logo'
import { checkPhotoFile, PHOTO_MAX_BYTES } from '../src/lib/profile-photo'

const MB = 1_048_576
const f = (name: string, type: string, size: number): FileLike => ({ name, type, size })

function labels() {
  assert.equal(limitLabel(ATTACHMENT_MAX_BYTES), '20MB')
  assert.equal(limitLabel(LOGO_MAX_BYTES), '2MB')
  assert.equal(limitLabel(PHOTO_MAX_BYTES), '2MB')
  assert.equal(limitLabel(4.5 * MB), '4.5MB')
}

function attachmentRules() {
  assert.equal(checkAttachmentFile(f('계약서.pdf', 'application/pdf', 3 * MB)), null)
  // Windows는 .xlsx의 type을 비워 준다 — 확장자로 통과해야 한다.
  assert.equal(checkAttachmentFile(f('매출.xlsx', '', 1 * MB)), null)
  // 사진은 크기를 보지 않는다(4.5MB 넘으면 줄여 올린다).
  assert.equal(checkAttachmentFile(f('명함.jpg', 'image/jpeg', 30 * MB)), null)

  const wrong = checkAttachmentFile(f('설치.exe', 'application/x-msdownload', 1 * MB))
  assert.ok(wrong?.includes('받지 않는 형식'), `형식 거절이어야 한다: ${wrong}`)
  assert.ok(wrong?.includes('PDF · Word · Excel · PowerPoint · PNG · JPG') && wrong.includes('20MB'), `받는 형식 · 상한이 들어가야 한다: ${wrong}`)

  const heic = checkAttachmentFile(f('IMG_0001.HEIC', 'image/heic', 2 * MB))
  assert.ok(heic?.includes('받지 않는 형식'), 'HEIC는 받지 않는다(요약이 PNG · JPG만 본다)')

  const big = checkAttachmentFile(f('도면.pdf', 'application/pdf', 25 * MB))
  assert.ok(big?.includes('25.0MB') && big.includes('20MB까지'), `크기 거절에 지금 크기와 상한: ${big}`)

  assert.ok(checkAttachmentFile(f('빈.pdf', 'application/pdf', 0))?.includes('빈 파일'))
}

function logoPhotoRules() {
  for (const check of [checkLogoFile, checkPhotoFile]) {
    assert.equal(check(f('a.png', 'image/png', 100_000)), null)
    assert.equal(check(f('a.webp', 'image/webp', 100_000)), null)
    // 서버 액션처럼 file.type만 본다 — 확장자만 맞아도 통과시키면 브라우저는 받고 서버가 거절한다.
    assert.ok(check(f('a.png', '', 100_000))?.includes('받지 않는 형식'))
    assert.ok(check(f('a.svg', 'image/svg+xml', 1_000))?.includes('PNG · JPG · WebP'), 'SVG는 받지 않는다')
    const big = check(f('얼굴.jpg', 'image/jpeg', 5 * MB))
    assert.ok(big?.includes('5.0MB') && big.includes('2MB까지'), `2MB 상한: ${big}`)
    // 경계: 정확히 2MB는 통과(서버도 > 로 본다).
    assert.equal(check(f('딱.jpg', 'image/jpeg', 2_097_152)), null)
  }
}

function order() {
  const files = [f('1.pdf', 'application/pdf', MB), f('2.exe', '', MB), f('3.docx', '', MB), f('4.pdf', 'application/pdf', 21 * MB), f('5.png', 'image/png', MB)]
  const plan = planDrop(files, checkAttachmentFile)
  assert.deepEqual(
    plan.map((v) => [v.file.name, v.verdict]),
    [
      ['1.pdf', 'take'],
      ['2.exe', 'reject'],
      ['3.docx', 'take'],
      ['4.pdf', 'reject'],
      ['5.png', 'take'],
    ],
  )
  // 올릴 순서 = 놓은 순서.
  assert.deepEqual(
    plan.filter((v) => v.verdict === 'take').map((v) => v.file.name),
    ['1.pdf', '3.docx', '5.png'],
  )
}

function singleFile() {
  // 첫 장이 틀린 형식이면 거절하고, 맞는 첫 장을 올린다. 그 뒤 맞는 파일은 «넘김».
  const plan = planDrop([f('a.pdf', 'application/pdf', MB), f('b.png', 'image/png', MB), f('c.jpg', 'image/jpeg', MB)], checkLogoFile, 1)
  assert.deepEqual(
    plan.map((v) => v.verdict),
    ['reject', 'take', 'skip'],
  )
  const skip = plan[2]
  assert.ok(skip.verdict === 'skip' && skip.reason.includes('한 장만'), '넘긴 이유를 말해야 한다')

  // 여러 장 칸에 max가 없으면 넘김이 없다.
  assert.ok(planDrop([f('a.pdf', 'application/pdf', MB), f('b.pdf', 'application/pdf', MB)], checkAttachmentFile).every((v) => v.verdict === 'take'))
  assert.deepEqual(planDrop([], checkAttachmentFile), [])
}

function summary() {
  assert.equal(dropSummary({ done: 2, failed: 0, rejected: 1, skipped: 0 }), '2개 올렸습니다 · 1개는 형식 · 크기가 맞지 않아 받지 않았습니다.')
  assert.equal(dropSummary({ done: 0, failed: 0, rejected: 0, skipped: 0 }), '올린 파일이 없습니다.')
}

const cases = { labels, attachmentRules, logoPhotoRules, order, singleFile, summary }
for (const [name, run] of Object.entries(cases)) {
  run()
  console.log(`ok  ${name}`)
}
console.log('check:file-drop 통과')
