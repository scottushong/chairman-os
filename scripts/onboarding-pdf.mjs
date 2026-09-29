// 직원 안내서(docs/onboarding/*.md) → 인쇄용 A4 PDF 한 장.
// 사용: node scripts/onboarding-pdf.mjs [docs/onboarding/staff-ko.md]
// 마크다운 해석기는 이 문서가 쓰는 만큼만(제목 · 목록 · 표 · 굵게 · 가로줄 · <sub>) — 의존성을 늘리지 않는다.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const src = process.argv[2] ?? 'docs/onboarding/staff-ko.md'
const out = src.replace(/\.md$/, '.pdf')
const md = readFileSync(src, 'utf8')

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s) =>
  esc(s)
    .replace(/&lt;(\/?)sub&gt;/g, '<$1sub>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(https:\/\/[^\s)]+)/g, '<span class="url">$1</span>')

const lines = md.split(/\r?\n/)
let html = ''
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  if (/^\|/.test(l)) {
    const rows = []
    while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++])
    i--
    const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()))
    const [head, , ...body] = rows
    html += `<table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`
    html += body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
    html += '</tbody></table>'
  } else if (/^(\s*)(\d+\.|-) /.test(l)) {
    const items = []
    while (i < lines.length && /^(\s*)(\d+\.|-) /.test(lines[i])) items.push(lines[i++])
    i--
    const ordered = /^\d+\./.test(items[0].trim())
    let buf = ''
    let sub = []
    const flush = () => {
      if (sub.length) buf += `<ul>${sub.map((s) => `<li>${inline(s)}</li>`).join('')}</ul>`
      sub = []
    }
    for (const it of items) {
      const nested = /^\s+/.test(it)
      const text = it.trim().replace(/^(\d+\.|-) /, '')
      if (nested) sub.push(text)
      else {
        flush()
        buf += `${buf ? '</li>' : ''}<li>${inline(text)}`
      }
    }
    flush()
    const tag = ordered ? 'ol' : 'ul'
    html += `<${tag}>${buf}</li></${tag}>`
  } else if (/^#{1,3} /.test(l)) {
    const n = l.match(/^#+/)[0].length
    html += `<h${n}>${inline(l.slice(n + 1))}</h${n}>`
  } else if (/^---\s*$/.test(l)) html += '<hr>'
  else if (/^\s+\S/.test(l) && html.endsWith('</li></ol>')) {
    // 번호 목록 뒤의 들여쓴 이어 줄(괄호 설명) — 마지막 항목에 붙인다.
    html = html.replace(/<\/li><\/ol>$/, `<br><span class="note">${inline(l.trim())}</span></li></ol>`)
  } else if (l.trim()) html += `<p>${inline(l)}</p>`
}

const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 9mm 12mm; }
body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; font-size: 8.9pt; line-height: 1.34; color: #111; }
h1 { font-size: 14pt; margin: 0 0 1mm; }
h2 { font-size: 10.2pt; margin: 2.4mm 0 0.8mm; padding-bottom: 0.6mm; border-bottom: 1px solid #bbb; }
p { margin: 0.8mm 0; }
ul, ol { margin: 0.6mm 0; padding-left: 5.5mm; }
li { margin: 0.3mm 0; }
table { border-collapse: collapse; width: 100%; margin: 1mm 0; }
th, td { border: 1px solid #bbb; padding: 0.8mm 2mm; text-align: left; vertical-align: top; }
th { background: #f0f0f0; }
hr { border: 0; border-top: 1px solid #ddd; margin: 2mm 0; }
.url { font-family: Consolas, monospace; font-size: 9pt; }
.note { color: #555; }
sub { color: #777; }
</style></head><body>${html}</body></html>`

const browser = await chromium.launch()
const tab = await browser.newPage()
await tab.setContent(page)
await tab.pdf({ path: out, format: 'A4', printBackground: true })
await browser.close()
console.log(out)
