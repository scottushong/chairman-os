/**
 * 진짜 AI 호출 확인(2026-10-14 운영 400 뒤) — **가짜 파일 · 가짜 글만**, 진짜 회사 파일 · DB 없음(dummy repo). 돈이 든다.
 *
 *   npx tsx --conditions=react-server scripts/probe-ai-real.ts --yes <단계>
 *     ledger   ⑤ ECOUNT 모양 원장(코드가 모르는 요약 낱말) → 구조 해석 · 대조 · 재해석(최대 3번)
 *     pdf      세무사 표준재무제표 글 PDF → 공식 결산(읽기 1번)
 *     scan     같은 결산서를 그림으로 만든 스캔 PDF → document 블록(1번)
 *     photo    같은 그림을 사진(png)으로 → image 블록(1번)
 *     others   어시스턴트(도구 정의 전부) · 보완 의견 정리 · 브리핑 · 첨부 요약 · 자료 받는 입구 — 요청 모양만(각 1번)
 *
 * 키 · 모델은 .env.local의 ANTHROPIC_API_KEY · AI_MODEL만 읽는다(다른 값은 읽지 않는다). 호출 수를 센다(api.anthropic.com).
 */
import { readFileSync } from 'node:fs'

import sharp from 'sharp'

const argv = process.argv.slice(2)
if (!argv.includes('--yes')) {
  console.error('돈이 드는 진짜 AI 호출입니다 — --yes를 붙이세요.')
  process.exit(2)
}
const step = argv.find((a) => !a.startsWith('--')) ?? ''
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^(ANTHROPIC_API_KEY|AI_MODEL)=(.*)$/.exec(line)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
delete process.env.FINANCE_UPLOAD_AI_MOCK
let calls = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.startsWith('https://api.anthropic.com/')) throw new Error(`막은 주소: ${url}`)
  calls += 1
  return realFetch(input, init)
}) as typeof fetch

const BIZ = 'biz_dy'

/** 결산서 그림(가짜 숫자) — 한글 글꼴은 이 PC의 맑은 고딕. */
async function statementPng(): Promise<Uint8Array> {
  const lines = [
    '표준재무제표 — (주)가짜산업', '제 5기 2025년 01월 01일 ~ 2025년 12월 31일', '재무상태표', '현금및현금성자산 1,000,000', '외상매출금 500,000', '유형자산 2,000,000', '감가상각누계액 (300,000)', '자산총계 3,200,000',
    '외상매입금 400,000', '차입금 1,000,000', '부채총계 1,400,000', '자본금 1,800,000', '자본총계 1,800,000', '손익계산서', '제품매출 5,000,000', '원재료비 3,000,000', '급여(판관) 800,000', '영업이익 1,200,000',
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${80 + lines.length * 44}"><rect width="100%" height="100%" fill="white"/>${lines
    .map((t, i) => `<text x="40" y="${60 + i * 44}" font-family="Malgun Gothic" font-size="26" fill="black">${t}</text>`)
    .join('')}</svg>`
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function main() {
  process.env.DUMMY_USER = 'chairman'
  const { dummyRepository: repo } = await import('../src/lib/repository/dummy')
  const { processUpload } = await import('../src/lib/finance-upload/process')
  const { realClassifier } = await import('../src/lib/finance-upload/ai')
  const { realDocReader } = await import('../src/lib/finance-upload/ai-doc')
  const ledger = await repo.loadFinanceLedger()
  const accounts = ledger.accounts.filter((a) => a.business_id === BIZ && a.active).map((a) => ({ account_code: a.account_code, name: a.name, section: a.section }))
  const docs = { allowed: true, read: realDocReader(repo, BIZ), businessName: '가짜산업', accounts }
  const show = (cards: unknown) => console.log(JSON.stringify(cards, (k, v) => (k === 'official' && v ? { lines: v.lines?.length, period_key: v.period_key, unmatched: v.unmatched, balanced: v.balance?.balanced, errors: v.errors, warnings: v.warnings } : v), 1).slice(0, 3000))

  if (step === 'ledger') {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('계정별원장')
    const d = (n: number) => `2098/01/${String(n).padStart(2, '0')}`
    const rows: (string | number | null)[][] = [
      ['계정별원장'], ['회사명 : (주)가짜산업 / 2098/01/01 ~ 2098/01/31'], ['일자-No.', '적요', '거래처코드', '거래처명', '차변', '대변', '잔액'],
      ['1509 (제품)'], [null, '[전기이월]', null, null, null, null, 1_000_000],
      [`${d(5)} -1`, '가짜 제품 입고', 'C01', '가짜 거래처 갑', 300_000, null, 1_300_000], [d(5), '[당일합산]', null, null, 300_000, 0, 1_300_000],
      [`${d(20)} -3`, '가짜 제품 출고', 'C02', '가짜 거래처 을', null, 200_000, 1_100_000], [d(20), '[당일합산]', null, null, 0, 200_000, 1_100_000],
      [null, '[월    계]', null, null, 300_000, 200_000, 1_100_000], [null, '[누    계]', null, null, 300_000, 200_000, 1_100_000],
      ['2519 (외상매입금)'], [null, '[전기이월]', null, null, null, null, -5_000_000],
      [`${d(3)} -2`, '가짜 원재료 매입', 'S01', '가짜 공급처 병', null, 700_000, -5_700_000], [d(3), '[당일합산]', null, null, 0, 700_000, -5_700_000],
      [`${d(25)} -1`, '가짜 대금 지급', 'S01', '가짜 공급처 병', 400_000, null, -5_300_000], [d(25), '[당일합산]', null, null, 400_000, 0, -5_300_000],
      [null, '[월    계]', null, null, 400_000, 700_000, -5_300_000], [null, '[누    계]', null, null, 400_000, 700_000, -5_300_000],
    ]
    for (const r of rows) ws.addRow(r)
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    const cards = await processUpload({ repo, businessId: BIZ, fileName: '가짜 1월 계정별 원장.xlsx', bytes, classify: realClassifier(repo, BIZ), aiBudget: 3, today: new Date('2098-02-10'), docs })
    show(cards)
    const p = cards[0]?.upload_id ? await repo.finUploadPending(cards[0].upload_id) : null
    if (p) console.log('meta', JSON.stringify({ reason: p.meta?.reason, errors: p.meta?.errors, labels: p.meta?.labels, ledger: p.meta?.ledger }))
    const { dummyFinLines } = await import('../src/lib/repository/dummy-finance-upload')
    console.log('lines', JSON.stringify(dummyFinLines().filter((l) => l.kind === 'ledger' && l.period === '2098-01').map((l) => l.row)))
  } else if (step === 'pdf') {
    const { textPdf } = await import('./fixtures/finance-pdf')
    const stmt = textPdf([[
      ['표준재무제표'], ['제 5기 2025년 01월 01일 ~ 2025년 12월 31일'], ['재무상태표'],
      ['현금및현금성자산', 1000000], ['외상매출금', 500000], ['유형자산', 2000000], ['감가상각누계액', '(300,000)'], ['자산총계', 3200000],
      ['외상매입금', 400000], ['차입금', 1000000], ['부채총계', 1400000], ['자본금', 1800000], ['자본총계', 1800000],
      ['손익계산서'], ['제품매출', 5000000], ['원재료비', 3000000], ['급여(판관)', 800000], ['영업이익', 1200000],
    ]])
    show(await processUpload({ repo, businessId: BIZ, fileName: '2025 표준재무제표.pdf', bytes: stmt, classify: null, aiBudget: 1, docs }))
  } else if (step === 'scan') {
    const { scanPdf } = await import('./fixtures/finance-pdf')
    const png = await statementPng()
    const meta = await sharp(png).metadata()
    const jpeg = new Uint8Array(await sharp(png).jpeg({ quality: 85 }).toBuffer())
    show(await processUpload({ repo, businessId: BIZ, fileName: '2025 표준재무제표 스캔.pdf', bytes: scanPdf(jpeg, meta.width!, meta.height!), classify: null, aiBudget: 1, docs }))
  } else if (step === 'photo') {
    show(await processUpload({ repo, businessId: BIZ, fileName: '2025 표준재무제표 사진.png', bytes: await statementPng(), classify: null, aiBudget: 1, docs }))
  } else if (step === 'fallback') {
    // 2026-10-16: 옛 400 스키마로 callJson → 첫 호출 400(구조 강제) → 강제 없이 한 번 더(2번).
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { callJson } = await import('../src/lib/finance-upload/ai-call')
    const { DEFAULT_AI_MODEL } = await import('../src/lib/ai/anthropic')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 0 })
    const OLD = { type: 'object', properties: { kind: { type: 'string' }, columns: { type: 'object', additionalProperties: { type: 'integer' } } }, required: ['kind', 'columns'], additionalProperties: false }
    const r = await callJson(client, { model: process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL, maxTokens: 500, timeout: 60_000, system: [{ type: 'text', text: '표 머리글을 보고 종류와 칸 번호(0부터)를 JSON으로.' }], content: '<sheet>[["일자","거래처명","공급가액"]]</sheet>', schema: OLD }, (u) => console.log('usage', u.input_tokens, u.output_tokens))
    console.log('fallback', r.fallback, JSON.stringify(r.json))
  } else if (step === 'ledger2') {
    // 2026-10-16: 괄호 겹침 계정 · 제목 줄의 기간 · 쪽 · 병합 날짜 · 코드가 모르는 월계 낱말(«[당월합산]») → AI 구조 해석.
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('계정별원장')
    const range = '2098/03/01 ~ 2098/03/31'
    const H = ['일자', '적요', '거래처', '차변', '대변', '잔액']
    const rows: (string | number | null)[][] = [
      ['계정별원장'], ['회사명 : (주)가짜산업', range],
      ['1509(제품)', range, null, null, null, '1쪽'], H, [null, '[전기이월]', null, null, null, 1_000_000],
      ['98/03/05', '가짜 제품 입고', '가짜 갑', 300_000, null, 1_300_000], [null, '가짜 제품 입고 둘', '가짜 갑', 100_000, null, 1_400_000],
      ['98/03/20', '가짜 제품 출고', '가짜 을', null, 200_000, 1_200_000], [null, '[당월합산]', null, 400_000, 200_000, 1_200_000], [null, '[당월합산누적]', null, 400_000, 200_000, 1_200_000],
      ['2519(미지급금(카드))', range, null, null, null, '2쪽'], H, [null, '전월이월', null, null, null, -5_000_000],
      ['98/03/03', '가짜 카드 사용', '가짜 카드사', null, 700_000, -5_700_000], ['98/03/25', '가짜 대금 지급', '가짜 카드사', 400_000, null, -5_300_000],
      [null, '[당월합산]', null, 400_000, 700_000, -5_300_000], [null, '[당월합산누적]', null, 400_000, 700_000, -5_300_000],
    ]
    for (const r of rows) ws.addRow(r)
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    const cards = await processUpload({ repo, businessId: BIZ, fileName: '가짜 3월 계정별 원장.xlsx', bytes, classify: realClassifier(repo, BIZ), aiBudget: 3, today: new Date('2098-04-10'), docs })
    show(cards)
    const { dummyFinLines } = await import('../src/lib/repository/dummy-finance-upload')
    console.log('lines', JSON.stringify(dummyFinLines().filter((l) => l.kind === 'ledger' && l.period === '2098-03').map((l) => l.row)))
  } else if (step === 'pdf25') {
    // 2026-10-16: 25쪽 글 PDF(부속 명세서 23쪽 + 재무상태표 · 손익계산서가 뒤쪽) → 결산서 쪽을 먼저 읽는다.
    const { textPdf } = await import('./fixtures/finance-pdf')
    const filler = (i: number) => [[`부속 명세서 ${i}`], ['항목', '금액'], ...Array.from({ length: 12 }, (_, k) => [`가짜 세부 항목 ${i}-${k}`, 1000 * (k + 1)])]
    const bs = [['표준재무제표 — 재무상태표'], ['제 5기 2025년 01월 01일 ~ 2025년 12월 31일'], ['현금및현금성자산', 1000000], ['외상매출금', 500000], ['유형자산', 2000000], ['감가상각누계액', '(300,000)'], ['자산총계', 3200000], ['외상매입금', 400000], ['차입금', 1000000], ['부채총계', 1400000], ['자본금', 1800000], ['자본총계', 1800000]]
    const is = [['손익계산서'], ['제품매출', 5000000], ['원재료비', 3000000], ['급여(판관)', 800000], ['영업이익', 1200000]]
    const pages = [...Array.from({ length: 20 }, (_, i) => filler(i + 1)), bs, is, ...Array.from({ length: 3 }, (_, i) => filler(i + 21))]
    show(await processUpload({ repo, businessId: BIZ, fileName: '2025 표준재무제표 25쪽.pdf', bytes: textPdf(pages as (string | number | null)[][][]), classify: null, aiBudget: 3, docs }))
  } else if (step === 'others') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { DEFAULT_AI_MODEL } = await import('../src/lib/ai/anthropic')
    const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 0 })
    const prompt = (n: string) => readFileSync(`src/lib/ai/prompts/${n}.md`, 'utf8')
    const tryOne = async (name: string, params: Record<string, unknown>) => {
      try {
        const r = await client.messages.create({ model, max_tokens: 1500, ...params } as never)
        const m = r as unknown as { stop_reason: string; usage: { input_tokens: number; output_tokens: number }; content: { type: string; text?: string }[] }
        console.log(`OK ${name} ${m.stop_reason} in ${m.usage.input_tokens} out ${m.usage.output_tokens} · ${m.content.filter((b) => b.type === 'text').map((b) => b.text).join('').slice(0, 160).replace(/\s+/g, ' ')}`)
      } catch (e) {
        const x = e as { status?: number; error?: unknown; message?: string }
        console.log(`ERR ${name} ${x.status} ${JSON.stringify(x.error ?? x.message).slice(0, 400)}`)
      }
    }
    const { ALL_TOOLS, assistantSystemPrompt } = await import('../src/lib/ai/assistant/run')
    await tryOne('assistant', {
      max_tokens: 2000,
      system: [{ type: 'text', text: assistantSystemPrompt(prompt('assistant'), 'Chairman'), cache_control: { type: 'ephemeral' } }],
      tools: ALL_TOOLS.map((t) => t.def),
      messages: [{ role: 'user', content: '[화면] 홈 · 경로 / · 묻는 사람 역할 Chairman · 오늘 2098-01-01(KST)\n\n도구 없이 «확인»이라고만 답하세요.' }],
      cache_control: { type: 'ephemeral' },
    })
    const { SCHEMA: TRIAGE } = await import('../src/lib/feedback/instruction')
    await tryOne('feedback-triage', {
      max_tokens: 2500,
      system: [{ type: 'text', text: prompt('feedback-triage'), cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: TRIAGE } },
      messages: [{ role: 'user', content: '의견 하나를 정리하라.\n\n<feedback n="1" id="fb_fake" screen="/me" role="Member" at="2098-01-01">\n<question>오늘 할 일?</question>\n<answer>가짜 답</answer>\n<opinion>답이 너무 길어요(가짜 의견)</opinion>\n</feedback>' }],
    })
    const { BRIEF_JSON_SCHEMA } = await import('../src/lib/ai/brief-schema')
    await tryOne('company-summary', { system: prompt('company-summary'), output_config: { format: { type: 'json_schema', schema: BRIEF_JSON_SCHEMA } }, messages: [{ role: 'user', content: JSON.stringify({ company: '가짜 회사', note: '가짜 자료 — 짧게' }) }] })
    const { SCHEMA: ATT } = await import('../src/lib/attachments/summarize')
    await tryOne('attachment-summary', { system: prompt('attachment-summary'), output_config: { format: { type: 'json_schema', schema: ATT } }, messages: [{ role: 'user', content: '<document>가짜 회의록: 다음 주 화요일 가짜 납품.</document>' }] })
    const { INTAKE_SCHEMA } = await import('../src/lib/intake/proposal')
    await tryOne('intake', { system: prompt('intake-classify'), output_config: { format: { type: 'json_schema', schema: INTAKE_SCHEMA } }, messages: [{ role: 'user', content: '<file name="가짜 견적서.txt">가짜 견적 — 품목 A 10개</file>' }] })
  } else {
    console.error('단계: ledger · pdf · scan · photo · others')
    process.exit(2)
  }
  console.log(`진짜 AI 호출 ${calls}번`)
}

main().catch((e) => {
  console.error(e)
  console.log(`진짜 AI 호출 ${calls}번`)
  process.exit(1)
})
