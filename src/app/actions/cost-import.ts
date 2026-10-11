'use server'

import { revalidatePath } from 'next/cache'

import { canWriteCosts, canWriteProduction, canWritePurchasing } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { planImport, type PlanContext } from '@/lib/cost-import/plan'
import { IMPORT_AREA, IMPORT_FIELDS, IMPORT_MAX_BYTES } from '@/lib/cost-import/spec'
import { IMPORT_TARGETS, type CostImportCommit, type CostImportPreview, type ImportDecisions, type ImportTarget } from '@/lib/cost-import/types'
import { CostImportFileError, readCostWorkbook, sha256Hex } from '@/lib/cost-import/workbook'
import { purchasingError } from '@/lib/purchasing/errors'
import { getRepository, type ChairmanRepository } from '@/lib/repository'
import type { SessionUser } from '@/types'

/**
 * 원가 엔진 엑셀 넣기(0068) — 미리보기 · 등록. **넣기만** 있다(회장 결정 2026-10-11 — 이 파일에 내려받기 · 내보내기 없음).
 *
 * 흐름: 브라우저가 파일(xlsx 하나 · 2MB)을 매번 보낸다 → 서버가 코드로 읽는다(exceljs · AI 없음 · 저장 없음)
 *       → 칸 맞추기(머리글 짐작 → 사람이 확정) → 계획(lib/cost-import/plan.ts) → 미리보기.
 *       등록은 **같은 파일을 다시 읽어 계획을 다시 만든다**(화면이 보낸 줄은 믿지 않는다 — 결정만 받는다) → DB 함수 한 번
 *       (cost_import_apply · security invoker · 한 트랜잭션 · 전부 아니면 전무 · 도장이 다르면 거부 · 같은 해시 거부 · 감사 한 줄).
 *
 * 권한: 화면 입력 권한과 같다(spec.ts IMPORT_AREA). 여기 판정은 파일을 펼치기 전의 안내이고, 문은 DB다(RLS · 0068).
 * BOM은 대표만 — 대표가 아니면 «찾을 수 없음»(존재를 말하지 않는다). BOM 칸 값은 오류 문장 · 로그에 싣지 않는다.
 */

const BIZ = /^[a-z0-9_]{1,60}$/
const XLSX_NAME = /\.xlsx$/i

function canImport(user: SessionUser, target: ImportTarget, businessId: string): boolean {
  switch (IMPORT_AREA[target]) {
    case 'purchasing':
      return canWritePurchasing(user, businessId)
    case 'costing':
      return canWriteCosts(user, businessId)
    case 'production':
      return canWriteProduction(user, businessId)
    case 'chairman':
      return user.role === 'Chairman'
  }
}

interface Input {
  user: SessionUser
  businessId: string
  target: ImportTarget
  fileName: string
  bytes: Uint8Array
  decisions: ImportDecisions
}

function decisionsOf(raw: FormDataEntryValue | null): ImportDecisions {
  if (typeof raw !== 'string' || raw.length > 500_000) return {}
  try {
    const d = JSON.parse(raw) as unknown
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {}
    const o = d as Record<string, unknown>
    const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
    const out: ImportDecisions = {}
    if (typeof o.sheet === 'string') out.sheet = o.sheet.slice(0, 100)
    if (Number.isInteger(o.headerRow)) out.headerRow = o.headerRow as number
    const m = rec(o.mapping)
    if (m) {
      out.mapping = {}
      for (const [k, v] of Object.entries(m)) out.mapping[k] = Number.isInteger(v) ? (v as number) : null
    }
    const e = rec(o.edits)
    if (e) {
      out.edits = {}
      for (const [row, cells] of Object.entries(e)) {
        const c = rec(cells)
        if (!c) continue
        out.edits[row] = {}
        for (const [k, v] of Object.entries(c)) if (typeof v === 'string') out.edits[row][k] = v.slice(0, 1000)
      }
    }
    const ch = rec(o.choices)
    if (ch) {
      out.choices = {}
      for (const [row, v] of Object.entries(ch)) {
        const c = rec(v)
        if (c && (c.choice === 'keep' || c.choice === 'replace' || c.choice === 'both')) {
          out.choices[row] = { choice: c.choice, reason: typeof c.reason === 'string' ? c.reason.slice(0, 300) : undefined }
        }
      }
    }
    if (Array.isArray(o.dupOk)) out.dupOk = o.dupOk.filter((x): x is number => Number.isInteger(x)).slice(0, 5000)
    if (o.realBom === true) out.realBom = true
    return out
  } catch {
    return {}
  }
}

async function readInput(form: FormData): Promise<Input | { error: string }> {
  const businessId = String(form.get('businessId') ?? '')
  const target = String(form.get('target') ?? '') as ImportTarget
  if (!BIZ.test(businessId) || !IMPORT_TARGETS.includes(target)) return { error: '어느 회사 · 어느 자료인지 알 수 없습니다.' }
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  // 파일을 펼치기 전에 — 권한 없는 사람의 파일을 서버 메모리에서 읽을 이유가 없다.
  if (!canImport(user, target, businessId)) return { error: '찾을 수 없거나 권한이 없습니다.' }
  const file = form.get('file')
  if (!(file instanceof File)) return { error: '엑셀 파일을 고르세요.' }
  if (!XLSX_NAME.test(file.name)) return { error: '엑셀(.xlsx) 파일만 받습니다. 엑셀에서 «다른 이름으로 저장 → Excel 통합 문서(*.xlsx)»로 저장하세요.' }
  if (file.size === 0) return { error: '빈 파일입니다.' }
  if (file.size > IMPORT_MAX_BYTES) return { error: '2MB까지 받습니다. 나눠서 넣으세요.' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { user, businessId, target, fileName: file.name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 120), bytes, decisions: decisionsOf(form.get('decisions')) }
}

/** 계획에 필요한 지금 자료 — 대상마다 필요한 것만 읽는다(사람의 세션 · RLS 안). */
async function contextFor(repo: ChairmanRepository, input: Input): Promise<PlanContext> {
  const { businessId: b, target } = input
  const needMat = ['materials', 'market_prices', 'purchase_lots', 'bom'].includes(target)
  const needProd = ['overheads', 'bom'].includes(target)
  const [materials, suppliers, market, lots, overheads, products, orders, prodLots, balances, bomVersions] = await Promise.all([
    needMat ? repo.listCostMaterials(b) : [],
    target === 'suppliers' || target === 'purchase_lots' ? repo.listCostSuppliers(b) : [],
    target === 'market_prices' ? repo.listMarketPrices(b, 3650) : [],
    target === 'purchase_lots' ? repo.listPurchaseLots(b) : [],
    target === 'overheads' ? repo.listOverheads(b) : [],
    needProd ? repo.listCostProducts(b) : [],
    target === 'production' ? repo.listProductionOrders(b) : [],
    target === 'production' ? repo.listProdLots(b) : [],
    target === 'production' ? repo.lotBalances(b, true) : [],
    target === 'bom' ? repo.bomVersions(b) : [],
  ])
  return {
    target,
    today: kstToday(),
    chairman: input.user.role === 'Chairman',
    materials,
    suppliers,
    market,
    lots,
    overheads,
    products,
    orders,
    prodLots,
    balances,
    bomVersions,
    fx: {},
  }
}

async function plan(repo: ChairmanRepository, input: Input) {
  const sheets = await readCostWorkbook(input.bytes)
  const ctx = await contextFor(repo, input)
  let result = planImport(input.target, sheets, input.decisions, ctx)
  if (result.fxNeeded.length > 0) {
    const pairs = result.fxNeeded.slice(0, 200)
    const rates = await Promise.all(pairs.map((k) => repo.lookupCostFx(k.split('|')[0], k.split('|')[1])))
    pairs.forEach((k, i) => (ctx.fx[k] = rates[i]))
    result = planImport(input.target, sheets, input.decisions, ctx)
  }
  return result
}

function importError(e: unknown, target: ImportTarget): string {
  if (e instanceof CostImportFileError) return e.message
  const m = e instanceof Error ? e.message : String(e)
  const at = /item (\d+)/.exec(m)
  const where = at ? `(${Number(at[1])}번째 줄) ` : ''
  if (/cost_import_stale/.test(m)) return '자료가 바뀌었습니다 — 다시 미리보기 하세요.'
  if (/cost_import_duplicate/.test(m)) return '같은 파일을 이미 넣었습니다.'
  if (/cost_import_too_many/.test(m)) return '오늘은 이 자료를 엑셀로 더 넣을 수 없습니다(하루 20번). 내일 다시 하세요.'
  if (/cost_import_invalid/.test(m)) return `${where}파일 줄의 모양이 맞지 않습니다. 다시 미리보기 하세요.`
  if (/cost_order_closed/.test(m)) return `${where}오더가 없거나 닫혔습니다.`
  if (/cost_lot_short/.test(m)) return `${where}구매 LOT 잔량을 넘습니다.`
  if (/cost_lot_invalid|cost_prod_lot_invalid/.test(m)) return `${where}구매 LOT를 쓸 수 없습니다(무효 · 다른 회사 · 생산일이 입고일보다 앞).`
  if (/cost_bom_real_locked/.test(m)) return '진짜 BOM 받기가 꺼져 있습니다.'
  if (/cost_bom_key_missing/.test(m)) return 'BOM 키가 없어 저장하지 못했습니다.'
  if (/cost_bom_invalid/.test(m)) return `${where}BOM 판의 모양이 맞지 않습니다.`
  if (/cost_overheads_scope/.test(m)) return `${where}범위(제품)는 원/kg 방식에만 씁니다.`
  // BOM은 DB 문장을 그대로 내지 않는다(값이 실릴 수 있는 문장 모두 막기).
  if (target === 'bom') return '등록하지 못했습니다. 다시 미리보기 하세요.'
  return `${where}${purchasingError(e, '등록하지 못했습니다. 잠시 후 다시 시도하세요.')}`
}

export async function previewCostImportAction(form: FormData): Promise<CostImportPreview> {
  const input = await readInput(form)
  if ('error' in input) return { error: input.error }
  try {
    const repo = await getRepository()
    const sha = sha256Hex(input.bytes)
    const [result, check, bomStatus] = await Promise.all([
      plan(repo, input),
      repo.costImportCheck(input.businessId, input.target, sha),
      input.target === 'bom' ? repo.bomStatus() : Promise.resolve(null),
    ])
    if (!check) return { error: '엑셀 넣기가 아직 준비되지 않았습니다(DB 0068 전).' }
    const seen = check.seen ? '같은 파일을 이미 넣었습니다 — 같은 파일은 두 번 넣지 않습니다.' : null
    return {
      target: input.target,
      fileName: input.fileName,
      sheets: result.sheets,
      sheet: result.sheet,
      headerRow: result.headerRow,
      headers: result.headers.map((h) => h.slice(0, 80)),
      fields: IMPORT_FIELDS[input.target].map(({ key, label, required, hint, example }) => ({ key, label, required, hint, example })),
      mapping: result.mapping,
      mappingConfirmed: result.mappingConfirmed,
      rows: result.rows,
      counts: result.counts,
      stamp: check.stamp,
      seen,
      locked: seen ?? result.locked,
      realAllowed: bomStatus?.real_allowed ?? false,
    }
  } catch (e) {
    console.error('[cost-import] preview', input.target, e instanceof CostImportFileError ? e.message : 'failed')
    return { error: importError(e, input.target) }
  }
}

export async function commitCostImportAction(form: FormData): Promise<CostImportCommit> {
  const input = await readInput(form)
  if ('error' in input) return { error: input.error }
  const stamp = String(form.get('stamp') ?? '')
  if (!/^[0-9a-f]{32}$/.test(stamp)) return { error: '미리보기를 먼저 하세요.' }
  try {
    const repo = await getRepository()
    const sha = sha256Hex(input.bytes)
    const result = await plan(repo, input)
    if (result.locked) return { error: result.locked }
    if (input.target === 'bom' && input.decisions.realBom) {
      const s = await repo.bomStatus()
      if (!s?.real_allowed) return { error: '진짜 BOM 받기가 꺼져 있습니다 — 가짜로만 넣을 수 있습니다.' }
    }
    const done = await repo.applyCostImport({
      businessId: input.businessId,
      target: input.target,
      fileName: input.fileName,
      sha256: sha,
      stamp,
      rows: result.payloads,
      edits: result.edits,
      skipped: result.skipped,
    })
    const base = IMPORT_AREA[input.target]
    revalidatePath(base === 'purchasing' ? `/purchasing/${input.businessId}` : base === 'production' ? `/production/${input.businessId}` : `/costs/${input.businessId}`, 'layout')
    return { done: { inserted: done.inserted, replaced: done.replaced, skipped: result.skipped } }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    console.error('[cost-import] commit', input.target, (/cost_[a-z_]+/.exec(m) ?? ['failed'])[0])
    if (/cost_import_stale/.test(m)) return { stale: true, error: '자료가 바뀌었습니다 — 다시 미리보기 하세요.' }
    return { error: importError(e, input.target) }
  }
}
