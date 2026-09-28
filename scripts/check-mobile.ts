/**
 * check:mobile — 기기 6종 × 주요 화면 20개를 Playwright로 실측한다(회장 지시 2026-09-28 «모바일 전면 점검»).
 *
 * 실패 조건(화면 하나라도):
 *   hscroll   문서가 가로로 넘친다(scrollWidth > 화면 폭). 표 · 차트의 **자기 스크롤 상자** 안은 괜찮다.
 *   touch     눈에 보이는 누를 것(a · button · input · select · textarea · summary · [role=button])이 44×44 미만.
 *             문단 안의 글 링크는 뺀다(WCAG 2.5.8 inline 예외).
 *   font      눈에 보이는 글자가 13px 미만.
 *
 * 서버는 dummy 모드여야 한다(로그인 없음): Supabase 키를 비우고 띄운다 —
 *   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_DATA_MODE=dummy npx next dev -p 3100
 * MOBILE_BASE_URL(기본 http://localhost:3100) · MOBILE_SHOTS=1이면 .screenshots/mobile/<기기>/<화면>.jpg도 남긴다.
 * MOBILE_OUT=<폴더>로 결과 자리를 바꾼다(여럿이 동시에 돌릴 때). MOBILE_ONLY=<기기 key,...> · MOBILE_ROUTES=<화면 key,...>로 좁힌다. 결과 전체는 .screenshots/mobile/report.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Browser, type Page } from 'playwright'

const BASE = (process.env.MOBILE_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '')
const OUT = process.env.MOBILE_OUT ?? join(process.cwd(), '.screenshots', 'mobile')
const SHOTS = process.env.MOBILE_SHOTS === '1'

const PHONE_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

export const DEVICES = [
  { key: 'galaxy-s24', name: 'Galaxy S24', width: 360, height: 780, dpr: 3, ua: PHONE_UA },
  { key: 'galaxy-s24-ultra', name: 'Galaxy S24 Ultra', width: 412, height: 915, dpr: 3.5, ua: PHONE_UA },
  { key: 'iphone-15', name: 'iPhone 15', width: 393, height: 852, dpr: 3, ua: IOS_UA },
  { key: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', width: 430, height: 932, dpr: 3, ua: IOS_UA },
  { key: 'ipad-mini', name: 'iPad Mini', width: 744, height: 1133, dpr: 2, ua: IPAD_UA },
  { key: 'ipad-pro-11', name: 'iPad Pro 11', width: 834, height: 1194, dpr: 2, ua: IPAD_UA },
] as const

/** 주요 화면 20개. 상세 화면의 id는 dummy 데이터의 것이다. */
export const ROUTES = [
  { key: '01-home', path: '/' },
  { key: '02-morning', path: '/ai' },
  { key: '03-initiatives', path: '/initiatives' },
  { key: '04-initiative', path: '@initiative' },
  { key: '05-approvals', path: '/approvals' },
  { key: '06-approval-new', path: '/approvals/new' },
  { key: '07-finance', path: '/finance' },
  { key: '08-finance-biz', path: '/finance/biz_vana' },
  { key: '09-journal', path: '/finance/biz_vana/journal' },
  { key: '10-monthly', path: '/finance/biz_vana/monthly' },
  { key: '11-group-city', path: '/group' },
  { key: '12-business', path: '/business/biz_vana' },
  { key: '13-dependency', path: '/dependency/biz_vana' },
  { key: '14-process', path: '/process/3' },
  { key: '15-calendar', path: '/calendar' },
  { key: '16-chat', path: '/chat' },
  { key: '17-tasks', path: '/tasks' },
  { key: '18-users', path: '/settings/users' },
  { key: '19-activity', path: '/settings/activity' },
  { key: '20-me', path: '/me' },
] as const

export interface Finding {
  device: string
  route: string
  hscroll: { scrollWidth: number; width: number; culprits: string[] } | null
  touch: { count: number; samples: string[] }
  font: { count: number; minPx: number; samples: string[] }
  error?: string
}

async function resolvePath(page: Page, path: string): Promise<string> {
  if (path !== '@initiative') return path
  await page.goto(`${BASE}/initiatives`, { waitUntil: 'networkidle' })
  const href = await page.$$eval('a[href^="/initiatives/"]', (as) => as.map((a) => a.getAttribute('href') ?? '')[0])
  return href || '/initiatives'
}

/** 브라우저 안에서 도는 측정. 문자열로 넘기지 않고 함수로 넘겨 타입 검사를 받는다. */
function measure() {
  const vw = document.documentElement.clientWidth
  const describe = (el: Element) => {
    const id = el.id ? `#${el.id}` : ''
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${el.tagName.toLowerCase()}${id}${cls ? '.' + cls : ''}${text ? ` «${text}»` : ''}`
  }
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    // 가려진 조상(0 크기 · overflow 잘림)은 여기서 다 보지 않는다 — 눈에 보이는 폭이 있으면 센다.
    return true
  }
  /** 자기 가로 스크롤 상자 안에 있는가 — 표 · 차트 스와이프 영역. */
  const inScroller = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.tagName === 'MAIN') return false
      const s = getComputedStyle(p)
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) return true
    }
    return false
  }

  // 셸은 화면에 고정되고 본문 <main>이 스크롤한다 — 문서만 보면 <main> 안의 가로 넘침을 못 본다. 둘 다 잰다.
  const mains = Array.from(document.querySelectorAll('main'))
  const scrollWidth = Math.max(
    document.documentElement.scrollWidth,
    ...mains.map((m) => m.scrollWidth - m.clientWidth + vw),
  )
  let hscroll: { scrollWidth: number; width: number; culprits: string[] } | null = null
  if (scrollWidth > vw + 1) {
    const culprits: string[] = []
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 && r.width > 0 && !inScroller(el) && visible(el)) {
        // 넘친 가장 바깥 것만 — 자식은 부모를 따라 넘친다.
        const parent = el.parentElement
        if (parent && parent.getBoundingClientRect().right > vw + 1 && !inScroller(parent)) continue
        culprits.push(`${describe(el)} →${Math.round(r.right)}`)
        if (culprits.length >= 6) break
      }
    }
    hscroll = { scrollWidth, width: vw, culprits }
  }

  const touchSamples: string[] = []
  let touchCount = 0
  const interactive = document.querySelectorAll(
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]',
  )
  for (const el of Array.from(interactive)) {
    if (!visible(el)) continue
    if (el.closest('[aria-hidden=true]')) continue
    const r = el.getBoundingClientRect()
    if (r.right < 0 || r.left > vw) continue
    // 문단 속 글 링크는 예외(WCAG 2.5.8) — 부모가 글 흐름(p · li의 글)이고 링크가 inline이면.
    const s = getComputedStyle(el)
    if (el.tagName === 'A' && s.display === 'inline' && el.parentElement?.closest('p')) continue
    // 체크박스 · 라디오는 label이 과녁이다 — label 크기를 본다.
    let box = r
    const input = el as HTMLInputElement
    if (el.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio')) {
      const label = el.closest('label') ?? (input.id ? document.querySelector(`label[for="${input.id}"]`) : null)
      if (label) box = label.getBoundingClientRect()
    }
    if (box.width < 43.5 || box.height < 43.5) {
      touchCount++
      if (touchSamples.length < 8) touchSamples.push(`${describe(el)} ${Math.round(box.width)}×${Math.round(box.height)}`)
    }
  }

  const fontSamples: string[] = []
  let fontCount = 0
  let minPx = Infinity
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set<Element>()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue
    const el = n.parentElement
    if (!el || seen.has(el)) continue
    seen.add(el)
    if (el.closest('svg, script, style, noscript, [aria-hidden=true], .sr-only')) continue
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right < 0 || r.left > vw) continue
    const px = parseFloat(getComputedStyle(el).fontSize)
    if (px < 12.95) {
      fontCount++
      minPx = Math.min(minPx, px)
      if (fontSamples.length < 8) fontSamples.push(`${describe(el)} ${px}px`)
    }
  }

  return {
    hscroll,
    touch: { count: touchCount, samples: touchSamples },
    font: { count: fontCount, minPx: minPx === Infinity ? 0 : minPx, samples: fontSamples },
  }
}

async function run(browser: Browser) {
  const onlyDevices = process.env.MOBILE_ONLY?.split(',')
  const onlyRoutes = process.env.MOBILE_ROUTES?.split(',')
  const devices = DEVICES.filter((d) => !onlyDevices || onlyDevices.includes(d.key))
  const routes = ROUTES.filter((r) => !onlyRoutes || onlyRoutes.includes(r.key))
  const findings: Finding[] = []

  for (const d of devices) {
    const ctx = await browser.newContext({
      viewport: { width: d.width, height: d.height },
      deviceScaleFactor: d.dpr,
      isMobile: true,
      hasTouch: true,
      userAgent: d.ua,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    })
    // tsx(esbuild keepNames)가 measure() 안에 __name(...) 호출을 심는다 — 브라우저에는 없으니 빈 것으로.
    await ctx.addInitScript('globalThis.__name = (f) => f')
    const page = await ctx.newPage()
    if (SHOTS) mkdirSync(join(OUT, d.key), { recursive: true })
    for (const r of routes) {
      const f: Finding = { device: d.key, route: r.key, hscroll: null, touch: { count: 0, samples: [] }, font: { count: 0, minPx: 0, samples: [] } }
      try {
        const path = await resolvePath(page, r.path)
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 120_000 })
        await page.waitForTimeout(400)
        Object.assign(f, await page.evaluate(measure))
        if (SHOTS) {
          // 본문이 <main> 안에서 스크롤하므로 fullPage로는 첫 화면만 찍힌다. 찍을 때만 셸 높이를 풀어 전체를 편다.
          // 개발 서버의 Next 표식(nextjs-portal)도 가린다 — production에는 없다.
          await page.addStyleTag({
            content:
              'html,body,#app-shell,#app-shell>div,[data-theme=dark].h-full,[data-theme=dark].h-full>div{height:auto!important;min-height:100%}main{overflow:visible!important;flex:none!important}nextjs-portal{display:none!important}',
          })
          await page.waitForTimeout(150)
          await page.screenshot({ path: join(OUT, d.key, `${r.key}.jpg`), fullPage: true, type: 'jpeg', quality: 70, scale: 'css' })
        }
      } catch (e) {
        f.error = e instanceof Error ? e.message.split('\n')[0] : String(e)
      }
      findings.push(f)
      const bad = [f.error ? `ERR ${f.error}` : '', f.hscroll ? `hscroll ${f.hscroll.scrollWidth}` : '', f.touch.count ? `touch ${f.touch.count}` : '', f.font.count ? `font ${f.font.count}(${f.font.minPx}px)` : '']
        .filter(Boolean)
        .join(' · ')
      console.log(`${bad ? 'FAIL' : 'ok  '} ${d.key.padEnd(18)} ${r.key.padEnd(16)} ${bad}`)
    }
    await ctx.close()
  }
  return findings
}

async function main() {
  const browser = await chromium.launch()
  let findings: Finding[]
  try {
    findings = await run(browser)
  } finally {
    await browser.close()
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(findings, null, 2))
  const failed = findings.filter((f) => f.error || f.hscroll || f.touch.count || f.font.count)
  console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'}: ${findings.length - failed.length}/${findings.length} (기기 × 화면) — 가로 스크롤 · 44px 터치 · 13px 글자`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
