'use client'

import { useState } from 'react'

import { addMarketPriceAction, voidMarketPriceAction } from '@/app/actions/purchasing'
import { NumberInput } from '@/components/ui/number-input'
import { parseNum, won } from '@/lib/purchasing/calc'
import type { CostMaterial, MarketPrice } from '@/types'

import { FxField, useFxLookup } from './fx-field'
import { Alert, BTN_PRIMARY, CURRENCIES, FIELD, FIELD_INLINE, LABEL, Notice, VoidButton, VoidTag } from './shared'

/**
 * 시장가 입력 · 이력(0061 cost_market_prices — 일 단위 원자료). 고치지 않는다: 틀리면 무효(이유 필수) + 새 줄.
 * 원화 kg당 값은 DB가 계산해 돌려준 값을 그린다. 미리보기는 같은 식(가격 × 환율)일 뿐이다.
 */
export function MarketManager({
  businessId,
  materials,
  prices,
  canEdit,
  today,
}: {
  businessId: string
  materials: CostMaterial[]
  prices: MarketPrice[]
  canEdit: boolean
  today: string
}) {
  const active = materials.filter((m) => m.active)
  const name = new Map(materials.map((m) => [m.material_id, m.name]))
  const [list, setList] = useState(prices)
  const [filter, setFilter] = useState('')
  const [showVoided, setShowVoided] = useState(false)

  const [observedOn, setObservedOn] = useState(today)
  const [materialId, setMaterialId] = useState(active[0]?.material_id ?? '')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('KRW')
  const [fx, setFx] = useState('')
  const [source, setSource] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const fxAuto = useFxLookup(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rate = currency === 'KRW' ? 1 : (parseNum(fx) ?? fxAuto.auto)
  const p = parseNum(price)
  const krw = p !== null && rate !== null ? p * rate : null

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const r = await addMarketPriceAction({
      businessId,
      material_id: materialId,
      observed_on: observedOn,
      price,
      currency,
      fx_rate: fx,
      source_name: source,
      source_url: url,
      note,
    })
    setBusy(false)
    if (r.error || !r.price) {
      setError(r.error ?? '저장하지 못했습니다.')
      return
    }
    const saved = r.price
    setList((l) => [saved, ...l])
    setNotice(`${name.get(saved.material_id) ?? ''} ${saved.observed_on} — kg당 ${won(saved.price_krw_per_kg)}원으로 넣었습니다.`)
    setPrice('')
    setNote('')
  }

  const rows = list.filter((r) => (!filter || r.material_id === filter) && (showVoided || !r.voided_at))

  return (
    <div className="mt-4 space-y-3">
      <Alert text={error} />
      <Notice text={notice} />

      {canEdit ? (
        <section className="rounded-xl border border-line-soft bg-panel p-3">
          <h2 className="text-t12h font-semibold">시장가 넣기</h2>
          {active.length === 0 ? (
            <p className="mt-2 text-t11h text-ink-muted">원료가 없습니다 — «원료»에서 먼저 넣으세요.</p>
          ) : (
            <>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className={LABEL}>
                  날짜
                  <input
                    type="date"
                    className={`${FIELD} mt-0.5`}
                    value={observedOn}
                    max={today}
                    disabled={busy}
                    onChange={(e) => {
                      setObservedOn(e.target.value)
                      void fxAuto.lookup(currency, e.target.value)
                    }}
                  />
                </label>
                <label className={LABEL}>
                  원료
                  <select className={`${FIELD} mt-0.5`} value={materialId} disabled={busy} onChange={(e) => setMaterialId(e.target.value)}>
                    {active.map((m) => (
                      <option key={m.material_id} value={m.material_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  가격 (kg당)
                  <NumberInput
                    kind="number"
                    unit={currency}
                    reading={false}
                    className={`${FIELD} mt-0.5`}
                    value={price}
                    onChange={setPrice}
                    disabled={busy}
                  />
                </label>
                <label className={LABEL}>
                  통화
                  <select
                    className={`${FIELD} mt-0.5`}
                    value={currency}
                    disabled={busy}
                    onChange={(e) => {
                      setCurrency(e.target.value)
                      setFx('')
                      void fxAuto.lookup(e.target.value, observedOn)
                    }}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <FxField currency={currency} auto={fxAuto.auto} autoLoading={fxAuto.loading} value={fx} onChange={setFx} disabled={busy} />
                <label className={LABEL}>
                  출처
                  <input
                    className={`${FIELD} mt-0.5`}
                    value={source}
                    maxLength={120}
                    placeholder="예: 거래처 시세 문자 · 구매팀 조사"
                    disabled={busy}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </label>
                <label className={LABEL}>
                  출처 주소 (선택)
                  <input
                    className={`${FIELD} mt-0.5`}
                    value={url}
                    maxLength={1000}
                    placeholder="https://"
                    inputMode="url"
                    disabled={busy}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </label>
                <label className={LABEL}>
                  메모 (선택)
                  <input className={`${FIELD} mt-0.5`} value={note} maxLength={500} disabled={busy} onChange={(e) => setNote(e.target.value)} />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" className={BTN_PRIMARY} disabled={busy || !materialId} onClick={submit}>
                  {busy ? '저장 중…' : '넣기'}
                </button>
                <span className="text-t11h text-ink-dim">
                  원화 kg당 <span className="tnum font-semibold text-ink">{krw !== null ? `${won(krw)}원` : '—'}</span>
                  {currency !== 'KRW' ? ' (미리보기 — 저장 값은 DB가 계산)' : ''}
                </span>
              </div>
            </>
          )}
        </section>
      ) : null}

      <section className="rounded-xl border border-line-soft bg-panel p-3 max-sm:border-0 max-sm:bg-transparent max-sm:p-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-t12h font-semibold">이력 (최근 90일)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select className={FIELD_INLINE} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="원료로 거르기">
              <option value="">원료 전부</option>
              {materials.map((m) => (
                <option key={m.material_id} value={m.material_id}>
                  {m.name}
                </option>
              ))}
            </select>
            <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink-dim lg:min-h-0">
              <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
              무효 줄도
            </label>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-t12 text-ink-muted">시장가가 없습니다.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="m-cards w-full text-t12 sm:min-w-[860px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className="px-2 py-2 font-normal">날짜</th>
                  <th className="px-2 py-2 font-normal">원료</th>
                  <th className="px-2 py-2 text-right font-normal">가격</th>
                  <th className="px-2 py-2 text-right font-normal">환율</th>
                  <th className="px-2 py-2 text-right font-normal">원/kg</th>
                  <th className="px-2 py-2 font-normal">출처</th>
                  <th className="px-2 py-2 text-right font-normal">{canEdit ? '정정' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.price_id} className={`border-t border-line-soft ${r.voided_at ? 'text-ink-muted line-through decoration-ink-muted/50' : ''}`}>
                    <td className="px-2 py-1.5 tnum max-sm:font-semibold">{r.observed_on}</td>
                    <td className="px-2 py-1.5" data-label="원료">
                      <span>
                        {name.get(r.material_id) ?? r.material_id}
                        {r.voided_at ? <VoidTag reason={r.void_reason} /> : null}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tnum" data-label="가격">
                      {r.price.toLocaleString('ko-KR', { maximumFractionDigits: 4 })} {r.currency}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum text-ink-dim" data-label="환율">
                      {r.currency === 'KRW' ? '—' : r.fx_rate.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum font-semibold" data-label="원/kg">
                      {won(r.price_krw_per_kg)}
                    </td>
                    <td className="px-2 py-1.5 text-t11 text-ink-dim" data-label="출처">
                      {r.source_url ? (
                        <a href={r.source_url} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">
                          {r.source_name}
                        </a>
                      ) : (
                        r.source_name
                      )}
                      {r.note ? <span className="block text-t10h text-ink-muted">{r.note}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right" data-label={canEdit && !r.voided_at ? '정정' : undefined}>
                      {canEdit && !r.voided_at ? (
                        <VoidButton
                          onVoid={async (reason) => {
                            const res = await voidMarketPriceAction(businessId, r.price_id, reason)
                            if (!res.error) {
                              setList((l) =>
                                l.map((x) => (x.price_id === r.price_id ? { ...x, voided_at: new Date().toISOString(), void_reason: reason } : x)),
                              )
                            }
                            return res.error
                          }}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
