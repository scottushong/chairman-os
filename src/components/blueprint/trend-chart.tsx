import { krw } from '@/lib/sales/cost'
import type { ProductTrendPoint } from '@/types'

/**
 * ⑧ 제품 추이 차트(0081 product_trend) — 새 라이브러리 없이 인라인 SVG. 축 하나 원칙: 위 칸 = 원/kg 세 줄(판매가 · Actual · Market 원료비),
 * 아래 칸 = GM%(같은 가로축 · 따로 세로축 — 두 눈금을 한 칸에 겹치지 않는다). 점마다 <title>(마우스를 올리면 값). 표는 차트 아래(같은 값).
 * 색은 dataviz 기준 팔레트 1~3번(파랑 · 주황 · 청록) — 범례 + 줄 끝 이름이 늘 함께라 색만으로 구분하지 않는다.
 */

const SERIES = [
  { key: 'price_krw_per_kg', label: '판매가', color: '#2a78d6' },
  { key: 'actual_krw_per_kg', label: 'Actual', color: '#eb6834' },
  { key: 'market_material_krw_per_kg', label: 'Market 원료비', color: '#1baf7a' },
] as const

const W = 720
const PAD_L = 64
const PAD_R = 96
const TOP_H = 200
const BOT_H = 90
const GAP = 28

function ticks(min: number, max: number, n = 4): number[] {
  if (min === max) return [min]
  const step = (max - min) / n
  return Array.from({ length: n + 1 }, (_, i) => min + step * i)
}

function path(points: { x: number; y: number | null }[]): string {
  let d = ''
  let pen = false
  for (const p of points) {
    if (p.y === null) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)} `
    pen = true
  }
  return d.trim()
}

export function TrendChart({ points }: { points: ProductTrendPoint[] }) {
  if (points.length === 0) return <p className="text-t12 text-ink-muted">이 기간에 점이 없습니다.</p>
  const plotW = W - PAD_L - PAD_R
  const x = (i: number) => PAD_L + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1))
  const vals = points.flatMap((p) => SERIES.map((s) => p[s.key])).filter((v): v is number => v !== null)
  const gms = points.map((p) => p.gm_pct).filter((v): v is number => v !== null)
  if (vals.length === 0 && gms.length === 0) return <p className="text-t12 text-ink-muted">자료 없음 · 필요한 것: 판매 · 생산 LOT · 시장가 기록</p>
  const lo = vals.length ? Math.min(...vals) * 0.95 : 0
  const hi = vals.length ? Math.max(...vals) * 1.05 : 1
  const y = (v: number) => 12 + (TOP_H - 24) * (1 - (v - lo) / (hi - lo || 1))
  const gLo = gms.length ? Math.min(0, ...gms) : 0
  const gHi = gms.length ? Math.max(25, ...gms) : 25
  const top2 = TOP_H + GAP
  const gy = (v: number) => top2 + 8 + (BOT_H - 16) * (1 - (v - gLo) / (gHi - gLo || 1))
  const H = top2 + BOT_H + 24
  const every = Math.max(1, Math.ceil(points.length / 8))

  return (
    <figure className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-t11 text-ink-dim" aria-label="범례">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden />
            {s.label}(원/kg)
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-ink-dim" aria-hidden />
          GM%(아래 칸)
        </li>
      </ul>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="판매가 · Actual · Market 원료비(원/kg)와 GM% 추이">
          {ticks(lo, hi).map((t) => (
            <g key={`t${t}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--color-line-soft)" strokeWidth={1} />
              <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" fontSize={13} fill="var(--color-ink-muted)">
                {krw(t)}
              </text>
            </g>
          ))}
          {SERIES.map((s) => {
            const pts = points.map((p, i) => ({ x: x(i), y: p[s.key] === null ? null : y(p[s.key]!) }))
            const last = [...pts].reverse().find((p) => p.y !== null)
            return (
              <g key={s.key}>
                <path d={path(pts)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {points.map((p, i) =>
                  p[s.key] === null ? null : (
                    <circle key={i} cx={x(i)} cy={y(p[s.key]!)} r={4} fill={s.color} stroke="var(--color-panel)" strokeWidth={2}>
                      <title>{`${p.period_start} · ${s.label} ${krw(p[s.key])}원/kg`}</title>
                    </circle>
                  ),
                )}
                {last ? (
                  <text x={last.x + 8} y={(last.y ?? 0) + 4} fontSize={13} fill="var(--color-ink-dim)">
                    {s.label}
                  </text>
                ) : null}
              </g>
            )
          })}
          {ticks(gLo, gHi, 2).map((t) => (
            <g key={`g${t}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={gy(t)} y2={gy(t)} stroke="var(--color-line-soft)" strokeWidth={1} />
              <text x={PAD_L - 6} y={gy(t) + 4} textAnchor="end" fontSize={13} fill="var(--color-ink-muted)">
                {t.toFixed(0)}%
              </text>
            </g>
          ))}
          <path d={path(points.map((p, i) => ({ x: x(i), y: p.gm_pct === null ? null : gy(p.gm_pct) })))} fill="none" stroke="var(--color-ink-dim)" strokeWidth={2} />
          {points.map((p, i) =>
            p.gm_pct === null ? null : (
              <circle key={`gm${i}`} cx={x(i)} cy={gy(p.gm_pct)} r={4} fill="var(--color-ink-dim)" stroke="var(--color-panel)" strokeWidth={2}>
                <title>{`${p.period_start} · GM ${p.gm_pct.toFixed(1)}%`}</title>
              </circle>
            ),
          )}
          <text x={W - PAD_R + 8} y={top2 + 14} fontSize={13} fill="var(--color-ink-dim)">
            GM%
          </text>
          {points.map((p, i) =>
            i % every === 0 ? (
              <text key={`x${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize={13} fill="var(--color-ink-muted)">
                {p.period_start.slice(2)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </figure>
  )
}
