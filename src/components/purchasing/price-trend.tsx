'use client'

import { useState } from 'react'

import { MetricTrendChart } from '@/components/ui/metric-trend-chart'
import { aggregate, won, type Granularity } from '@/lib/purchasing/calc'

/**
 * 원료 가격 추이 — 일 / 주 / 월. 서버는 **일 단위 원자료**만 넘기고 주 · 월은 여기서 묶는다(설계서 9 — 저장하지 않는다).
 * 주 = ISO 주(월요일 시작). 구매가는 수량 가중(Σ landed × kg ÷ Σ kg), 시장가는 그 기간 날들의 평균(하루 한 값).
 */

export interface MaterialSeries {
  material_id: string
  name: string
  market: { date: string; value: number }[]
  purchase: { date: string; value: number; kg: number }[]
}

const WINDOW: Record<Granularity, number> = { day: 45, week: 26, month: 12 }
const G_LABEL: Record<Granularity, string> = { day: '일', week: '주', month: '월' }

function tick(bucket: string, g: Granularity): string {
  if (g === 'month') return bucket.slice(2, 7)
  return bucket.slice(5).replace('-', '/')
}

export function PriceTrend({ series }: { series: MaterialSeries[] }) {
  const [materialId, setMaterialId] = useState(series[0]?.material_id ?? '')
  const [kind, setKind] = useState<'market' | 'purchase'>('market')
  const [g, setG] = useState<Granularity>('day')

  const s = series.find((x) => x.material_id === materialId)
  if (!s) return null
  const daily = kind === 'market' ? s.market : s.purchase
  const points = aggregate(daily, g).slice(-WINDOW[g])
  const last = points[points.length - 1]

  const toggle = (active: boolean) =>
    `min-h-11 rounded px-2.5 text-t11h transition-colors lg:min-h-0 lg:py-1 ${active ? 'bg-accent/15 font-semibold text-ink' : 'text-ink-dim hover:text-ink'}`

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="가격 추이">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-t12h font-semibold">가격 추이 (원/kg)</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-line bg-panel px-2 py-1 text-t12 text-ink max-lg:min-h-11"
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            aria-label="원료"
          >
            {series.map((x) => (
              <option key={x.material_id} value={x.material_id}>
                {x.name}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-line bg-panel p-0.5" role="group" aria-label="계열">
            <button type="button" className={toggle(kind === 'market')} aria-pressed={kind === 'market'} onClick={() => setKind('market')}>
              시장가
            </button>
            <button type="button" className={toggle(kind === 'purchase')} aria-pressed={kind === 'purchase'} onClick={() => setKind('purchase')}>
              구매가
            </button>
          </div>
          <div className="flex rounded-md border border-line bg-panel p-0.5" role="group" aria-label="기간 단위">
            {(['day', 'week', 'month'] as const).map((x) => (
              <button key={x} type="button" className={toggle(g === x)} aria-pressed={g === x} onClick={() => setG(x)}>
                {G_LABEL[x]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {points.length === 0 ? (
        <p className="mt-6 mb-4 text-center text-t12 text-ink-muted">{kind === 'market' ? '시장가가 없습니다.' : '구매 LOT가 없습니다.'}</p>
      ) : (
        <div className="mt-3">
          <MetricTrendChart
            points={points.map((p) => ({
              label: tick(p.bucket, g),
              value: Math.round(p.value),
              provisional: false,
              title: `${p.bucket}${g === 'week' ? ' 주' : ''} · ${won(p.value)}원/kg${kind === 'purchase' ? ` · ${Math.round(p.weight).toLocaleString('ko-KR')}kg` : ''}`,
            }))}
            formatY={(v) => v.toLocaleString('ko-KR')}
            lastLabel={last ? `${tick(last.bucket, g)} ${won(last.value)}원` : ''}
            ariaLabel={`${s.name} ${kind === 'market' ? '시장가' : '구매가'} ${G_LABEL[g]} 단위 추이`}
          />
          <p className="mt-1 text-t10h text-ink-muted">
            {kind === 'market' ? '시장가 — 같은 날 여러 출처는 평균, 주 · 월은 그 기간 날들의 평균.' : '구매가 — Landed 원/kg, 주 · 월은 수량(kg) 가중평균.'} 주는 월요일
            시작(ISO).
          </p>
        </div>
      )}
    </section>
  )
}
