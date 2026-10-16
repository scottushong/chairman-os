/**
 * 2026-10-17 공식 결산(표준재무제표 PDF) 미리보기 스크린숏 · 저장 — dummy 서버(DUMMY_USER=chairman · FINANCE_UPLOAD_AI_MOCK=1 — 진짜 AI 0회).
 * 파일은 지어낸 세 해 결산서(번호 붙은 줄 · 로마 숫자 묶음 · 제조원가명세서)다.
 *   SHOT_BASE=http://localhost:3102 SHOT_OUT=.screenshots/official-pdf npx tsx scripts/shot-official-pdf.ts
 * 잰다: 해 탭 셋 · 못 맞춘 줄을 묶음마다 한 번에 · 저장 단추가 꺼진 까닭 목록 · 증빙 링크 넣으면 켜짐 · 저장 → «2025년을 … 저장했습니다» ·
 * 다음 해 저장 · 폰 390 가로 넘침 없음.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright'

import { textPdf } from './fixtures/finance-pdf'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3102'
const OUT = process.env.SHOT_OUT ?? '.screenshots/official-pdf'
const BIZ = process.env.SHOT_BIZ ?? 'biz_vana'

async function main() {
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, '2024~5 표준재무제표.pdf')
  writeFileSync(
    file,
    textPdf([[
      ['표준재무제표 (가짜)'],
      ['계정과목', '2024', '2025'],
      ['표준대차대조표'],
      ['자산'],
      ['Ⅰ.유동자산', 260, 370],
      ['(1)당좌자산', 260, 370],
      ['1.현금및현금성자산', 200, 300],
      ['2.매출채권', 60, 70],
      ['(2)유형자산', 1200, 1050],
      ['1.건물', 1000, 1000],
      ['2.감가상각누계액', 200, 300],
      ['3.기계장치', 500, 500],
      ['4.감가상각누계액', 100, 150],
      ['자산총계', 1460, 1420],
      ['부채'],
      ['1.매입채무', 260, 220],
      ['2.단기차입금', 200, 200],
      ['부채총계', 460, 420],
      ['자본'],
      ['1.보통주자본금', 500, 500],
      ['1.미처분이익잉여금', 500, 500],
      ['자본총계', 1000, 1000],
      ['표준손익계산서'],
      ['Ⅰ.매출액', 2100, 2200],
      ['1.제품매출', 2100, 2200],
      ['Ⅱ.매출원가', 1300, 1400],
      ['Ⅳ.판매비와관리비', 465, 465],
      ['1.급여', 300, 300],
      ['7.감가상각비', 150, 150],
      ['29.전기료', 10, 10],
      ['34.해외시장개척비', 5, 5],
      ['Ⅵ.영업외수익', 7, 9],
      ['1.이자수익', 2, 3],
      ['7.외화환산이익', 5, 6],
      ['Ⅶ.영업외비용', 20, 20],
      ['1.이자비용', 20, 20],
      ['Ⅸ.법인세비용', 30, 30],
      ['Ⅹ.당기순이익', 292, 294],
    ]], 140),
  )
  const browser = await chromium.launch()
  try {
    const pc = await browser.newPage({ viewport: { width: 1440, height: 1600 } })
    await pc.goto(`${BASE}/finance/${BIZ}/upload`, { waitUntil: 'networkidle', timeout: 240_000 })
    await pc.waitForTimeout(2500)
    await pc.locator('input[type=file][multiple]').setInputFiles([file])
    await pc.getByRole('button', { name: '파일 고르기' }).waitFor({ timeout: 240_000 })
    const panel = pc.getByTestId('official-panel')
    await panel.waitFor({ timeout: 60_000 })
    await panel.scrollIntoViewIfNeeded()
    await panel.screenshot({ path: join(OUT, '1-preview-pc.png') })
    const tabs = await panel.getByRole('tab').allInnerTexts()
    const blockers1 = await panel.getByTestId('official-blockers').innerText()
    // 못 맞춘 줄: 매출원가 묶음 줄(→ 기타제조경비) · 해외시장개척비(→ 광고선전비) — 묶음마다 한 번에
    await panel.getByLabel('매출원가 안 고른 줄 한 번에').selectOption('4590')
    await panel.getByLabel('판관비 안 고른 줄 한 번에').selectOption('8330')
    await panel.getByPlaceholder('https://drive.google.com/…').fill('https://example.invalid/fake-2025.pdf')
    await panel.screenshot({ path: join(OUT, '2-ready-pc.png') })
    const blockers2 = await panel.getByTestId('official-blockers').count()
    const save = panel.getByRole('button', { name: /공식 결산으로 저장/ })
    const enabled = await save.isEnabled()
    await save.click()
    await panel.getByText(/2025년을 공식 결산으로 저장했습니다/).waitFor({ timeout: 60_000 })
    await panel.getByRole('tab', { name: '2024' }).click()
    await panel.getByText(/2024 자산/).waitFor({ timeout: 10_000 })
    const net2024 = await panel.getByText(/당기순이익/).first().innerText()
    await panel.getByRole('button', { name: /2024년 공식 결산으로 저장/ }).click()
    await panel.getByText(/2024년을 공식 결산으로 저장했습니다/).waitFor({ timeout: 60_000 })
    await panel.screenshot({ path: join(OUT, '3-saved-pc.png') })

    const phone = await browser.newPage({ viewport: { width: 390, height: 1400 } })
    await phone.goto(`${BASE}/finance/${BIZ}/upload`, { waitUntil: 'networkidle', timeout: 240_000 })
    await phone.waitForTimeout(2500)
    await phone.locator('input[type=file][multiple]').setInputFiles([file])
    await phone.getByRole('button', { name: '파일 고르기' }).waitFor({ timeout: 240_000 })
    const pp = phone.getByTestId('official-panel')
    await pp.waitFor({ timeout: 60_000 })
    await pp.scrollIntoViewIfNeeded()
    await pp.screenshot({ path: join(OUT, '4-preview-phone.png') })
    const w = await phone.evaluate(() => document.documentElement.scrollWidth)

    console.log(JSON.stringify({ tabs, blockers1, blockers2, enabled, net2024, phoneWidth: w }, null, 1))
    if (tabs.length !== 2) throw new Error(`해 탭: ${tabs}`)
    if (!enabled || blockers2) throw new Error('증빙 · 계정을 다 넣었는데 저장 단추가 꺼져 있다')
    if (w > 391) throw new Error(`폰 가로 넘침 ${w}px`)
    console.log('PASS: 해 탭 · 묶음마다 한 번에 · 꺼진 까닭 목록 · 2025 · 2024 저장 · 폰 390')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
