/**
 * 0089 «받을 것» 카드 넷 스크린숏(PHASE E) — dummy 서버(진짜 AI 0회 · DB 없음 · 가짜 키만).
 *   서버 공통: NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_DATA_MODE=dummy CHAIRMAN_ENV=local
 *   SHOT_PHASE=CHAIR  (DUMMY_USER 없음 = 대표) — 빈 상태 → 가짜로 채운 상태
 *   SHOT_PHASE=STAFF  DUMMY_USER=sales_staff — 카드가 없다
 *   SHOT_BASE=http://localhost:3205 SHOT_OUT=docs/onboarding/intake-shots-1020 SHOT_PHASE=CHAIR npx tsx scripts/shot-owner-inputs.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3205'
const OUT = process.env.SHOT_OUT ?? 'docs/onboarding/intake-shots-1020'
const PHASE = process.env.SHOT_PHASE ?? 'CHAIR'

const log = (s: string) => console.log(`  ✓ ${s}`)
function must(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${why}`)
}

/** 본문(스크롤 칸) 전체 — «받을 것» 묶음만 찍는다. */
async function shot(page: Page, name: string) {
  // 셸이 본문만 스크롤해서 요소 사진이 잘린다 — 뷰포트를 본문 높이만큼 늘렸다 되돌린다.
  const vp = page.viewportSize()!
  const h = await page.evaluate(() => (document.querySelector('main')?.scrollHeight ?? 1000) + 200)
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 8000) })
  await page.waitForTimeout(400)
  const box = page.getByTestId('owner-inputs')
  if (await box.count()) await box.screenshot({ path: join(OUT, name) })
  else await page.screenshot({ path: join(OUT, name) })
  await page.setViewportSize(vp)
}

async function open(page: Page) {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 240_000 })
}

const FAKE_SA = {
  type: 'service_account',
  project_id: 'fake-chairman-staging',
  private_key_id: 'FAKE',
  private_key: '-----BEGIN PRIVATE KEY-----\nFAKE-NOT-A-REAL-KEY\n-----END PRIVATE KEY-----\n',
  client_email: 'fake-sheets@fake-chairman-staging.iam.gserviceaccount.com',
  client_id: '0',
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    if (PHASE === 'STAFF') {
      for (const w of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width: w, height: 900 } })
        await open(page)
        must((await page.getByTestId('owner-inputs').count()) === 0, `직원 ${w}px에 «받을 것» 카드가 보인다`)
        must(!(await page.locator('main').innerText()).includes('받을 것'), `직원 ${w}px에 «받을 것» 글자`)
        await page.screenshot({ path: join(OUT, `staff-none-${w}.png`) })
        log(`직원 ${w}px — 카드 없음`)
        await page.close()
      }
      return
    }

    // 빈 상태
    for (const w of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } })
      await open(page)
      await page.getByTestId('owner-inputs').waitFor({ timeout: 120_000 })
      const n = await page.getByTestId('owner-inputs').getByText('아직 없음').count()
      must(n >= 3, `빈 상태 «아직 없음» ${n}개`)
      await shot(page, `chair-empty-${w}.png`)
      log(`대표 빈 상태 ${w}px — «아직 없음» ${n}`)
      await page.close()
    }

    // 가짜로 채우기(1280에서 누르고, 둘 다 찍는다)
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await open(page)
    const box = page.getByTestId('owner-inputs')
    await box.waitFor({ timeout: 120_000 })
    // 재고평가방법 — 이동평균(월 가중평균과 다름 → 경고)
    await box.locator('input[name="inv-method"][value="moving_avg"]').check()
    await box.locator('textarea').first().fill('세무사 확인(가짜 시험 메모)')
    await box.locator('input[name="inv-method"]').first().locator('xpath=ancestor::form').locator('button').click()
    await page.waitForTimeout(1500)
    // 구글 서비스 계정 — 가짜 JSON
    const f = join(tmpdir(), 'fake-sa-shot.json')
    writeFileSync(f, JSON.stringify(FAKE_SA))
    const file = box.locator('input[type="file"]')
    await file.setInputFiles(f)
    await file.locator('xpath=ancestor::form').locator('button').click()
    await page.waitForTimeout(1500)
    // 원가 관리 권한자 — 첫 사람
    const sel = box.locator('select').last()
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    if (opts.length) {
      await sel.selectOption(opts[0])
      await sel.locator('xpath=ancestor::form').locator('button').click()
      await page.waitForTimeout(1500)
    }
    await open(page)
    await box.waitFor()
    const text = await box.innerText()
    must(!text.includes('FAKE-NOT-A-REAL-KEY') && !text.includes('PRIVATE KEY'), '키 본문이 화면에 보인다')
    must(text.includes(FAKE_SA.client_email), '서비스 계정 이메일이 안 보인다')
    log('구글 키 — 이메일만 보이고 본문 없음')
    await shot(page, 'chair-filled-1280.png')
    await page.setViewportSize({ width: 390, height: 900 })
    await page.waitForTimeout(400)
    await shot(page, 'chair-filled-390.png')
    log(`대표 채운 상태 — 받음 ${await box.getByText('받음').count()} · 경고 ${await box.getByTestId('inventory-warning').count()}`)
    await page.close()
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
