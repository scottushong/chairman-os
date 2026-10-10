'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import { createQuoteAction } from '@/app/actions/quotes'
import { checkPriceAction } from '@/app/actions/sales'
import { Alert, BTN_PRIMARY, FIELD, LABEL } from '@/components/purchasing/shared'
import { GradeBadge } from '@/components/sales/sales-cost-board'
import { NumberInput } from '@/components/ui/number-input'
import { krw, RED_NOTICE } from '@/lib/sales/cost'
import { QUOTE_CURRENCIES, type IsoDate, type PriceCheck, type Quote } from '@/types'

/**
 * 새 견적 · 새 판(0066). 제시가를 넣으면 등급을 바로 보여 준다(0062 cost_price_check — 영업은 오늘 0시 기준).
 * 저장하면 DB가 같은 계산으로 스냅숏을 다시 만든다(화면 값은 믿지 않는다). 원료는 이 화면 어디에도 없다.
 */
export function QuoteForm({
  businessId,
  products,
  today,
  parent = null,
}: {
  businessId: string
  products: { product_id: string; name: string }[]
  today: IsoDate
  parent?: Quote | null
}) {
  const router = useRouter()
  const [productId, setProductId] = useState(parent?.product_id ?? products[0]?.product_id ?? '')
  const [customerName, setCustomerName] = useState(parent?.customer_name ?? '')
  const [customerCompany, setCustomerCompany] = useState(parent?.customer_company ?? '')
  const [kg, setKg] = useState(parent ? parent.kg.toLocaleString('en-US') : '')
  const [price, setPrice] = useState(parent ? parent.price_krw_per_kg.toLocaleString('en-US') : '')
  const [currency, setCurrency] = useState(parent?.currency ?? 'KRW')
  const [validUntil, setValidUntil] = useState(new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10))
  const [check, setCheck] = useState<PriceCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // 제시가 · 제품이 바뀌면 잠깐 뒤 등급을 다시 본다(하루 조회 한도에 하루 · 제품마다 한 건으로 센다 — DB 감사 규칙).
  useEffect(() => {
    setCheck(null)
    if (!productId || !price) return
    const t = setTimeout(async () => {
      const r = await checkPriceAction({ productId, price })
      if (r.result) setCheck(r.result)
    }, 600)
    return () => clearTimeout(t)
  }, [productId, price])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    start(async () => {
      const r = await createQuoteAction({ businessId, productId, customerName, customerCompany, kg, price, currency, validUntil, parentId: parent?.quote_id ?? null })
      if (r.error) setError(r.error)
      else if (r.id) router.push(`/sales/${businessId}/quotes/${r.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line-soft bg-panel p-4" aria-label={parent ? '새 판' : '새 견적'}>
      <h2 className="text-t13 font-semibold">{parent ? `새 판 — ${parent.version + 1}판 (원본 ${parent.version}판)` : '새 견적'}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1">
          <span className={LABEL}>고객 이름</span>
          <input className={FIELD} value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={100} required placeholder="예: 김구매" />
        </label>
        <label className="space-y-1">
          <span className={LABEL}>고객 회사</span>
          <input className={FIELD} value={customerCompany} onChange={(e) => setCustomerCompany(e.target.value)} maxLength={200} required placeholder="예: (주)가나식품" />
        </label>
        <label className="space-y-1">
          <span className={LABEL}>제품</span>
          <select className={FIELD} value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={LABEL}>수량</span>
          <NumberInput kind="number" unit="kg" reading={false} value={kg} onChange={setKg} className={FIELD} placeholder="예: 1,000" />
        </label>
        <label className="space-y-1">
          <span className={LABEL}>제시가(원/kg, 1원 단위)</span>
          <NumberInput kind="money" unit="원" reading={false} value={price} onChange={setPrice} className={FIELD} placeholder="예: 3,500" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className={LABEL}>통화(고객용 견적서)</span>
            <select className={FIELD} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {QUOTE_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={LABEL}>유효기간</span>
            <input type="date" className={FIELD} value={validUntil} min={today} onChange={(e) => setValidUntil(e.target.value)} required />
          </label>
        </div>
      </div>
      {check && check.grade && check.margin_pct !== null ? (
        <div className="space-y-1 rounded-lg border border-line-soft bg-raised/40 px-3 py-2">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-t13">
            <span>
              총원가 <b className="tnum">{krw(check.total_krw_per_kg)}원/kg</b>
            </span>
            <span>
              마진 <b className="tnum">{krw(check.margin_krw_per_kg)}원/kg · {check.margin_pct.toFixed(1)}%</b>
            </span>
            <GradeBadge grade={check.grade} />
          </p>
          {check.grade === 'red' ? <p className="text-t12 font-semibold text-critical">{RED_NOTICE}</p> : null}
        </div>
      ) : null}
      <Alert text={error} />
      <div className="flex items-center gap-3">
        <button type="submit" className={BTN_PRIMARY} disabled={pending || !productId || !price || !kg}>
          {pending ? '저장 중…' : '견적 저장'}
        </button>
        <span className="text-t10h text-ink-muted">저장한 견적은 고칠 수 없습니다 — 바꾸려면 새 판을 만듭니다.</span>
      </div>
    </form>
  )
}
