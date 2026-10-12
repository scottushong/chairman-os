/**
 * «회계 · 재무 자료 올리기» v2 스크린숏 — dummy 서버 하나(FINANCE_UPLOAD_AI_MOCK=1 — 진짜 AI 0회)에 대고 돈다. 파일은 전부 가짜 값이다.
 *   SHOT_BASE=http://localhost:3102 SHOT_OUT=.screenshots/finance-upload SHOT_KIND=staff npx tsx scripts/shot-finance-upload.ts
 *   staff: 가짜 판매현황(자동) · 카드 합계 틀림(확인 필요) · 모르는 시트(종류 고르기) · 암호 걸린 파일(DRM 문구) → PC · 폰
 *   chair: 급여 합계 틀림(확인 필요 — 개인 줄 수는 대표에게만) · 체크표
 *   v21-staff · v21-chair(0072 — dummy 예시 달 2026-09, SHOT_OUT=.screenshots/finance-v21):
 *     v21-staff(DUMMY_USER=support_lead 서버): 올리기(중복 의심 미리보기 · 같은 거래) · 재고 · 평가(입력자 화면 — 확정 버튼 없음 ·
 *       미연결 · 차이 · 출고 합계 보류) · 직원 홈(예시 0 · «회장» 0) — PC 1440 · 폰 390(가로 넘침 검사)
 *     v21-chair(DUMMY_USER=chairman 서버): 재고 · 평가(확인자 화면 — 확정 버튼) · 대표 홈 «예시» 꼬리표 · «예시 숨기기»
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import { chromium, type Page } from 'playwright'

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

/** 폰에서 가로로 넘치는가(390). */
async function noOverflow(page: Page, what: string) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${what}: 폰 가로 넘침 ${w}px`)
}

async function bodyText(page: Page) {
  return page.locator('body').innerText()
}

/** 0072 — dummy 예시 달(2026-09) 화면들. 파일을 올리지 않는다(dummy 저장소의 예시 줄만 본다). */
async function v21() {
  mkdirSync(OUT, { recursive: true })
  const M = '2026-09'
  const browser = await chromium.launch()
  const shots: string[] = []
  const shoot = async (page: Page, name: string, full = true) => {
    const path = join(OUT, name)
    await page.screenshot({ path, fullPage: full })
    shots.push(path)
  }
  try {
    const pc = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const open = async (page: Page, url: string) => {
      await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 240_000 })
      await page.waitForTimeout(1200)
    }
    if (KIND === 'v21-staff') {
      // 1. 올리기 — 중복 의심 미리보기 · 같은 거래 칸
      await open(pc, `/finance/biz_dy/upload?month=${M}`)
      await pc.getByText('자료 간 중복 의심 1건').first().waitFor({ timeout: 60_000 })
      await pc.getByText('자료 간 같은 거래 · 2026-09').waitFor({ timeout: 60_000 })
      await shoot(pc, 'staff-1-upload-suspect-pc.png')
      await open(phone, `/finance/biz_dy/upload?month=${M}`)
      await noOverflow(phone, '올리기')
      await shoot(phone, 'staff-1-upload-suspect-phone.png')
      // 2. 재고 · 평가 — 입력자 화면(확정 버튼 없음) · 미연결 · 차이 · 출고 합계 보류
      await open(pc, `/finance/biz_dy/valuation?month=${M}`)
      if (await pc.getByRole('button', { name: '확정' }).count()) throw new Error('입력자 화면에 «확정» 버튼이 보인다')
      await pc.getByTestId('self-confirm-note').first().waitFor({ timeout: 30_000 })
      const roll = await pc.getByTestId('roll-finished').innerText()
      if (!roll.includes('미연결')) throw new Error(`완제품 기초가 «미연결»이 아니다: ${roll}`)
      if (!(await pc.getByTestId('roll-raw').innerText()).includes('차이')) throw new Error('원재료 명세서 기초 차이가 안 보인다')
      const issue = await pc.getByTestId('issue-summary').innerText()
      if (!issue.includes('보류') || !issue.includes('합계를 보이지 않습니다')) throw new Error(`출고 합계 보류 설명이 없다: ${issue}`)
      await shoot(pc, 'staff-2-valuation-enterer-pc.png')
      await pc.locator('#roll-h').scrollIntoViewIfNeeded()
      await shoot(pc, 'staff-3-roll-issue-pc.png', false)
      await open(phone, `/finance/biz_dy/valuation?month=${M}`)
      await noOverflow(phone, '재고 · 평가')
      await shoot(phone, 'staff-2-valuation-enterer-phone.png')
      // 2b. 원료 출고 구분 칸만(확인 필요 줄 수 · 이유 필수 일괄 결정 · 합계 보류 까닭)
      for (const [page, name] of [[phone, 'staff-3b-issue-phone.png'], [pc, 'staff-3b-issue-pc.png']] as const) {
        if (page === pc) await open(pc, `/finance/biz_dy/valuation?month=${M}`)
        const sec = page.locator('section[aria-labelledby="iss-h"]')
        await sec.scrollIntoViewIfNeeded()
        if (!(await sec.innerText()).includes('합계를 보이지 않습니다')) throw new Error('출고 칸에 보류 까닭이 없다')
        const path = join(OUT, name)
        await sec.screenshot({ path })
        shots.push(path)
      }
      // 3. 직원 홈 — 예시 0 · «회장» 0
      for (const [page, name] of [[pc, 'staff-4-home-pc.png'], [phone, 'staff-4-home-phone.png']] as const) {
        await open(page, '/me')
        if (await page.locator('[data-example-tag]').count()) throw new Error('직원 홈에 «예시» 줄이 보인다')
        // 0003 시드 업무 · 프로젝트 이름(예시)이 직원 화면에 없어야 한다.
        const t = await bodyText(page)
        for (const seed of ['Hot-melt 가격 승인', '폴란드 통관 서류 최종 확인', 'EVA 자동화 라인', '캐나다 시장 진출']) if (t.includes(seed)) throw new Error(`직원 홈에 예시 줄 «${seed}»`)
        await shoot(page, name)
      }
      await noOverflow(phone, '직원 홈')
      for (const url of ['/me', `/finance/biz_dy/upload?month=${M}`, `/finance/biz_dy/valuation?month=${M}`]) {
        await open(phone, url)
        const t = await bodyText(phone)
        if (/회장|chairman/i.test(t)) throw new Error(`직원 화면(${url})에 «회장/Chairman»`)
        if (/ECOUNT 올리기|ECOUNT 업로드/.test(t)) throw new Error(`직원 화면(${url})에 «ECOUNT 올리기»`)
      }
    } else {
      // 4. 재고 · 평가 — 확인자 화면(확정 버튼)
      await open(pc, `/finance/biz_dy/valuation?month=${M}`)
      await pc.getByRole('button', { name: '확정' }).first().waitFor({ timeout: 30_000 })
      await shoot(pc, 'chair-1-valuation-confirmer-pc.png')
      await open(phone, `/finance/biz_dy/valuation?month=${M}`)
      await noOverflow(phone, '재고 · 평가(대표)')
      await shoot(phone, 'chair-1-valuation-confirmer-phone.png')
      // 5. 대표 홈 — «예시» 꼬리표 · 숨기기
      await open(pc, '/')
      const tags = await pc.locator('[data-example-tag]').count()
      if (!tags) throw new Error('대표 홈에 «예시» 꼬리표가 없다')
      await shoot(pc, 'chair-2-home-examples-pc.png')
      // 2b. «예시» 꼬리표가 붙은 패널 하나(가까이)
      {
        // 알림 패널(결정 · 대기 · 알림 줄의 셋째 칸) — 예시 알림에 꼬리표가 붙는다.
        const panel = pc.locator('#alert-panel')
        if (!(await panel.locator('[data-example-tag]').count())) throw new Error('알림 패널에 «예시» 꼬리표가 없다')
        await panel.scrollIntoViewIfNeeded()
        const path = join(OUT, 'chair-2b-example-tags-pc.png')
        await panel.screenshot({ path })
        shots.push(path)
      }
      await open(phone, '/')
      await noOverflow(phone, '대표 홈')
      await shoot(phone, 'chair-2-home-examples-phone.png')
      await open(pc, '/?examples=hide')
      if (await pc.locator('[data-example-tag]').count()) throw new Error('«예시 숨기기» 뒤에도 예시 꼬리표가 보인다')
      await shoot(pc, 'chair-3-home-examples-hidden-pc.png')
      console.log(`예시 꼬리표 ${tags}개`)
    }
    console.log(shots.join('\n'))
    console.log('ok')
  } finally {
    await browser.close()
  }
}

/**
 * C단계 PDF · 사진(SHOT_OUT=.screenshots/finance-pdf). 서버는 FINANCE_UPLOAD_AI_MOCK=1 + 한도 env(가짜 읽기 — 진짜 AI 0회).
 *   pdf-chair(DUMMY_USER=chairman): 합계 틀린 카드 PDF → «확인 필요» 미리보기 · 급여대장 PDF · 배합비 PDF 거부 · 결산서 PDF → 공식 결산
 *   pdf-staff(DUMMY_USER=support_lead): PDF → «PDF · 사진은 준비 중» · 엑셀은 그대로 넣힘 · «회장» 0
 */
async function pdfShots() {
  const { textPdf } = await import('./fixtures/finance-pdf')
  mkdirSync(OUT, { recursive: true })
  const dir = join(OUT, 'files')
  mkdirSync(dir, { recursive: true })
  const ym = '2099-06'
  const t = (x: string) => [`회사명 : (주)가짜산업 / 2099/06/01 ~ 2099/06/30 / ${x}`]
  const put = (name: string, bytes: Uint8Array) => {
    writeFileSync(join(dir, name), Buffer.from(bytes))
    return join(dir, name)
  }
  const cardWrong = put('가짜 법인카드 6월.pdf', textPdf([[t('법인카드 사용내역'), ['이용일', '가맹점', '사용부서', '카드번호', '이용금액'], [`${ym}-04`, '가짜 식당', '경영지원', '1234-5678-9012-3456', 30000], [`${ym}-06`, '가짜 문구', '영업', '1234-5678-9012-3456', 12000], ['합계', null, null, null, 45000]]], 200))
  const payroll = put('가짜 6월 자료.pdf', textPdf([[['급여대장 2099년 6월'], ['사번', '성명', '부서', '기본급'], ['E001', '가짜이름일', '경영지원', 3000000]]]))
  const formula = put('가짜 배합비.pdf', textPdf([[['가짜 제품 배합'], ['원료', '비율'], ['가짜 원료 가', 50]]]))
  const stmt = put('2025 표준재무제표.pdf', textPdf([[
    ['표준재무제표'], ['제 5기 2025년 01월 01일 ~ 2025년 12월 31일'], ['재무상태표'],
    ['현금및현금성자산', 1000000], ['외상매출금', 500000], ['유형자산', 2000000], ['감가상각누계액', '(300,000)'], ['자산총계', 3200000],
    ['외상매입금', 400000], ['차입금', 1000000], ['부채총계', 1400000], ['자본금', 1800000], ['자본총계', 1800000],
    ['손익계산서'], ['제품매출', 5000000], ['원재료비', 3000000], ['급여(판관)', 800000], ['영업이익', 1200000],
  ]]))
  const staffPdf = put('가짜 판매현황.pdf', textPdf([[t('판매현황'), ['거래처명', '품목명', '수량', '단가', '공급가액'], ['가짜 거래처 A', '가짜 제품 1', 10, 1000, 10000], ['합계', null, 10, null, 10000]]]))
  await xlsx(join(dir, '가짜 판매현황 직원.xlsx'), '판매현황', [t('판매현황'), ['거래처명', '품목명', '수량', '단가', '공급가액'], ['가짜 거래처 S', '가짜 제품 9', 3, 1000, 3000], ['합계', null, 3, null, 3000]])
  const staffXlsx = join(dir, '가짜 판매현황 직원.xlsx')

  const browser = await chromium.launch()
  const shots: string[] = []
  const shoot = async (page: Page, name: string, full = true) => {
    const path = join(OUT, name)
    await page.screenshot({ path, fullPage: full })
    shots.push(path)
  }
  const shootEl = async (page: Page, sel: string, name: string) => {
    const el = page.locator(sel).first()
    await el.scrollIntoViewIfNeeded()
    const path = join(OUT, name)
    await el.screenshot({ path })
    shots.push(path)
  }
  try {
    const pc = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const upload = async (page: Page, files: string[]) => {
      await page.goto(`${BASE}/finance/biz_dy/upload`, { waitUntil: 'networkidle', timeout: 240_000 })
      await page.waitForTimeout(2500) // 화면이 붙기(hydration) 전에 파일을 넣으면 onChange가 없다
      await page.locator('input[type=file][multiple]').setInputFiles(files)
      await page.getByText('방금 올린 파일').waitFor({ timeout: 180_000 })
      await page.waitForTimeout(2000)
    }
    if (KIND === 'pdf-chair') {
      // 1. 합계 틀린 PDF → «확인 필요» + 급여 · 배합비 거부 + 결산서 → 공식 결산
      await upload(pc, [cardWrong, payroll, formula, stmt])
      const body = await bodyText(pc)
      for (const want of ['합계가 맞지 않습니다', '급여대장은 엑셀로 올려 주세요', '이 파일은 받을 수 없습니다', '공식 결산 미리보기']) if (!body.includes(want)) throw new Error(`PC 화면에 «${want}»가 없다`)
      await shoot(pc, 'chair-1-upload-pdf-pc.png')
      await shootEl(pc, 'section:has(> h2:text("방금 올린 파일"))', 'chair-2-cards-refused-official-pc.png')
      await shootEl(pc, '[data-testid="official-panel"]', 'chair-3-official-panel-pc.png')
      await shootEl(pc, 'section:has(> h2:has-text("확인 필요 ·")) article:has-text("가짜 법인카드 6월.pdf")', 'chair-4-pdf-preview-total-mismatch-pc.png')
      // 폰 — 같은 거부 · 공식 결산(카드는 화면마다 새로 올린다) + 위에서 남은 «확인 필요» 미리보기
      await upload(phone, [payroll, formula, stmt])
      await noOverflow(phone, '올리기(PDF · 대표)')
      const pb = await bodyText(phone)
      for (const want of ['합계가 맞지 않습니다', '급여대장은 엑셀로 올려 주세요', '이 파일은 받을 수 없습니다', '공식 결산 미리보기']) if (!pb.includes(want)) throw new Error(`폰 화면에 «${want}»가 없다`)
      await shoot(phone, 'chair-1-upload-pdf-phone.png')
      await shootEl(phone, 'section:has(> h2:text("방금 올린 파일"))', 'chair-2-cards-refused-official-phone.png')
      await shootEl(phone, 'section:has(> h2:has-text("확인 필요 ·")) article:has-text("가짜 법인카드 6월.pdf")', 'chair-4-pdf-preview-total-mismatch-phone.png')
    } else {
      // 2. 직원 — PDF는 «준비 중», 엑셀은 그대로
      await upload(pc, [staffPdf, staffXlsx])
      const body = await bodyText(pc)
      if (!body.includes('PDF · 사진은 준비 중')) throw new Error('직원 화면에 «PDF · 사진은 준비 중»이 없다')
      if (!body.includes('자동으로 넣었습니다')) throw new Error('직원 엑셀이 안 들어갔다')
      await shoot(pc, 'staff-1-pdf-later-pc.png')
      await shootEl(pc, 'section:has(> h2:text("방금 올린 파일"))', 'staff-2-cards-pc.png')
      await upload(phone, [staffPdf])
      await noOverflow(phone, '올리기(직원)')
      await shoot(phone, 'staff-1-pdf-later-phone.png')
      await shootEl(phone, 'section:has(> h2:text("방금 올린 파일"))', 'staff-2-cards-phone.png')
      for (const page of [pc, phone]) {
        const t2 = await bodyText(page)
        if (/회장|chairman/i.test(t2)) throw new Error('직원 화면에 «회장/Chairman»')
        if (/ECOUNT 올리기|ECOUNT 업로드/.test(t2)) throw new Error('직원 화면에 «ECOUNT 올리기»')
      }
    }
    console.log(shots.join('\n'))
    console.log('ok')
  } finally {
    await browser.close()
  }
}

async function main() {
  if (KIND.startsWith('v21')) return v21()
  if (KIND.startsWith('pdf-')) return pdfShots()
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
