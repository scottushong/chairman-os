/**
 * check:design — 0098 디자인 토큰 지킴이. 실패하면 던진다(어느 파일 · 어느 줄 · 무엇).
 *
 *   ① 토큰 밖의 색 0건 — src/**\/*.{ts,tsx,css}에서 #hex · rgb()/rgba()/hsl() 리터럴, Tailwind 기본 팔레트(bg-white · text-red-500 …)
 *      를 찾는다. 색이 사는 곳은 app/globals.css와 src/lib/design/ 둘뿐이다. 주석은 보지 않는다(설명 속 색 값은 코드가 아니다).
 *      한 줄 예외는 그 줄 끝 주석 «design-allow: 이유»로만 — 이유 없는 예외는 실패다.
 *   ② 글꼴 직접 지정 0건 — fontFamily · font-family: · font-[…] 를 찾는다(글꼴은 --font-sans · --font-display 토큰만).
 *   ③ 대비(WCAG AA 4.5:1) — globals.css의 토큰 블록을 읽어 두 모양 × 판(밝은 · 어두운 · 사이드바 · 심플)마다 글자/바탕 짝을 잰다.
 *      반투명 면은 그 판의 바탕(app) 위에 합성해서 잰다.
 *   ④ 토큰 두 벌이 같은 이름을 갖는다 — 새 모양에 있는 색 토큰은 예전 모양(classic)에도 있어야 한다(안 그러면 예전 모양에 새 색이 샌다).
 *
 *   npm run check:design
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const GLOBALS = join(SRC, 'app', 'globals.css')
const ALLOW_DIRS = [join(SRC, 'lib', 'design') + sep]
const ALLOW_FILES = [GLOBALS]

/* ------------------------------------------------------------------ ① ② 정적 검사 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

/** 주석을 지운다(같은 길이의 공백으로 — 줄 번호를 지키려고). 문자열 · 템플릿 안의 // 는 건드리지 않는다. */
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  let mode: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code'
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') mode = c
      out += c
      i += 1
      continue
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c } else out += ' '
      i += 1
      continue
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i += 1
      continue
    }
    // 문자열 안
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue }
    if (c === mode) mode = 'code'
    out += c
    i += 1
  }
  return out
}

const PALETTE = 'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const UTIL = 'bg|text|border|border-[trblxy]|from|to|via|ring|ring-offset|fill|stroke|divide|outline|shadow|decoration|placeholder|caret|accent'
const RULES: { what: string; re: RegExp }[] = [
  // 색 문맥의 #hex — 따옴표 · 대괄호 · 콜론 · 공백 · 괄호 · 쉼표 뒤. 주소 조각(href="#add")은 아래 제외.
  { what: '#hex 색', re: /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![-\w])/g },
  { what: 'rgb()/hsl() 색', re: /\b(?:rgba?|hsla?)\(\s*[\d.]/g },
  { what: 'Tailwind 기본 팔레트', re: new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${UTIL})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`, 'g') },
  { what: '글꼴 직접 지정', re: /\bfontFamily\b|font-family\s*:|(?<![\w-])font-\[/g },
]
/** 주소 조각 · 이름 표기처럼 색이 아닌 #xxx. */
const NOT_COLOR_BEFORE = /(href|to|id|hash|anchor)\s*=\s*\{?\s*[`'"][^`'"]*$/i

export interface Hit { file: string; line: number; what: string; text: string }

export function scanSource(file: string, src: string): Hit[] {
  const hits: Hit[] = []
  const code = stripComments(src)
  const rawLines = src.split('\n')
  code.split('\n').forEach((line, idx) => {
    const raw = rawLines[idx] ?? ''
    const allow = /design-allow:\s*\S+/.test(raw)
    for (const { what, re } of RULES) {
      re.lastIndex = 0
      for (let m = re.exec(line); m; m = re.exec(line)) {
        if (what === '#hex 색' && NOT_COLOR_BEFORE.test(line.slice(0, m.index))) continue
        if (allow) continue
        hits.push({ file: relative(ROOT, file), line: idx + 1, what, text: m[0] })
      }
    }
  })
  return hits
}

function staticScan(): { files: number; hits: Hit[] } {
  const files = walk(SRC).filter((f) => !ALLOW_FILES.includes(f) && !ALLOW_DIRS.some((d) => f.startsWith(d)))
  const hits = files.flatMap((f) => scanSource(f, readFileSync(f, 'utf8')))
  // 예외 표식에는 이유가 있어야 한다.
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/design-allow\b/.test(l) && !/design-allow:\s*\S+/.test(l)) hits.push({ file: relative(ROOT, f), line: i + 1, what: '이유 없는 design-allow', text: l.trim().slice(0, 60) })
    })
  }
  return { files: files.length, hits }
}

/* ------------------------------------------------------------------ ③ ④ 대비 · 두 벌 */

type RGBA = [number, number, number, number]

function parseColor(v: string): RGBA | null {
  const s = v.trim()
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (h) {
    const x = h[1].length === 3 ? [...h[1]].map((c) => c + c).join('') : h[1]
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), 1]
  }
  const r = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (r) return [Number(r[1]), Number(r[2]), Number(r[3]), r[4] === undefined ? 1 : Number(r[4])]
  return null
}

const over = (fg: RGBA, bg: RGBA): RGBA => {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}
const tone = (c: RGBA, pct: number): RGBA => [c[0], c[1], c[2], pct]
const lum = (c: RGBA) => {
  const [r, g, b] = c.slice(0, 3).map((v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: RGBA, b: RGBA) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** 선택자로 시작하는 블록 하나의 --color-* 선언. 처음 나온 블록만. */
function block(css: string, head: string): Record<string, string> {
  const at = css.indexOf(head)
  assert.ok(at >= 0, `globals.css에 «${head}» 블록이 없다`)
  const open = css.indexOf('{', at)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  const body = stripComments(css.slice(open + 1, end))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

interface Variant { name: string; tokens: Record<string, string> }

function variants(css: string): Variant[] {
  const newLight = block(css, '@theme static {')
  const newDark = { ...newLight, ...block(css, "[data-theme='dark'] {") }
  const sidebar = block(css, "[data-ui='new'] [data-surface='sidebar'] {")
  const sidebarDark = block(css, "[data-ui='new'][data-theme='dark'] [data-surface='sidebar'],")
  const classic = { ...newLight, ...block(css, "[data-ui='classic'] {") }
  const classicDark = { ...classic, ...block(css, ":is([data-ui='classic'][data-theme='dark'], [data-ui='classic'] [data-theme='dark']) {") }
  const simple = { ...classic, ...block(css, ":is([data-ui='classic'][data-skin='simple'], [data-ui='classic'] [data-skin='simple']) {") }
  return [
    { name: '새 모양 · 밝은 판', tokens: newLight },
    { name: '새 모양 · 어두운 판', tokens: newDark },
    { name: '새 모양 · 사이드바', tokens: { ...newLight, ...sidebar, app: sidebar.nav } },
    { name: '새 모양 · 어두운 판 사이드바', tokens: { ...newDark, ...sidebar, ...sidebarDark, app: sidebarDark.nav ?? sidebar.nav } },
    { name: '예전 모양 · 밝은 판', tokens: classic },
    { name: '예전 모양 · 어두운 판', tokens: classicDark },
    { name: '예전 모양 · 심플(직원)', tokens: simple },
  ]
}

export interface Pair { variant: string; fg: string; bg: string; ratio: number; need: number }

function measure(v: Variant): Pair[] {
  const t = v.tokens
  const col = (k: string): RGBA => {
    const c = parseColor(t[k] ?? '')
    assert.ok(c, `${v.name}: --color-${k} 값을 못 읽는다(${t[k]})`)
    return c
  }
  const app = col('app')
  const panel = over(col('panel'), app)
  const raised = over(col('raised'), panel)
  const nav = over(col('nav'), app)
  const out: Pair[] = []
  const add = (fg: string, bgName: string, bg: RGBA, need = 4.5) =>
    out.push({ variant: v.name, fg, bg: bgName, ratio: contrast(over(col(fg), bg), bg), need })

  const sidebar = v.name.includes('사이드바')
  for (const fg of ['ink', 'ink-dim', 'ink-muted']) {
    add(fg, sidebar ? 'nav' : 'app', sidebar ? nav : app)
    add(fg, 'panel', panel)
    add(fg, 'raised', raised)
  }
  const active = over(col('nav-active'), nav)
  add('nav-active-ink', 'nav-active', active)
  if (sidebar) {
    add('gold', 'nav', nav, 3) // 왕관 아이콘(그래픽 3:1)
    return out
  }
  for (const fg of ['accent-ink', 'gold-ink', 'link', 'critical', 'warning', 'ok', 'positive', 'negative']) add(fg, 'panel', panel)
  const solid = (fg: string, bgTok: string) => {
    const bg = over(col(bgTok), panel)
    out.push({ variant: v.name, fg, bg: bgTok, ratio: contrast(over(col(fg), bg), bg), need: 4.5 })
  }
  solid('on-accent', 'accent')
  solid('on-gold', 'gold')
  for (const s of ['critical', 'warning', 'ok']) solid('on-status', s)
  solid('on-dark', 'scrim')
  const tinted = (fg: string, bgTok: string, pct: number) => {
    const bg = over(tone(col(bgTok), pct), panel)
    out.push({ variant: v.name, fg, bg: `${bgTok}/${pct * 100}`, ratio: contrast(over(col(fg), bg), bg), need: 4.5 })
  }
  tinted('critical-ink', 'critical', 0.15)
  tinted('warning-ink', 'warning', 0.15)
  tinted('ok-ink', 'ok', 0.15)
  tinted('gold-tone-ink', 'gold', 0.15)
  for (const b of ['dy', 'vana', 'sticky', 'hof', 'boram']) tinted(`biz-${b}-ink`, `biz-${b}`, 0.2)
  for (const d of ['dday-from', 'dday-via', 'dday-to']) {
    const bg = col(d)
    out.push({ variant: v.name, fg: 'ink', bg: d, ratio: contrast(col('ink'), bg), need: 4.5 })
  }
  return out
}

function twoSets(css: string): string[] {
  const newNames = Object.keys(block(css, '@theme static {'))
  const classicNames = new Set(Object.keys(block(css, "[data-ui='classic'] {")))
  // 회사 식별색은 두 모양이 같은 값이라 classic에도 그대로 둔다 — 이름 누락만 본다.
  return newNames.filter((n) => !classicNames.has(n))
}

/* ------------------------------------------------------------------ 실행 */

function main() {
  // DESIGN_ONLY=src/components/city,src/app/x — 정적 검사만 그 경로로 좁힌다(작업 중 확인용). 대비 · 두 벌은 늘 본다.
  const only = (process.env.DESIGN_ONLY ?? '').split(',').map((s) => s.trim().replace(/\//g, sep)).filter(Boolean)
  const scanned = staticScan()
  const files = scanned.files
  const hits = only.length ? scanned.hits.filter((h) => only.some((o) => h.file.startsWith(o))) : scanned.hits
  const css = readFileSync(GLOBALS, 'utf8')
  const pairs = variants(css).flatMap(measure)
  const weak = pairs.filter((p) => p.ratio < p.need)
  const missing = twoSets(css)

  if (hits.length) {
    const byWhat = new Map<string, number>()
    for (const h of hits) byWhat.set(h.what, (byWhat.get(h.what) ?? 0) + 1)
    console.error(`토큰 밖 ${hits.length}건 — ${[...byWhat].map(([w, n]) => `${w} ${n}`).join(' · ')}`)
    for (const h of hits.slice(0, 80)) console.error(`  ${h.file}:${h.line}  ${h.what}  ${h.text}`)
    if (hits.length > 80) console.error(`  … 외 ${hits.length - 80}건`)
  }
  for (const p of weak) console.error(`  대비 미달 ${p.variant}: ${p.fg} / ${p.bg} = ${p.ratio.toFixed(2)} (< ${p.need})`)
  if (missing.length) console.error(`  예전 모양에 없는 토큰: ${missing.join(', ')}`)
  assert.equal(hits.length, 0, `토큰 밖의 색 · 글꼴 ${hits.length}건`)
  assert.equal(weak.length, 0, `대비 미달 ${weak.length}짝`)
  assert.equal(missing.length, 0, `예전 모양에 없는 토큰 ${missing.length}개`)

  const worst = [...pairs].sort((a, b) => a.ratio / a.need - b.ratio / b.need)[0]
  console.log(
    `PASS check:design — ${files}개 파일 토큰 밖 색 0 · 글꼴 직접 지정 0 · 대비 ${pairs.length}짝 AA(7판 · 최저 ${worst.variant} ${worst.fg}/${worst.bg} ${worst.ratio.toFixed(2)}) · 두 벌 이름 같음`,
  )
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/check-design.ts')) main()
