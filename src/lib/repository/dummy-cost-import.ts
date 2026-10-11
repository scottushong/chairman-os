import { createHash } from 'node:crypto'

import type {
  BomPayload,
  ImportPayload,
  MarketPricePayload,
  MaterialPayload,
  OverheadPayload,
  ProductionPayload,
  PurchaseLotPayload,
  SupplierPayload,
} from '@/lib/cost-import/payload'
import type { ImportTarget } from '@/lib/cost-import/types'
import type { MaterialCategory, OverheadBasis, OverheadCategory } from '@/types'

import { dummyViewer } from './dummy-org'
import { dummyPurchasing } from './dummy-purchasing'
import { dummyCosts, dummyProduction } from './dummy-sales-cost'
import type { CostImportMethods } from './types'

/**
 * 0068 엑셀 넣기의 dummy 거울. live의 cost_import_apply를 흉내 낸다 — 도장 대조 · 같은 해시 · 하루 20번 · 바꾸기(무효 + 새 줄 / 마스터 수정)
 * · 줄마다 기존 dummy 메서드(권한 · 이상치 · 잔량 흉내가 이미 거기 있다). 판정 문구는 DB와 같은 코드(cost_import_*)로 던진다.
 * 한 트랜잭션은 흉내 내지 못한다 — 대신 계획(plan.ts)이 등록 직전에 같은 검사를 다 돈 뒤에만 부른다.
 */

const seen = new Set<string>()
const log: { target: ImportTarget; user: string; at: number }[] = []

async function stampOf(businessId: string, target: ImportTarget): Promise<string> {
  const p = dummyPurchasing()
  const pr = dummyProduction()
  const c = dummyCosts()
  const parts: unknown[] = [target]
  if (['materials', 'market_prices', 'purchase_lots', 'bom'].includes(target)) parts.push(await p.listCostMaterials(businessId))
  if (['suppliers', 'purchase_lots'].includes(target)) parts.push(await p.listCostSuppliers(businessId))
  if (target === 'market_prices') parts.push(await p.listMarketPrices(businessId, 3650))
  if (['purchase_lots', 'production'].includes(target)) parts.push(await p.listPurchaseLots(businessId))
  if (['overheads', 'bom'].includes(target)) parts.push(await c.listCostProducts(businessId))
  if (target === 'overheads') parts.push(await c.listOverheads(businessId))
  if (target === 'production') parts.push(await pr.listProductionOrders(businessId), await pr.listProdLots(businessId), await pr.listProdInputs(businessId))
  if (target === 'bom') parts.push(await c.bomVersions(businessId))
  return createHash('md5').update(JSON.stringify(parts)).digest('hex')
}

export function dummyCostImport(): CostImportMethods {
  return {
    async costImportCheck(businessId, target, sha256) {
      return { stamp: await stampOf(businessId, target), seen: seen.has(`${businessId}|${target}|${sha256}`) }
    },

    async applyCostImport(input) {
      const { businessId: b, target } = input
      const me = dummyViewer()
      if (target === 'bom' && me.role !== 'Chairman') throw new Error('cost_not_found')
      const since = Date.now() - 86_400_000
      if (log.filter((x) => x.user === me.user_id && x.target === target && x.at > since).length >= 20) throw new Error('cost_import_too_many')
      if (input.stamp !== (await stampOf(b, target))) throw new Error('cost_import_stale')
      const key = `${b}|${target}|${input.sha256}`
      if (seen.has(key)) throw new Error('cost_import_duplicate')
      const p = dummyPurchasing()
      const pr = dummyProduction()
      const c = dummyCosts()
      let replaced = 0
      let inserted = 0
      const rows: ImportPayload[] = input.rows
      for (const [i, raw] of rows.entries()) {
        try {
          switch (target) {
            case 'materials': {
              const r = raw as MaterialPayload
              await p.saveCostMaterial(b, { name: r.name, spec: r.spec, category: r.category as MaterialCategory, active: true, note: r.note }, r.replace_id)
              if (r.replace_id) replaced += 1
              else inserted += 1
              break
            }
            case 'suppliers': {
              const r = raw as SupplierPayload
              await p.saveCostSupplier(
                b,
                { name: r.name, country: r.country, currency_default: r.currency_default, contact: r.contact, terms: r.terms, active: true, note: r.note },
                r.replace_id,
              )
              if (r.replace_id) replaced += 1
              else inserted += 1
              break
            }
            case 'market_prices': {
              const r = raw as MarketPricePayload
              if (r.replace_id) {
                await p.voidMarketPrice(b, Number(r.replace_id), r.reason ?? '')
                replaced += 1
              }
              await p.addMarketPrice(b, {
                material_id: r.material_id,
                observed_on: r.observed_on,
                price: Number(r.price),
                currency: r.currency,
                fx_rate: r.fx_rate === null ? null : Number(r.fx_rate),
                source_name: r.source_name,
                source_url: r.source_url,
                note: r.note,
              })
              inserted += 1
              break
            }
            case 'purchase_lots': {
              const r = raw as PurchaseLotPayload
              if (r.replace_id) {
                await p.voidPurchaseLot(b, r.replace_id, r.reason ?? '')
                replaced += 1
              }
              await p.addPurchaseLot(b, {
                material_id: r.material_id,
                supplier_id: r.supplier_id,
                received_on: r.received_on,
                ordered_on: r.ordered_on,
                supplier_lot_no: r.supplier_lot_no,
                qty_kg: Number(r.qty_kg),
                unit_price: Number(r.unit_price),
                currency: r.currency,
                fx_rate: r.fx_rate === null ? null : Number(r.fx_rate),
                freight_krw: Number(r.freight_krw),
                duty_krw: Number(r.duty_krw),
                other_krw: Number(r.other_krw),
                note: r.note,
              } as Parameters<typeof p.addPurchaseLot>[1])
              inserted += 1
              break
            }
            case 'overheads': {
              const r = raw as OverheadPayload
              if (r.replace_id) {
                await c.voidOverhead(b, Number(r.replace_id), r.reason ?? '')
                replaced += 1
              }
              await c.addOverhead(b, {
                category: r.category as OverheadCategory,
                basis: r.basis as OverheadBasis,
                amount: Number(r.amount),
                product_id: r.product_id,
                effective_from: r.effective_from,
                note: r.note,
              } as Parameters<typeof c.addOverhead>[1])
              inserted += 1
              break
            }
            case 'production': {
              const r = raw as ProductionPayload
              const lot = await pr.addProdLot(b, {
                order_id: r.order_id,
                produced_on: r.produced_on,
                output_kg: Number(r.output_kg),
                note: r.note,
              } as Parameters<typeof pr.addProdLot>[1])
              for (const x of r.inputs) await pr.addProdInput(b, { prod_lot_id: lot.prod_lot_id, lot_id: x.lot_id, qty_kg: Number(x.qty_kg) })
              inserted += 1
              break
            }
            case 'bom': {
              const r = raw as BomPayload
              const live = (await c.bomVersions(b)).find((v) => v.product_id === r.product_id && v.valid_from === r.valid_from && !v.voided_at)
              if (r.replace_id) {
                if (!live || String(live.version_id) !== r.replace_id) throw new Error('cost_import_stale')
                await c.bomVoid(Number(r.replace_id), r.reason ?? '')
                replaced += 1
              } else if (live) {
                throw new Error('cost_import_stale')
              }
              await c.bomSave(
                r.product_id,
                r.valid_from,
                Number(r.yield_pct),
                r.lines.map((l) => ({ material_id: l.material_id, kg_per_kg: Number(l.kg_per_kg) })),
                r.note,
                r.is_fake,
              )
              inserted += 1
              break
            }
          }
        } catch (e) {
          throw new Error(`${e instanceof Error ? e.message : String(e)} (item ${i + 1})`)
        }
      }
      seen.add(key)
      log.push({ target, user: me.user_id, at: Date.now() })
      return { importId: crypto.randomUUID(), inserted, replaced }
    },
  }
}
