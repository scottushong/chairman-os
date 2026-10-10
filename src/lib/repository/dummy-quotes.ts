import { kstToday } from '@/lib/chairman-project'
import type { ApprovalTemplateKey, CostGrade, PriceCheck, Quote, QuoteInput } from '@/types'
import { QUOTE_TEMPLATE_KEY } from '@/types'

import { dummyModuleGrants, dummyViewer } from './dummy-org'
import type { AuditActor, NewDecision, QuoteMethods } from './types'

/**
 * 0066 견적의 dummy 거울(메모리). 판정은 DB 함수(quote_*)와 같은 글자로 흉내 낸다 — 스냅숏은 dummy cost_price_check(문 · (가) 0시 기준),
 * Red는 dummy 결재(0059 거울)의 «가격 예외»로, 확정은 그 결재가 승인일 때만. 반려는 읽을 때 «반려»로 옮긴다(0066 트리거 거울).
 */
export interface DummyQuoteDeps {
  priceCheck: (productId: string, price: number) => Promise<PriceCheck>
  productOf: (productId: string) => { business_id: string; name: string } | null
  createDecision: (input: NewDecision, actor: AuditActor) => Promise<{ decision_id: string; status: string }>
  decisionStatus: (decisionId: string) => string | null
  inSubtree: (viewerId: string, targetId: string) => boolean
}

const g = globalThis as unknown as { __chairmanDummyQuotes?: Quote[] }
const store: Quote[] = (g.__chairmanDummyQuotes ??= [])

const FX: Record<string, number> = { KRW: 1, USD: 1380 }

function grantOf(module: string, write = false): boolean {
  return dummyModuleGrants(dummyViewer().user_id).some((m) => m.module === module && (!write || m.can_write))
}

export function dummyQuotes(deps: DummyQuoteDeps): QuoteMethods {
  const viewer = () => dummyViewer()
  const chairman = () => viewer().role === 'Chairman'
  const visible = (q: Quote) => {
    const v = viewer()
    return chairman() || q.created_by === v.user_id || (v.role === 'TeamLead' && grantOf(`/sales/${q.business_id}`) && deps.inSubtree(v.user_id, q.created_by))
  }
  const writable = (q: Quote) => chairman() || (q.created_by === viewer().user_id && grantOf(`/sales/${q.business_id}`, true))
  const sync = (q: Quote) => {
    if (q.status === 'pending_approval' && q.decision_id && deps.decisionStatus(q.decision_id) === 'Rejected') q.status = 'rejected'
    return q
  }
  const find = (id: string) => {
    const q = store.find((x) => x.quote_id === id)
    if (!q || !writable(q)) throw new Error('quote_not_found')
    return sync(q)
  }

  return {
    async listQuotes(businessId) {
      return store.filter((q) => q.business_id === businessId && visible(q)).map((q) => ({ ...sync(q) })).sort((a, b) => b.created_at.localeCompare(a.created_at))
    },
    async getQuote(quoteId) {
      const q = store.find((x) => x.quote_id === quoteId)
      if (!q || !visible(q)) return null
      return { quote: { ...sync(q) }, versions: store.filter((x) => x.root_id === q.root_id).map((x) => ({ ...sync(x) })).sort((a, b) => a.version - b.version) }
    },
    async createQuote(i: QuoteInput) {
      const p = deps.productOf(i.product_id)
      if (!p || !(chairman() || grantOf(`/sales/${p.business_id}`, true))) throw new Error('quote_not_found')
      const today = kstToday()
      const max = new Date(Date.parse(`${today}T00:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10)
      if (!(i.kg > 0 && i.kg <= 1e9) || !(i.price_krw_per_kg > 0 && i.price_krw_per_kg <= 1e9) || !Number.isInteger(i.price_krw_per_kg) ||
          i.valid_until < today || i.valid_until > max || !i.customer_name.trim() || !i.customer_company.trim() || !/^[A-Z]{3}$/.test(i.currency)) {
        throw new Error('quote_invalid')
      }
      const fx = FX[i.currency]
      if (!fx) throw new Error('cost_fx_missing')
      let parent: Quote | undefined
      if (i.parent_id) {
        parent = find(i.parent_id)
        if (parent.business_id !== p.business_id) throw new Error('quote_not_found')
      }
      const pc = await deps.priceCheck(i.product_id, i.price_krw_per_kg) // 문(겸직 · 한도 · (가) 0시 기준)
      if (pc.total_krw_per_kg === null || pc.grade === null) throw new Error('quote_cost_unavailable')
      const id = `qt_${Math.random().toString(16).slice(2, 14)}`
      const root = parent ? parent.root_id : id
      const immediate = chairman() || grantOf(`/costing/${p.business_id}`)
      store.push({
        quote_id: id, business_id: p.business_id, root_id: root,
        version: parent ? Math.max(...store.filter((x) => x.root_id === root).map((x) => x.version)) + 1 : 1,
        parent_id: parent?.quote_id ?? null, customer_name: i.customer_name.trim(), customer_company: i.customer_company.trim(),
        product_id: i.product_id, product_name: p.name, kg: i.kg, price_krw_per_kg: i.price_krw_per_kg, currency: i.currency, fx_rate: fx,
        valid_until: i.valid_until, status: 'draft', cost_as_of: today, cost_basis: immediate ? 'now' : 'midnight',
        cost_total_krw_per_kg: pc.total_krw_per_kg, margin_krw_per_kg: pc.margin_krw_per_kg ?? 0, margin_pct: pc.margin_pct ?? 0,
        grade: pc.grade as CostGrade, decision_id: null, created_by: viewer().user_id, created_at: new Date().toISOString(),
        confirmed_at: null, cancelled_at: null,
      })
      if (parent && (parent.status === 'draft' || parent.status === 'pending_approval')) {
        parent.status = 'cancelled'
        parent.cancelled_at = new Date().toISOString()
      }
      return id
    },
    async requestQuoteApproval(quoteId) {
      const q = find(quoteId)
      if (q.grade !== 'red') throw new Error('quote_not_red')
      if (q.status !== 'draft') throw new Error('quote_not_draft')
      if (q.valid_until < kstToday()) throw new Error('quote_expired')
      const kg = q.kg.toLocaleString('en-US', { maximumFractionDigits: 3 })
      const d = await deps.createDecision(
        {
          business_id: q.business_id,
          title: `가격 예외 — ${q.product_name} ${kg}kg`,
          options: [],
          impact: 'Medium',
          deadline: q.valid_until,
          // 0066 «가격 예외»는 다섯 양식 밖이다(사람이 고르는 목록에 없다) — 이 길만 쓴다.
          template_key: QUOTE_TEMPLATE_KEY as unknown as ApprovalTemplateKey,
          form: { quote: `${q.quote_id} (${q.version}판)`, product: q.product_name, kg, price: q.price_krw_per_kg.toLocaleString('en-US'),
                  currency: q.currency, margin_pct: q.margin_pct.toFixed(1), grade: 'Red' },
        },
        { user_id: viewer().user_id, role: viewer().role },
      )
      q.status = 'pending_approval'
      q.decision_id = d.decision_id
      return d.decision_id
    },
    async confirmQuote(quoteId) {
      const q = find(quoteId)
      if (q.valid_until < kstToday()) throw new Error('quote_expired')
      if (q.grade === 'red') {
        if (q.status !== 'pending_approval' || !q.decision_id || deps.decisionStatus(q.decision_id) !== 'Approved') throw new Error('quote_needs_approval')
      } else if (q.status !== 'draft') {
        throw new Error('quote_not_draft')
      }
      q.status = 'confirmed'
      q.confirmed_at = new Date().toISOString()
      for (const x of store) {
        if (x.root_id === q.root_id && x.quote_id !== q.quote_id && x.status === 'confirmed') {
          x.status = 'cancelled'
          x.cancelled_at = q.confirmed_at
        }
      }
    },
    async cancelQuote(quoteId) {
      const q = find(quoteId)
      if (q.status !== 'draft' && q.status !== 'pending_approval') throw new Error('quote_not_draft')
      q.status = 'cancelled'
      q.cancelled_at = new Date().toISOString()
    },
    async logQuoteDownload(quoteId, format) {
      const q = store.find((x) => x.quote_id === quoteId)
      if (!q || !visible(q)) throw new Error('quote_not_found')
      if (q.status !== 'confirmed' || !['xlsx', 'pdf'].includes(format)) throw new Error('quote_not_confirmed')
      if (process.env.NODE_ENV !== 'production') console.warn(`[dummy] 고객용 견적서 ${format} ${quoteId} — dummy는 감사를 남기지 않는다.`)
    },
  }
}
