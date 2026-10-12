/**
 * «회계 · 재무 자료 올리기» v2 스크린숏 — dummy 서버 하나(FINANCE_UPLOAD_AI_MOCK=1 — 진짜 AI 0회)에 대고 돈다. 파일은 전부 가짜 값이다.
 *   SHOT_BASE=http://localhost:3102 SHOT_OUT=.screenshots/finance-upload SHOT_KIND=staff npx tsx scripts/shot-finance-upload.ts
 *   staff: 가짜 판매현황(자동) · 카드 합계 틀림(확인 필요) · 모르는 시트(종류 고르기) · 암호 걸린 파일(DRM 문구) → PC · 폰
 *   chair: 급여 합계 틀림(확인 필요 — 개인 줄 수는 대표에게만) · 체크표
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import { chromium } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3102'
const OUT = process.env.SHOT_OUT ?? '.screenshots/finance-upload'
const KIND = process.env.SHOT_KIND ?? 'staff'
type Cell = string | number | null

async function xlsx(path: string, name: string, rows: Cell[][]) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(name)
  for (const r of rows) ws.addRow(r)
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()))
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const dir = join(OUT, 'files')
  mkdirSync(dir, { recursive: true })
  const ym = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7)
  const t = (x: string) => [`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / ${x}`]
  const files: string[] = []
  if (KIND === 'staff') {
    await xlsx(join(dir, '가짜 판매현황.xlsx'), '판매현황', [t('판매현황'), ['거래처명', '품목명', '수량', '단가', '공급가액'], ['가짜 거래처 A', '가짜 제품 1', 10, 1000, 10000], ['가짜 거래처 B', '가짜 제품 2', 5, 2000, 10000], ['합계', null, 15, null, 20000]])
    await xlsx(join(dir, '가짜 법인카드.xlsx'), '법인카드', [t('법인카드 사용내역'), ['이용일', '가맹점', '사용부서', '카드번호', '이용금액'], [`${ym}-04`, '가짜 식당', '경영지원', '1234-5678-9012-3456', 30000], [`${ym}-06`, '가짜 문구', '영업', '1234-5678-9012-3456', 12000], ['합계', null, null, null, 45000]])
    await xlsx(join(dir, '가짜 메모.xlsx'), 'Sheet1', [['가짜 메모 시트'], ['가', '나', '다'], [1, 2, 3]])
    writeFileSync(join(dir, '가짜 암호 걸린.xlsx'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]))
    files.push('가짜 판매현황.xlsx', '가짜 법인카드.xlsx', '가짜 메모.xlsx', '가짜 암호 걸린.xlsx')
  } else {
    await xlsx(join(dir, '가짜 급여대장.xlsx'), '급여대장', [t('급여대장'), ['사번', '성명', '주민번호', '부서', '기본급', '상여', '퇴직급여', '계좌번호'], ['E001', '가짜이름일', '900101-1234567', '경영지원', 3000000, 0, 0, '110-1'], ['E002', '가짜이름이', '910202-2345678', '영업', 2800000, 0, 0, '110-2'], ['합계', null, null, null, 9999999, 0, 0, null]])
    await xlsx(join(dir, '가짜 대출현황.xlsx'), '대출현황', [t('대출현황'), ['금융기관', '대출금액', '금리', '만기일', '상환조건', '원금상환', '이자'], ['가짜 은행', 500000000, 4.5, '2030-12-31', '만기 일시', 0, 1875000], ['합계', 500000000, null, null, null, 0, 1875000]])
    files.push('가짜 급여대장.xlsx', '가짜 대출현황.xlsx')
  }
  const browser = await chromium.launch()
  try {
    const pc = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await pc.goto(`${BASE}/finance/biz_dy/upload`, { waitUntil: 'networkidle', timeout: 240_000 })
    await pc.locator('input[type=file][multiple]').setInputFiles(files.map((f) => join(dir, f)))
    await pc.getByText(KIND === 'staff' ? '방금 올린 파일' : '방금 올린 파일').waitFor({ timeout: 180_000 })
    await pc.waitForTimeout(2500)
    await pc.screenshot({ path: join(OUT, `${KIND}-1-pc.png`), fullPage: true })
    const main = pc.locator('main').first()
    if (await main.count()) await main.screenshot({ path: join(OUT, `${KIND}-1b-pc-main.png`) })
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await phone.goto(`${BASE}/finance/biz_dy/upload`, { waitUntil: 'networkidle', timeout: 240_000 })
    await phone.waitForTimeout(1500)
    await phone.screenshot({ path: join(OUT, `${KIND}-2-phone.png`), fullPage: true })
    const body = await phone.locator('body').innerText()
    if (KIND === 'staff' && /회장|chairman/i.test(body)) throw new Error('직원 화면에 «회장/Chairman»')
    if (/ECOUNT 업로드/.test(body)) throw new Error('화면에 «ECOUNT 업로드»가 남았다')
    console.log('ok')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
