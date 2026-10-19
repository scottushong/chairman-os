/**
 * 0087 전자결재 화면 시험 · 사진 — dummy 서버 한 대를 사람마다 다시 켜며(DUMMY_USER) 처음부터 끝까지 누른다.
 * 상태는 DUMMY_EA_STATE 파일로 이어지고, 회사 줄은 DUMMY_EA_OPEN=biz_dy(«대표가 DY를 켠» 상태).
 *   E2E_STEP=a|b|c|d|e|f|g  E2E_BASE=http://localhost:3107  E2E_OUT=docs/onboarding/approvals-shots  npx tsx scripts/e2e-approvals.ts
 *   a 생산 직원(A) 구매품의 작성 · 첨부 · 상신          b 생산팀장(B) 검토 승인 + 두 번째 탭 승인 막힘
 *   c 대표 반려(사유 없으면 막힘)                       d A 보완해 재상신
 *   e B 검토 승인                                       f 대표 최종 승인
 *   g 구매 직원 후속 처리 완료(문서 승인 완료 그대로)   PC 1440 · 폰 390(가로 넘침 · «회장» 문구 검사)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

import { DUMMY_UID } from '../src/lib/repository/dummy-org'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3107'
const OUT = process.env.E2E_OUT ?? 'docs/onboarding/approvals-shots'
const STEP = process.env.E2E_STEP ?? 'a'
const STAFF = STEP !== 'c' && STEP !== 'f'

const log = (m: string) => console.log(`  [${STEP}] ${m}`)

async function shoot(page: Page, name: string) {
  const vp = page.viewportSize()!
  const h = await page.evaluate(() => {
    let m = document.documentElement.scrollHeight
    document.querySelectorAll('*').forEach((e) => {
      const s = getComputedStyle(e)
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4) m = Math.max(m, e.scrollHeight + (window.innerHeight - e.clientHeight))
    })
    return m
  })
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 9000) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
  await page.setViewportSize(vp)
  log(`사진 ${name}.png`)
}

async function guard(page: Page, what: string) {
  const text = await page.evaluate(() => document.body.innerText)
  if (STAFF && /회장|Chairman/.test(text)) throw new Error(`${what}: 직원 화면에 «회장»`)
  if (page.viewportSize()!.width <= 400) {
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    if (w > 392) throw new Error(`${what}: 폰 가로 넘침 ${w}px`)
  }
}

async function open(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 300_000 })
  await page.waitForTimeout(500)
}

async function firstDoc(page: Page): Promise<string> {
  const href = await page.locator('ul a[href*="doc="]').first().getAttribute('href')
  return /doc=([0-9a-f-]{36})/.exec(href ?? '')![1]
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const pc = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    if (STEP === 'a') {
      await open(pc, '/e-approval')
      await guard(pc, '빈 결재할 문서')
      await pc.getByRole('link', { name: '새 문서 작성' }).click()
      await pc.waitForURL(/new=1/)
      await shoot(pc, '01-pc-a-form-pick')
      await pc.getByRole('link', { name: /구매품의/ }).click()
      await pc.waitForURL(/new=purchase/)
      await pc.getByLabel('제목 *').fill('포장기 소모품 구매품의')
      await pc.getByLabel('신청 내용').fill('포장기 정기 유지보수용 소모품 구매를 요청합니다. 납품 희망일은 10월 23일입니다.')
      for (const [l, v] of [['품목 *', '포장기 소모품(벨트 · 씰)'], ['수량 *', '10'], ['거래처 *', '가나상사(예시)'], ['사용 목적 *', '정기 유지보수'], ['공급가 *', '320000'], ['부가세 *', '32000'], ['합계 *', '352000']]) await pc.getByLabel(l).fill(v)
      await pc.getByRole('button', { name: '+ 검토자' }).click()
      await pc.locator('fieldset', { hasText: '결재선' }).locator('select').first().selectOption(DUMMY_UID.prodLead)
      await pc.getByRole('button', { name: '+ 참조자' }).click()
      await pc.locator('fieldset', { hasText: '참조 · 열람' }).locator('select').first().selectOption(DUMMY_UID.salesStaff)
      await pc.getByLabel(/후속 담당자/).selectOption(DUMMY_UID.buyStaff)
      await pc.getByLabel(/처리 기한/).fill('2026-10-17')
      const pdf = join(tmpdir(), 'approvals-견적서-예시.pdf')
      writeFileSync(pdf, '%PDF-1.4\n% 개발용 예시 견적서 — 실제 문서 아님\n')
      // 상신 먼저 눌러 «첨부 필요»가 서버에서 막히는지 본다.
      await pc.getByRole('button', { name: '상신' }).click()
      await pc.getByRole('alert').filter({ hasText: '첨부가 필요' }).waitFor({ timeout: 60_000 })
      log('첨부 없이 상신 → 막힘')
      await pc.locator('input[aria-label="첨부파일 고르기"]').setInputFiles(pdf)
      await pc.getByText('approvals-견적서-예시.pdf').first().waitFor({ timeout: 60_000 })
      await shoot(pc, '02-pc-a-compose')
      await pc.getByRole('button', { name: '상신' }).click()
      await pc.waitForURL(/box=mine&doc=/, { timeout: 60_000 })
      await pc.waitForLoadState('networkidle')
      await guard(pc, '내가 올린 문서')
      await shoot(pc, '03-pc-a-mine')
      await open(phone, '/e-approval?box=drafts&new=purchase')
      await guard(phone, '폰 작성')
      await shoot(phone, '04-phone-a-compose')
      await open(phone, '/e-approval?box=mine')
      await guard(phone, '폰 내가 올린 문서')
      await shoot(phone, '05-phone-a-mine-list')
    }

    if (STEP === 'b' || STEP === 'e') {
      await open(pc, '/e-approval')
      const tab = await pc.getByRole('link', { name: /결재할 문서/ }).first().innerText()
      if (!/결재할 문서\s*1/.test(tab)) throw new Error(`B 결재할 문서 건수: ${tab}`)
      const id = await firstDoc(pc)
      await open(pc, `/e-approval?box=todo&doc=${id}`)
      await guard(pc, 'B 결재할 문서')
      if (STEP === 'b') await shoot(pc, '06-pc-b-todo(시안 비교)')
      await open(phone, '/e-approval?box=todo')
      await guard(phone, '폰 목록')
      if (STEP === 'b') await shoot(phone, '07-phone-b-todo-list')
      await open(phone, `/e-approval?box=todo&doc=${id}`)
      await guard(phone, '폰 상세')
      if (STEP === 'b') await shoot(phone, '08-phone-b-todo-detail')
      // 두 탭: 둘 다 열어 둔 채 한쪽에서 승인 → 다른 쪽 승인은 막혀야 한다.
      const tab2 = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await open(tab2, `/e-approval?box=todo&doc=${id}`)
      await pc.getByLabel(/의견 · 반려 시 필수/).fill('증빙 · 금액 확인했습니다.')
      await pc.getByRole('button', { name: '검토 승인' }).click()
      await pc.waitForLoadState('networkidle')
      await pc.waitForTimeout(800)
      await tab2.getByRole('button', { name: '검토 승인' }).click()
      await tab2.getByRole('alert').filter({ hasText: '이미 처리된 단계' }).waitFor({ timeout: 60_000 })
      log('두 번째 탭 승인 → 막힘')
      if (STEP === 'b') await shoot(tab2, '09-pc-b-second-tab-blocked')
      await open(pc, '/e-approval?box=history')
      const hist = await pc.locator('ul a[href*="doc="]').first().innerText()
      if (!/내 결과 승인/.test(hist) || !/문서 진행 중/.test(hist)) throw new Error(`B 처리 이력: ${hist}`)
      log('처리 이력 = 내 결과 승인 · 문서 진행 중')
      if (STEP === 'b') await shoot(pc, '10-pc-b-history')
    }

    if (STEP === 'c' || STEP === 'f') {
      await open(pc, '/e-approval?box=todo')
      const id = await firstDoc(pc)
      await open(pc, `/e-approval?box=todo&doc=${id}`)
      if (STEP === 'c') {
        await pc.getByRole('button', { name: '반려' }).click()
        await pc.getByRole('alert').filter({ hasText: '반려 사유' }).waitFor({ timeout: 60_000 })
        log('사유 없이 반려 → 막힘')
        await pc.getByLabel(/의견 · 반려 시 필수/).fill('견적을 두 곳 이상 비교해 다시 올려 주세요.')
        await pc.getByRole('button', { name: '반려' }).click()
        await pc.waitForLoadState('networkidle')
        await pc.waitForTimeout(800)
        await shoot(pc, '11-pc-chair-rejected')
      } else {
        await pc.getByRole('button', { name: '최종 승인' }).click()
        await pc.waitForLoadState('networkidle')
        await pc.waitForTimeout(800)
        await open(pc, `/e-approval?box=history&doc=${id}`)
        await shoot(pc, '14-pc-chair-approved')
      }
    }

    if (STEP === 'd') {
      await open(pc, '/e-approval?box=mine&st=rejected')
      const id = await firstDoc(pc)
      await open(pc, `/e-approval?box=mine&doc=${id}`)
      await pc.getByRole('button', { name: '보완해 재상신' }).click()
      await pc.waitForURL(/edit=/, { timeout: 60_000 })
      await pc.getByLabel('신청 내용').fill('견적 두 곳(가나상사 352,000원 · 다라상사 371,000원)을 비교해 가나상사로 올립니다.')
      await shoot(pc, '12-pc-a-resubmit-compose')
      await pc.getByRole('button', { name: '상신' }).click()
      await pc.waitForURL(/box=mine&doc=/, { timeout: 60_000 })
      await pc.waitForLoadState('networkidle')
      await shoot(pc, '13-pc-a-resubmitted')
    }

    if (STEP === 'g') {
      await open(pc, '/e-approval?box=followups')
      const id = await firstDoc(pc)
      await open(pc, `/e-approval?box=followups&doc=${id}`)
      await pc.getByPlaceholder(/처리 결과/).fill('발주서 PO-77 발송(예시)')
      await pc.getByPlaceholder(/이카운트 전표번호/).fill('20261019-1')
      await pc.getByRole('button', { name: '처리 완료' }).click()
      await pc.waitForLoadState('networkidle')
      await pc.waitForTimeout(800)
      const body = await pc.locator('article').innerText()
      if (!/처리 완료/.test(body) || !/승인 완료/.test(body)) throw new Error('후속 완료 뒤 상태')
      await guard(pc, '후속 처리')
      await shoot(pc, '15-pc-followup-done')
      await open(phone, `/e-approval?box=followups&doc=${id}`)
      await guard(phone, '폰 후속')
      await shoot(phone, '16-phone-followup-done')
    }
    console.log(`PASS ${STEP}`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
