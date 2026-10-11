import type { BomVersionRow, Overhead, OverheadBasis, OverheadCategory } from '@/types/costs'
import { OVERHEAD_BASIS_LABEL_KO, OVERHEAD_CATEGORIES, OVERHEAD_CATEGORY_LABEL_KO } from '@/types/costs'
import type { LotBalance, ProdLot, ProductionOrder } from '@/types/production'
import type { CostMaterial, CostSupplier, MarketPrice, MaterialCategory, PurchaseLot } from '@/types/purchasing'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL_KO } from '@/types/purchasing'
import type { CostProduct } from '@/types/sales-cost'

import type { ImportEdit, ImportPayload } from './payload'
import { guessMapping, headerKey, IMPORT_FIELDS, IMPORT_MAX_ROWS, nameNorm } from './spec'
import type { ImportCounts, ImportDecisions, ImportTarget, PreviewRow, RowStatus } from './types'
import { addDays, currency, decimal, isoDate, numText, sameNumber, scale } from './values'

/**
 * 엑셀 넣기 계획 — 읽은 격자 + 사람의 결정(칸 지정 · 고친 칸 · 충돌 처리 · 중복 확인) + 지금 자료 → 줄마다 상태와 DB 줄.
 * **미리보기와 등록이 같은 함수를 부른다**(등록은 원본을 다시 읽어 계획을 다시 만든다 — 화면이 보낸 줄은 믿지 않는다).
 * 브라우저 없이 돈다(scripts/check-cost-import.ts).
 *
 * DB가 마지막 문이다(cost_import_apply — RLS · 트리거 · 이상치 · 잔량 · 도장). 여기 검사는 사람이 미리 고칠 수 있게 하는 것이다.
 */

export interface GridCell {
  v: string
  /** 읽지 못한 칸(수식 결과 없음 · 셀 오류) — 쓰이면 그 줄은 오류. */
  err?: string
}

export interface GridSheet {
  name: string
  rows: GridCell[][]
}

export interface PlanContext {
  target: ImportTarget
  /** KST 오늘. */
  today: string
  /** 대표 — 이상치 · 미래 날짜 검사를 DB처럼 건너뛴다. */
  chairman: boolean
  materials: CostMaterial[]
  suppliers: CostSupplier[]
  market: MarketPrice[]
  lots: PurchaseLot[]
  overheads: Overhead[]
  products: CostProduct[]
  orders: ProductionOrder[]
  prodLots: ProdLot[]
  balances: LotBalance[]
  bomVersions: BomVersionRow[]
  /** (통화|날짜) → 원화 환율(없으면 null). 서버가 미리 찾아 둔다. */
  fx: Record<string, number | null>
}

export interface PlanResult {
  sheets: string[]
  sheet: string
  headerRow: number
  headers: string[]
  mapping: Record<string, number | null>
  mappingConfirmed: boolean
  rows: PreviewRow[]
  counts: ImportCounts
  payloads: ImportPayload[]
  edits: ImportEdit[]
  skipped: number
  /** 등록이 잠긴 이유(null = 등록 가능). seen(같은 파일)은 서버가 덧붙인다. */
  locked: string | null
  /** 환율이 필요한 (통화|날짜) — 서버가 ctx.fx를 채워 다시 부른다. */
  fxNeeded: string[]
}

/** 설명 시트(빈 양식) · 빈 시트는 고르지 않는다. */
function dataSheets(sheets: GridSheet[]): GridSheet[] {
  const filled = sheets.filter((s) => s.rows.some((r) => r.some((c) => c.v !== '' || c.err)))
  const notHelp = filled.filter((s) => !/^(설명|도움말|안내|readme)$/i.test(s.name.trim()))
  return notHelp.length > 0 ? notHelp : filled
}

/** 머리글 짐작: 동의어가 가장 많이 맞는 행(앞 20행 안). 없으면 첫 비지 않은 행. 1부터. */
function guessHeaderRow(target: ImportTarget, sheet: GridSheet): number {
  const aliases = new Set(IMPORT_FIELDS[target].flatMap((f) => f.aliases.map(headerKey)))
  let best = -1
  let bestHits = 0
  for (let r = 0; r < Math.min(sheet.rows.length, 20); r += 1) {
    const hits = sheet.rows[r].filter((c) => c.v && aliases.has(headerKey(c.v))).length
    if (hits > bestHits) {
      bestHits = hits
      best = r
    }
  }
  if (best >= 0) return best + 1
  const first = sheet.rows.findIndex((r) => r.some((c) => c.v !== ''))
  return first >= 0 ? first + 1 : 1
}

interface Line {
  row: number
  values: Record<string, string>
  raw: Record<string, string>
  edited: string[]
  cellErr: string | null
}

type Parsed = Record<string, unknown>

interface Work extends Line {
  status: RowStatus
  message: string
  existing: string | null
  canBoth: boolean
  fileRow: number | null
  parsed: Parsed | null
  key: string | null
  replaceId: string | null
  /** 같은 묶음(생산 LOT · BOM 판)의 열쇠. */
  group: string | null
}

const won = (v: string | number) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? `${Math.round(n).toLocaleString('ko-KR')}` : String(v)
}
const kg = (v: string | number) => `${typeof v === 'number' ? numText(v) : v}kg`

function labelToCode<T extends string>(raw: string, codes: readonly T[], labels: Record<T, string>): T | null {
  const k = headerKey(raw)
  for (const c of codes) if (headerKey(c) === k || headerKey(labels[c]) === k) return c
  return null
}

function basisOf(raw: string): OverheadBasis | null {
  const k = headerKey(raw)
  if (['월금액', '월', 'monthly', '월별', '원월'].includes(k)) return 'monthly'
  if (['원kg', 'kg', 'perkg', 'kg당', '원/kg'].map(headerKey).includes(k)) return 'per_kg'
  return labelToCode(raw, ['monthly', 'per_kg'] as const, OVERHEAD_BASIS_LABEL_KO)
}

export function planImport(
  target: ImportTarget,
  sheets: GridSheet[],
  decisions: ImportDecisions,
  ctx: PlanContext,
): PlanResult {
  const usable = dataSheets(sheets)
  const sheetNames = usable.map((s) => s.name)
  const sheet = usable.find((s) => s.name === decisions.sheet) ?? usable[0]
  const fields = IMPORT_FIELDS[target]
  const empty: PlanResult = {
    sheets: sheetNames,
    sheet: sheet?.name ?? '',
    headerRow: 1,
    headers: [],
    mapping: {},
    mappingConfirmed: false,
    rows: [],
    counts: { new: 0, same: 0, conflict: 0, duplicate: 0, error: 0 },
    payloads: [],
    edits: [],
    skipped: 0,
    locked: '읽을 자료가 없습니다.',
    fxNeeded: [],
  }
  if (!sheet) return empty

  const headerRow =
    decisions.headerRow && decisions.headerRow >= 1 && decisions.headerRow <= sheet.rows.length ? decisions.headerRow : guessHeaderRow(target, sheet)
  const headers = (sheet.rows[headerRow - 1] ?? []).map((c) => c.v)
  const confirmed = !!decisions.mapping
  const mapping: Record<string, number | null> = {}
  const guessed = guessMapping(target, headers)
  for (const fd of fields) {
    const m = decisions.mapping?.[fd.key]
    mapping[fd.key] = confirmed
      ? typeof m === 'number' && Number.isInteger(m) && m >= 0 && m < headers.length
        ? m
        : null
      : guessed[fd.key]
  }
  const missingRequired = fields.filter((fd) => fd.required && mapping[fd.key] === null).map((fd) => fd.label)
  const usedCols = Object.values(mapping).filter((v): v is number => v !== null)
  const twice = usedCols.length !== new Set(usedCols).size

  // ── 줄 읽기 ──
  const lines: Line[] = []
  for (let r = headerRow; r < sheet.rows.length; r += 1) {
    const cells = sheet.rows[r]
    const raw: Record<string, string> = {}
    let cellErr: string | null = null
    let any = false
    for (const fd of fields) {
      const col = mapping[fd.key]
      const cell = col === null ? undefined : cells[col]
      raw[fd.key] = cell?.v ?? ''
      if (cell?.err && !cellErr) cellErr = `${fd.label}: ${cell.err}`
      if (raw[fd.key] !== '' || cell?.err) any = true
    }
    if (!any) continue
    const row = r + 1
    const ed = decisions.edits?.[String(row)] ?? {}
    const values = { ...raw }
    const edited: string[] = []
    for (const fd of fields) {
      const v = ed[fd.key]
      if (typeof v === 'string' && v.slice(0, 1000) !== raw[fd.key]) {
        values[fd.key] = v.slice(0, 1000).trim()
        edited.push(fd.key)
      }
    }
    lines.push({ row, values, raw, edited, cellErr: edited.length > 0 && cellErr ? null : cellErr })
  }

  const max = IMPORT_MAX_ROWS[target]
  const tooMany = lines.length > max

  const work: Work[] = lines.slice(0, max).map((l) => ({
    ...l,
    status: 'new',
    message: '',
    existing: null,
    canBoth: false,
    fileRow: null,
    parsed: null,
    key: null,
    replaceId: null,
    group: null,
  }))

  const fxNeeded = new Set<string>()
  const err = (w: Work, msg: string) => {
    if (w.status !== 'error') {
      w.status = 'error'
      w.message = msg
    }
  }

  // ── 칸 검사 ──
  const matByName = new Map(ctx.materials.map((m) => [nameNorm(m.name), m]))
  const supByName = new Map(ctx.suppliers.map((s) => [nameNorm(s.name), s]))
  const prodByName = new Map(ctx.products.map((p) => [nameNorm(p.name), p]))
  const need = (w: Work, key: string, label: string) => {
    if (!w.values[key]) err(w, `${label} 칸이 비었습니다.`)
    return w.values[key] ?? ''
  }
  const dateField = (w: Work, key: string, label: string, required: boolean, futureCheck: boolean) => {
    const d = isoDate(w.values[key] ?? '')
    if (d === null) err(w, `${label}을(를) 날짜로 읽지 못했습니다(예: 2026-10-01).`)
    else if (d === '' && required) err(w, `${label} 칸이 비었습니다.`)
    else if (d && futureCheck && !ctx.chairman && d > addDays(ctx.today, 1)) err(w, `${label}이(가) 내일보다 뒤입니다.`)
    return d ?? ''
  }
  const numField = (w: Work, key: string, label: string, opts: { required?: boolean; positive?: boolean; maxScale?: number }) => {
    const d = decimal(w.values[key] ?? '')
    if (d === null) err(w, `${label}을(를) 숫자로 읽지 못했습니다(음수는 받지 않습니다).`)
    else if (d === '' && opts.required) err(w, `${label} 칸이 비었습니다.`)
    else if (d !== '' && opts.positive && Number(d) <= 0) err(w, `${label}은(는) 0보다 커야 합니다.`)
    else if (d !== '' && opts.maxScale !== undefined && scale(d) > opts.maxScale) err(w, `${label}은(는) 소수 ${opts.maxScale}자리까지입니다.`)
    else if (d !== '' && Number(d) > 1e12) err(w, `${label}이(가) 너무 큽니다.`)
    return d ?? ''
  }
  const textField = (w: Work, key: string, label: string, maxLen: number) => {
    const t = (w.values[key] ?? '').trim()
    if (t.length > maxLen) err(w, `${label}은(는) ${maxLen}자까지입니다.`)
    return t
  }
  const curField = (w: Work) => {
    const c = currency(w.values.currency ?? '')
    if (c === null) err(w, '통화는 KRW · USD 같은 세 글자입니다.')
    return c || 'KRW'
  }
  const findMat = (w: Work) => {
    const name = need(w, 'material', '원료')
    const m = name ? matByName.get(nameNorm(name)) : undefined
    if (name && !m) err(w, `원료 «${name}»를 찾지 못했습니다 — 먼저 원료 엑셀로 넣으세요.`)
    return m
  }

  for (const w of work) {
    if (w.cellErr) err(w, w.cellErr)
    const v = w.values
    switch (target) {
      case 'materials': {
        const name = need(w, 'name', '원료 이름')
        if (name.length > 120) err(w, '원료 이름은 120자까지입니다.')
        if (v.unit && headerKey(v.unit) !== 'kg') err(w, '단위는 kg만 받습니다.')
        const category: MaterialCategory | null = v.category ? labelToCode(v.category, MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL_KO) : 'main'
        if (!category) err(w, '분류는 주원료 · 부원료 · 첨가제 · 포장재 · 기타 중 하나입니다.')
        w.parsed = { name, category: category ?? 'main', spec: textField(w, 'spec', '규격', 200), note: textField(w, 'note', '메모', 500) }
        w.key = nameNorm(name)
        break
      }
      case 'suppliers': {
        const name = need(w, 'name', '공급처 이름')
        if (name.length > 120) err(w, '공급처 이름은 120자까지입니다.')
        w.parsed = {
          name,
          country: textField(w, 'country', '국가', 60),
          currency_default: curField(w),
          contact: textField(w, 'contact', '연락처', 500),
          terms: textField(w, 'terms', '조건', 500),
          note: textField(w, 'note', '메모', 500),
        }
        w.key = nameNorm(name)
        break
      }
      case 'market_prices': {
        const m = findMat(w)
        const date = dateField(w, 'date', '날짜', true, true)
        const price = numField(w, 'price', '가격', { required: true, positive: true, maxScale: 4 })
        const cur = curField(w)
        const fx = numField(w, 'fx_rate', '환율', { positive: true, maxScale: 6 })
        const source = need(w, 'source', '출처')
        if (source.length > 120) err(w, '출처는 120자까지입니다.')
        const url = textField(w, 'source_url', '출처 주소', 1000)
        if (url && !/^https?:\/\//i.test(url)) err(w, '출처 주소는 http:// 또는 https://로 시작해야 합니다.')
        w.parsed = {
          material_id: m?.material_id ?? '',
          observed_on: date,
          price,
          currency: cur,
          fx_rate: cur === 'KRW' ? null : fx || null,
          source_name: source,
          source_url: url || null,
          note: textField(w, 'note', '메모', 500),
        }
        if (cur !== 'KRW' && !fx && date) fxNeeded.add(`${cur}|${date}`)
        w.key = m && date ? `${m.material_id}|${date}|${source.toLowerCase()}` : null
        break
      }
      case 'purchase_lots': {
        const m = findMat(w)
        const supName = need(w, 'supplier', '공급처')
        const s = supName ? supByName.get(nameNorm(supName)) : undefined
        if (supName && !s) err(w, `공급처 «${supName}»를 찾지 못했습니다 — 먼저 공급처 엑셀로 넣으세요.`)
        const date = dateField(w, 'received_on', '입고일', true, true)
        const ordered = dateField(w, 'ordered_on', '주문일', false, false)
        const qty = numField(w, 'qty_kg', 'kg', { required: true, positive: true, maxScale: 4 })
        const unit = numField(w, 'unit_price', '단가', { required: true, positive: true, maxScale: 4 })
        const cur = curField(w)
        const fx = numField(w, 'fx_rate', '환율', { positive: true, maxScale: 6 })
        const freight = numField(w, 'freight_krw', '운송', { maxScale: 4 }) || '0'
        const duty = numField(w, 'duty_krw', '관세', { maxScale: 4 }) || '0'
        const other = numField(w, 'other_krw', '부대', { maxScale: 4 }) || '0'
        w.parsed = {
          material_id: m?.material_id ?? '',
          supplier_id: s?.supplier_id ?? '',
          received_on: date,
          ordered_on: ordered || null,
          supplier_lot_no: textField(w, 'supplier_lot_no', '공급처 LOT 번호', 80),
          qty_kg: qty,
          unit_price: unit,
          currency: cur,
          fx_rate: cur === 'KRW' ? null : fx || null,
          freight_krw: freight,
          duty_krw: duty,
          other_krw: other,
          note: textField(w, 'note', '메모', 500),
        }
        if (cur !== 'KRW' && !fx && date) fxNeeded.add(`${cur}|${date}`)
        w.key = m && s && date && qty ? `${m.material_id}|${s.supplier_id}|${date}|${decimal(qty)}` : null
        break
      }
      case 'overheads': {
        const category: OverheadCategory | null = v.category ? labelToCode(v.category, OVERHEAD_CATEGORIES, OVERHEAD_CATEGORY_LABEL_KO) : null
        if (!v.category) err(w, '항목 칸이 비었습니다.')
        else if (!category) err(w, '항목은 인건비 · 전기 · 가스 · … · 기타 중 하나입니다(빈 양식의 설명 시트).')
        const basis = v.basis ? basisOf(v.basis) : null
        if (!v.basis) err(w, '방식 칸이 비었습니다.')
        else if (!basis) err(w, '방식은 «월 금액» 또는 «원/kg»입니다.')
        const amount = numField(w, 'amount', '금액', { required: true, maxScale: 4 })
        if (amount && Number(amount) > 1e13) err(w, '금액이 너무 큽니다.')
        const scopeName = (v.scope ?? '').trim()
        let productId: string | null = null
        if (scopeName && !/^(모든제품|전체|전제품|all)$/i.test(headerKey(scopeName))) {
          const p = prodByName.get(nameNorm(scopeName))
          if (!p) err(w, `제품 «${scopeName}»를 찾지 못했습니다.`)
          else productId = p.product_id
          if (basis === 'monthly') err(w, '범위(제품)는 원/kg 방식에만 씁니다.')
        }
        const from = dateField(w, 'effective_from', '시작일', true, false)
        w.parsed = { category: category ?? '', basis: basis ?? '', amount, product_id: productId, effective_from: from, note: textField(w, 'note', '메모', 300) }
        w.key = category && from ? `${category}|${productId ?? ''}|${from}` : null
        break
      }
      case 'production': {
        const order = need(w, 'order', '오더').toUpperCase()
        const o = ctx.orders.find((x) => x.order_id === order)
        if (order && (!o || o.status !== 'open')) err(w, `오더 «${order}»가 없거나 닫혔습니다.`)
        const date = dateField(w, 'produced_on', '생산일', true, true)
        const output = numField(w, 'output_kg', '산출 kg', { required: true, positive: true })
        const lot = need(w, 'lot', '투입 LOT').toUpperCase()
        const b = ctx.balances.find((x) => x.lot_id === lot)
        if (lot && !b) err(w, `구매 LOT «${lot}»를 찾지 못했습니다.`)
        if (b && date && date < b.received_on) err(w, `생산일이 LOT 입고일(${b.received_on})보다 앞입니다.`)
        const qty = numField(w, 'qty_kg', '투입 kg', { required: true, positive: true })
        w.parsed = { order_id: order, produced_on: date, output_kg: output, lot_id: lot, qty_kg: qty, note: textField(w, 'note', '메모', 500) }
        w.group = order && date && output ? `${order}|${date}|${decimal(output)}` : null
        w.key = w.group ? `${w.group}|${lot}` : null
        break
      }
      case 'bom': {
        const prodName = need(w, 'product', '제품')
        const p = prodName ? prodByName.get(nameNorm(prodName)) : undefined
        if (prodName && !p) err(w, `제품 «${prodName}»를 찾지 못했습니다.`)
        const m = findMat(w)
        const from = dateField(w, 'valid_from', '시작일', true, false)
        const yieldPct = numField(w, 'yield_pct', '수율', { required: true, positive: true, maxScale: 4 })
        if (yieldPct && Number(yieldPct) > 100) err(w, '수율은 100 이하입니다.')
        const per = numField(w, 'kg_per_kg', '원료 kg/제품 kg', { required: true, positive: true, maxScale: 8 })
        if (per && Number(per) > 100) err(w, '원료 kg/제품 kg은 100 이하입니다.')
        w.parsed = { product_id: p?.product_id ?? '', valid_from: from, yield_pct: yieldPct, material_id: m?.material_id ?? '', kg_per_kg: per, note: textField(w, 'note', '메모', 300) }
        w.group = p && from ? `${p.product_id}|${from}` : null
        w.key = w.group && m ? `${w.group}|${m.material_id}` : null
        break
      }
    }
  }

  // 고르기에서 «기존 유지»를 고른 줄은 파일 안 겹침 판정에서 뺀다(버린 줄).
  const choiceOf = (row: number) => decisions.choices?.[String(row)]
  const dropped = (w: Work) => choiceOf(w.row)?.choice === 'keep'

  // ── 기존 자료와 비교 ──
  const live = <T extends { voided_at: string | null }>(xs: T[]) => xs.filter((x) => !x.voided_at)
  for (const w of work) {
    if (w.status === 'error' || !w.parsed) continue
    const p = w.parsed as Record<string, string | null>
    switch (target) {
      case 'materials': {
        const m = matByName.get(w.key ?? '')
        if (!m) break
        if (m.category === p.category && m.spec === p.spec) w.status = 'same'
        else {
          w.status = 'conflict'
          w.message = '같은 이름의 원료가 이미 있고 분류 · 규격이 다릅니다.'
          w.existing = `기존: ${MATERIAL_CATEGORY_LABEL_KO[m.category]}${m.spec ? ` · ${m.spec}` : ''}`
          w.replaceId = m.material_id
        }
        break
      }
      case 'suppliers': {
        const s = supByName.get(w.key ?? '')
        if (!s) break
        if (s.country === p.country && s.currency_default === p.currency_default && s.contact === p.contact && s.terms === p.terms) w.status = 'same'
        else {
          w.status = 'conflict'
          w.message = '같은 이름의 공급처가 이미 있고 국가 · 통화 · 연락처 · 조건이 다릅니다.'
          w.existing = `기존: ${[s.country, s.currency_default].filter(Boolean).join(' · ')}`
          w.replaceId = s.supplier_id
        }
        break
      }
      case 'market_prices': {
        const hit = live(ctx.market).find(
          (x) => x.material_id === p.material_id && x.observed_on === p.observed_on && x.source_name.toLowerCase() === (p.source_name ?? '').toLowerCase(),
        )
        if (!hit) break
        if (sameNumber(hit.price, p.price) && hit.currency === p.currency) w.status = 'same'
        else {
          w.status = 'conflict'
          w.message = '같은 원료 · 같은 날짜 · 같은 출처의 시세가 이미 있고 가격이 다릅니다.'
          w.existing = `기존: ${numText(hit.price)} ${hit.currency}/kg`
          w.replaceId = String(hit.price_id)
        }
        break
      }
      case 'purchase_lots': {
        const hit = live(ctx.lots).find(
          (x) =>
            x.material_id === p.material_id && x.supplier_id === p.supplier_id && x.received_on === p.received_on && sameNumber(x.qty_kg, p.qty_kg),
        )
        if (!hit) break
        const same =
          sameNumber(hit.unit_price, p.unit_price) &&
          hit.currency === p.currency &&
          sameNumber(hit.freight_krw, p.freight_krw) &&
          sameNumber(hit.duty_krw, p.duty_krw) &&
          sameNumber(hit.other_krw, p.other_krw)
        w.existing = `기존: ${hit.lot_id} · 단가 ${numText(hit.unit_price)} ${hit.currency}${hit.supplier_lot_no ? ` · LOT ${hit.supplier_lot_no}` : ''}`
        w.replaceId = hit.lot_id
        if (same) {
          w.status = 'duplicate'
          w.message = '같은 원료 · 공급처 · 입고일 · kg · 단가 · 비용의 LOT가 이미 있습니다.'
        } else {
          w.status = 'conflict'
          w.message = '같은 원료 · 공급처 · 입고일 · kg의 LOT가 이미 있고 단가 · 비용이 다릅니다.'
          w.canBoth = !!p.supplier_lot_no && p.supplier_lot_no !== hit.supplier_lot_no
        }
        break
      }
      case 'overheads': {
        const hit = live(ctx.overheads).find(
          (x) => x.category === p.category && (x.product_id ?? '') === (p.product_id ?? '') && x.effective_from === p.effective_from,
        )
        if (!hit) break
        if (hit.basis === p.basis && sameNumber(hit.amount, p.amount)) w.status = 'same'
        else {
          w.status = 'conflict'
          w.message = '같은 항목 · 범위 · 시작일의 비용 줄이 이미 있고 방식 · 금액이 다릅니다.'
          w.existing = `기존: ${OVERHEAD_BASIS_LABEL_KO[hit.basis]} ${won(hit.amount)}원`
          w.replaceId = String(hit.overhead_id)
        }
        break
      }
      case 'production': {
        const [order, date, output] = (w.group ?? '||').split('|')
        const hit = live(ctx.prodLots).find((x) => x.order_id === order && x.produced_on === date && sameNumber(x.output_kg, output))
        if (hit) {
          w.status = 'duplicate'
          w.message = '같은 오더 · 생산일 · 산출 kg의 생산 LOT가 이미 있습니다.'
          w.existing = `기존: ${hit.prod_lot_id} · ${kg(hit.output_kg)}`
        }
        break
      }
      case 'bom': {
        const [product, from] = (w.group ?? '|').split('|')
        const hit = live(ctx.bomVersions).find((x) => x.product_id === product && x.valid_from === from)
        if (hit) {
          w.status = 'conflict'
          w.message = '같은 제품 · 같은 시작일 판이 이미 있습니다.'
          w.existing = `기존: 판 #${hit.version_id}${hit.is_fake ? '(가짜)' : ''}`
          w.replaceId = String(hit.version_id)
        }
        break
      }
    }
  }

  // ── 파일 안 겹침(같은 기준) ──
  if (target !== 'production' && target !== 'bom') {
    const byKey = new Map<string, Work[]>()
    for (const w of work) {
      // 새 줄끼리만 잰다 — 기존 줄과 맞은 줄(같은 줄 · 충돌 · 중복 의심)은 그 기존 줄과의 처리로 푼다(두 줄이 같은 기존 줄을 바꾸면 아래에서 잠근다).
      if (w.status !== 'new' || !w.key || dropped(w)) continue
      byKey.set(w.key, [...(byKey.get(w.key) ?? []), w])
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue
      const first = group[0]
      for (const w of group.slice(1)) {
        const a = first.parsed as Record<string, string | null>
        const b = w.parsed as Record<string, string | null>
        const sameVals = JSON.stringify({ ...a, note: '' }) === JSON.stringify({ ...b, note: '' })
        if (sameVals && target !== 'purchase_lots') {
          w.status = 'same'
          w.message = `파일 ${first.row}행과 같은 줄입니다.`
          w.fileRow = first.row
        } else if (sameVals) {
          w.status = 'duplicate'
          w.message = `파일 ${first.row}행과 같은 LOT입니다.`
          w.fileRow = first.row
        } else {
          for (const x of [first, w]) {
            if (x.status === 'conflict' && x.fileRow === null && x.existing) continue // 기존 충돌이 먼저 — 그 처리로 푼다
            x.status = 'conflict'
            x.message = `파일 ${x === first ? w.row : first.row}행과 기준 칸이 같은데 값이 다릅니다.`
            x.fileRow = x === first ? w.row : first.row
            x.canBoth = target === 'purchase_lots' && !!b.supplier_lot_no && !!a.supplier_lot_no && a.supplier_lot_no !== b.supplier_lot_no
            x.replaceId = x.existing ? x.replaceId : null
          }
        }
      }
    }
  }

  // ── 묶음(생산 LOT · BOM 판) 검사 ──
  if (target === 'production' || target === 'bom') {
    const groups = new Map<string, Work[]>()
    for (const w of work) if (w.group && w.status !== 'error') groups.set(w.group, [...(groups.get(w.group) ?? []), w])
    for (const g of groups.values()) {
      const keys = g.map((w) => w.key)
      const dupLine = g.find((w, i) => keys.indexOf(w.key) !== i)
      if (dupLine) {
        for (const w of g) err(w, target === 'bom' ? `같은 판에 같은 원료가 두 번 있습니다(${dupLine.row}행).` : `같은 생산 LOT에 같은 구매 LOT가 두 번 있습니다(${dupLine.row}행).`)
      }
      if (target === 'bom') {
        const y = new Set(g.map((w) => decimal(String((w.parsed as Parsed).yield_pct))))
        if (y.size > 1) for (const w of g) err(w, '한 판(같은 제품 · 시작일) 안에서 수율이 다릅니다.')
        if (g.length > 200) for (const w of g) err(w, '한 판은 원료 200줄까지입니다.')
      }
      // 한 줄이 오류면 묶음 전체가 오류(판 · 생산 LOT는 전부 아니면 전무).
      if (g.some((w) => w.status === 'error')) for (const w of g) err(w, w.message || '같은 묶음의 다른 줄에 오류가 있습니다.')
    }
    for (const w of work) if (!w.group && w.status !== 'error') err(w, '묶음 칸(제품 · 시작일 또는 오더 · 생산일 · 산출 kg)을 읽지 못했습니다.')
  }

  // ── 이상치 · 하루 출처 수 · 잔량(DB와 같은 규칙 — 대표는 이상치 · 미래 날짜를 건너뛴다) ──
  const startToday = `${ctx.today}T00:00:00+09:00`
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    if (s.length === 0) return 0
    const mid = (s.length - 1) / 2
    return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2
  }
  const krwOf = (p: Record<string, string | null>, priceKey: string, dateKey: string): number | null => {
    if (p.currency === 'KRW') return Number(p[priceKey])
    const fx = p.fx_rate ? Number(p.fx_rate) : ctx.fx[`${p.currency}|${p[dateKey]}`]
    return fx === null || fx === undefined ? null : Number(p[priceKey]) * fx
  }
  const willInsert = (w: Work) =>
    w.status === 'new' ||
    (w.status === 'conflict' && (choiceOf(w.row)?.choice === 'replace' || choiceOf(w.row)?.choice === 'both')) ||
    (w.status === 'duplicate' && (decisions.dupOk ?? []).includes(w.row))
  for (const w of work) {
    if (w.status === 'error' || !w.parsed) continue
    const p = w.parsed as Record<string, string | null>
    if (target === 'market_prices') {
      const krw = krwOf(p, 'price', 'observed_on')
      if (krw === null && !ctx.chairman) {
        err(w, `${p.currency} ${p.observed_on} 환율이 없습니다 — 환율 칸을 넣으세요.`)
        continue
      }
      const sameDay = live(ctx.market).filter((x) => x.material_id === p.material_id && x.observed_on === p.observed_on && x.price_id !== Number(w.replaceId))
      const fileSameDay = work.filter(
        (x) => x !== w && willInsert(x) && x.row < w.row && (x.parsed as Record<string, string>)?.material_id === p.material_id && (x.parsed as Record<string, string>)?.observed_on === p.observed_on,
      )
      if (!ctx.chairman && sameDay.length + fileSameDay.length >= 3) err(w, '같은 원료 같은 날 시세는 출처 셋까지입니다.')
      if (!ctx.chairman && krw !== null && p.observed_on) {
        const base = ctx.market.filter(
          (x) => x.material_id === p.material_id && x.created_at < startToday && x.observed_on >= addDays(p.observed_on!, -90) && x.observed_on <= p.observed_on!,
        )
        const med = median(base.map((x) => x.price_krw_per_kg))
        if (base.length >= 3 && med > 0 && (krw > med * 5 || krw < med * 0.2)) err(w, '이 원료의 최근 90일 중앙값과 5배 넘게 다릅니다 — 값을 확인하세요(대표에게 올리세요).')
      }
    } else if (target === 'purchase_lots' && !ctx.chairman && p.received_on) {
      const goods = krwOf(p, 'unit_price', 'received_on')
      if (goods === null) {
        err(w, `${p.currency} ${p.received_on} 환율이 없습니다 — 환율 칸을 넣으세요.`)
        continue
      }
      const landed = (goods * Number(p.qty_kg) + Number(p.freight_krw) + Number(p.duty_krw) + Number(p.other_krw)) / Number(p.qty_kg)
      const base = ctx.lots.filter(
        (x) => x.material_id === p.material_id && x.created_at < startToday && x.received_on >= addDays(p.received_on!, -90) && x.received_on <= p.received_on!,
      )
      const med = median(base.map((x) => x.landed_krw_per_kg))
      if (base.length >= 3 && med > 0 && (landed > med * 5 || landed < med * 0.2)) err(w, '이 원료의 최근 90일 LOT 중앙값과 5배 넘게 다릅니다 — 값을 확인하세요(대표에게 올리세요).')
    }
  }
  if (target === 'production') {
    const left = new Map(ctx.balances.map((b) => [b.lot_id, b.remaining_kg]))
    for (const w of work) {
      if (w.status === 'error' || !willInsert(w)) continue
      const p = w.parsed as Record<string, string>
      const rest = left.get(p.lot_id) ?? 0
      if (Number(p.qty_kg) > rest + 1e-9) err(w, `구매 LOT ${p.lot_id}의 잔량(${numText(Math.max(rest, 0))}kg)을 넘습니다.`)
      else left.set(p.lot_id, rest - Number(p.qty_kg))
    }
    // 묶음 하나가 오류면 전체(다시).
    const bad = new Set(work.filter((w) => w.status === 'error' && w.group).map((w) => w.group))
    for (const w of work) if (w.group && bad.has(w.group)) err(w, w.message || '같은 생산 LOT의 다른 줄에 오류가 있습니다.')
  }

  // ── 결정 반영 → DB 줄 ──
  const payloads: ImportPayload[] = []
  let skipped = 0
  const problems: string[] = []
  const groupsDone = new Set<string>()
  for (const w of work) {
    if (w.status === 'error') continue
    if (w.status === 'same') {
      skipped += 1
      continue
    }
    const c = choiceOf(w.row)
    if (w.status === 'conflict') {
      if (!c) {
        problems.push(`${w.row}행 충돌을 처리하세요.`)
        continue
      }
      if (c.choice === 'keep') {
        skipped += 1
        continue
      }
      if (c.choice === 'both' && !w.canBoth) {
        problems.push(`${w.row}행은 «둘 다 맞음»을 고를 수 없습니다(구분 칸이 같습니다).`)
        continue
      }
      if (c.choice === 'replace') {
        if (!w.replaceId) {
          problems.push(`${w.row}행은 파일 안 겹침입니다 — 한 줄을 «기존 유지»(버림)로 고르거나 값을 고치세요.`)
          continue
        }
        if (!c.reason || !c.reason.trim()) {
          problems.push(`${w.row}행 «엑셀 값으로 바꾸기»의 이유를 적으세요.`)
          continue
        }
      }
    }
    if (w.status === 'duplicate' && !(decisions.dupOk ?? []).includes(w.row)) {
      problems.push(`${w.row}행 중복 의심을 확인하세요(«그래도 넣기»).`)
      continue
    }
    const replace =
      w.status === 'conflict' && c?.choice === 'replace' ? { replace_id: w.replaceId!, reason: c.reason!.trim().slice(0, 300) } : {}
    const p = w.parsed as Record<string, string | null>
    if (target === 'production') {
      if (groupsDone.has(w.group!)) continue
      groupsDone.add(w.group!)
      const g = work.filter((x) => x.group === w.group && x.status !== 'error')
      payloads.push({
        order_id: p.order_id!,
        produced_on: p.produced_on!,
        output_kg: p.output_kg!,
        note: p.note ?? '',
        inputs: g.map((x) => ({ lot_id: (x.parsed as Record<string, string>).lot_id, qty_kg: (x.parsed as Record<string, string>).qty_kg })),
      })
    } else if (target === 'bom') {
      if (groupsDone.has(w.group!)) continue
      groupsDone.add(w.group!)
      const g = work.filter((x) => x.group === w.group && x.status !== 'error')
      payloads.push({
        product_id: p.product_id!,
        valid_from: p.valid_from!,
        yield_pct: p.yield_pct!,
        is_fake: !decisions.realBom,
        note: g.find((x) => (x.parsed as Record<string, string>).note)?.parsed?.note as string ?? '',
        lines: g.map((x) => ({ material_id: (x.parsed as Record<string, string>).material_id, kg_per_kg: (x.parsed as Record<string, string>).kg_per_kg })),
        ...replace,
      })
    } else {
      payloads.push({ ...(p as object), ...replace } as ImportPayload)
    }
  }

  // 두 줄이 같은 기존 줄을 바꾸면 잠근다(무효는 한 번뿐).
  const replacing = new Map<string, number>()
  for (const w of work) {
    if (w.status !== 'conflict' || choiceOf(w.row)?.choice !== 'replace' || !w.replaceId || w.group) continue
    const prev = replacing.get(w.replaceId)
    if (prev !== undefined) problems.push(`${prev}행과 ${w.row}행이 같은 기존 줄을 바꿉니다 — 한 줄은 «기존 유지»로 고르세요.`)
    else replacing.set(w.replaceId, w.row)
  }

  // BOM 묶음: 판 하나의 줄이 서로 다른 상태면(일부 충돌 처리 안 됨) 위 problems가 잡는다. 묶음의 결정은 첫 줄 것을 쓴다.
  if (target === 'bom') {
    const firsts = new Map<string, number>()
    for (const w of work) if (w.group && !firsts.has(w.group)) firsts.set(w.group, w.row)
    for (const w of work) {
      if (!w.group || w.status !== 'conflict') continue
      const first = firsts.get(w.group)!
      if (first !== w.row && JSON.stringify(choiceOf(w.row) ?? null) !== JSON.stringify(choiceOf(first) ?? null)) {
        problems.push(`${w.row}행: 같은 판의 첫 줄(${first}행)과 같은 처리를 고르세요.`)
      }
    }
  }

  // ── 고친 칸(감사) ──
  const edits: ImportEdit[] = []
  for (const w of work) {
    for (const k of w.edited) {
      edits.push(target === 'bom' ? { row: w.row, field: k, from: '', to: '고침' } : { row: w.row, field: k, from: w.raw[k].slice(0, 200), to: w.values[k].slice(0, 200) })
    }
  }

  const rows: PreviewRow[] = work.map((w) => ({
    row: w.row,
    values: w.values,
    edited: w.edited,
    status: w.status,
    message: w.message,
    existing: w.existing,
    canBoth: w.canBoth,
    fileRow: w.fileRow,
    othersRow: false,
  }))
  const counts: ImportCounts = { new: 0, same: 0, conflict: 0, duplicate: 0, error: 0 }
  for (const r of rows) counts[r.status] += 1

  let locked: string | null = null
  if (!confirmed) locked = '칸 지정을 확인하세요(«이 칸 지정으로 미리보기»).'
  else if (missingRequired.length > 0) locked = `꼭 있어야 하는 칸이 지정되지 않았습니다: ${missingRequired.join(' · ')}`
  else if (twice) locked = '한 열을 두 칸에 지정했습니다.'
  else if (tooMany) locked = `한 파일에 ${max.toLocaleString('ko-KR')}줄까지입니다(지금 ${lines.length.toLocaleString('ko-KR')}줄). 나눠서 넣으세요.`
  else if (counts.error > 0) locked = `오류 줄 ${counts.error}개를 고치세요(칸을 눌러 고치거나 엑셀을 고쳐 다시 올리세요).`
  else if (problems.length > 0) locked = problems.slice(0, 3).join(' ') + (problems.length > 3 ? ` 외 ${problems.length - 3}건` : '')
  else if (payloads.length === 0) locked = '넣을 새 줄이 없습니다.'

  return {
    sheets: sheetNames,
    sheet: sheet.name,
    headerRow,
    headers,
    mapping,
    mappingConfirmed: confirmed,
    rows,
    counts,
    payloads,
    edits,
    skipped,
    locked,
    fxNeeded: [...fxNeeded],
  }
}
