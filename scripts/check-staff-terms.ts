/**
 * 0098 직원 화면 «회장» 전수 검사 — 직원으로 띄운 dummy 서버에서 갈 수 있는 화면을 링크를 따라 전부 돌며
 * 보이는 글자 · 탭 제목 · aria-label · title · placeholder에 «회장 / 회장님 / Chairman / CHAIRMAN»이 있는지 본다(직원 화면 용어 원칙, CLAUDE.md).
 *
 *   서버: DUMMY_USER=sales_staff NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_DATA_MODE=dummy CHAIRMAN_ENV=local next dev --webpack -p 3198
 *   TERMS_BASE=http://localhost:3198 TERMS_ROLE=sales_staff npx tsx scripts/check-staff-terms.ts
 *   TERMS_MAX=화면 수 상한(기본 160) · TERMS_START=시작 주소들(쉼표, 기본 /me,/login,/settings)
 * 실패하면 던진다(화면 · 문장 조각).
 */
import assert from 'node:assert/strict'

import { chromium } from 'playwright'

const BASE = (process.env.TERMS_BASE ?? 'http://localhost:3198').replace(/\/+$/, '')
const ROLE = process.env.TERMS_ROLE ?? 'sales_staff'
const MAX = Number(process.env.TERMS_MAX ?? 160)
const START = (process.env.TERMS_START ?? '/me,/login,/settings').split(',').filter(Boolean)
const FORBIDDEN = /회장|chairman/i

/** 따라가지 않을 주소 — API · 파일 내려받기 · 로그아웃 · 바깥. */
const SKIP = /^\/(api|auth\/callback|_next)|\.(xlsx|csv|pdf|png|jpg|zip)(\?|$)|\/download|\/file\b/

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const seen = new Set<string>()
  const queue = [...START]
  const bad: { path: string; where: string; text: string }[] = []
  let visited = 0
  try {
    while (queue.length && visited < MAX) {
      const path = queue.shift()!
      const key = path.replace(/[?#].*$/, '') + (path.includes('?') ? `?${new URLSearchParams(path.split('?')[1]).toString()}` : '')
      if (seen.has(key)) continue
      seen.add(key)
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 240_000 })
      } catch (e) {
        console.log(`  ! ${path} 열기 실패 — ${(e as Error).message.slice(0, 80)}`)
        continue
      }
      visited += 1
      const finalPath = new URL(page.url()).pathname
      const found = await page.evaluate((src) => {
        const re = new RegExp(src, 'i')
        const out: { where: string; text: string }[] = []
        const text = document.body.innerText
        const m = text.match(new RegExp(`.{0,24}(${src}).{0,24}`, 'gi')) ?? []
        for (const t of m) out.push({ where: '글자', text: t.replace(/\s+/g, ' ') })
        if (re.test(document.title)) out.push({ where: '탭 제목', text: document.title })
        for (const el of Array.from(document.querySelectorAll('[aria-label],[title],[placeholder],img[alt]'))) {
          for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
            const v = el.getAttribute(a)
            if (v && re.test(v)) out.push({ where: a, text: v })
          }
        }
        return out
      }, FORBIDDEN.source)
      for (const f of found) bad.push({ path: finalPath, ...f })
      const links = await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href') ?? ''))
      for (const href of links) {
        if (!href || SKIP.test(href)) continue
        const clean = href.replace(/#.*$/, '')
        if (!seen.has(clean) && !queue.includes(clean)) queue.push(clean)
      }
      process.stdout.write(`  ${found.length ? '✗' : '✓'} ${finalPath}${found.length ? ` (${found.length})` : ''}\n`)
    }
  } finally {
    await browser.close()
  }
  const unique = [...new Map(bad.map((b) => [`${b.path}|${b.where}|${b.text}`, b])).values()]
  for (const b of unique.slice(0, 60)) console.error(`  ${b.path} [${b.where}] «${b.text}»`)
  assert.equal(unique.length, 0, `직원(${ROLE}) 화면에 «회장/Chairman» ${unique.length}곳`)
  console.log(`PASS check-staff-terms — ${ROLE} · ${visited}화면 · «회장/Chairman» 0곳`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
