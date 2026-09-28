import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { COMPLETION_WEIGHTS, closeupSrc, stageSrc, type CityItem } from '@/lib/city'
import { formatEok } from '@/lib/format'
import { AUTONOMY_EMPTY_KO, AUTONOMY_TAG_EN, CITY_STAGE_LABEL_KO } from '@/types'

/**
 * /group 우측 패널 — 클로즈업 + 요약 + 상세 링크.
 *
 * **완성도의 세 조각을 따로 적는다.** 62%만 적으면 그것이 자율성에서 왔는지 매출에서 왔는지
 * 알 수 없고, 회장이 무엇을 움직여야 건물이 올라가는지도 알 수 없다. 없는 조각은 «없음»으로
 * 적는다 — 그 조각은 계산에서 빠졌고(lib/city.ts completionOf), 0%로 들어간 것이 아니다.
 */
export function CityPanel({ item }: { item: CityItem }) {
  const lot = item.kind === 'initiative'
  const { parts, pct } = item.completion
  const main = closeupSrc(item.layout, item.stage)
  const stageThumb = stageSrc(item.stage)

  return (
    <aside className="glass overflow-hidden rounded-glass" aria-label={`${item.name} 요약`}>
      <div className="relative aspect-[4/3] w-full bg-raised">
        {/* eslint-disable-next-line @next/next/no-img-element -- 미리 만든 webp 한 장(scripts/city-assets.mjs). */}
        <img src={main} alt={`${item.name} 클로즈업`} className="size-full object-cover" />
        {/* 회사 건물 그림 위에 공사 단계를 작은 그림으로 겹친다 — 둘이 같은 그림이면 겹치지 않는다. */}
        {main !== stageThumb ? (
          <span className="absolute right-2 bottom-2 overflow-hidden rounded-md border border-white/70 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element -- 위와 같다. */}
            <img src={stageThumb} alt="" className="h-16 w-20 object-cover" />
          </span>
        ) : null}
        <span className="absolute top-2 left-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
          {CITY_STAGE_LABEL_KO[item.stage]}
          {!lot && item.layout.stage_image ? <span className="ml-1 font-normal text-white/75">(고정)</span> : null}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <p className="text-[11px] text-ink-muted">{lot ? '이니셔티브 · 빈 터' : '회사'}</p>
          <h2 className="text-[17px] font-bold tracking-tight">{item.name}</h2>
        </div>

        {lot ? (
          <p className="text-[12px] leading-relaxed text-ink-dim">
            아직 회사가 아닌 자리입니다. 회장님이 /group/edit에서 이 터를 회사로 승격하면 같은 자리에
            기초 공사가 섭니다.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Fact
                label={item.revenuePeriod ? `매출 (${item.revenuePeriod})` : '매출'}
                value={item.revenue !== null ? formatEok(item.revenue) : '—'}
              />
              <Fact label="자율성" value={item.level ?? '—'} hint={item.level ? AUTONOMY_TAG_EN[item.level] : AUTONOMY_EMPTY_KO} />
              <Fact label="완성도" value={pct === null ? '—' : `${pct}%`} />
            </dl>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-ink-dim">완성도는 어디서 왔나</p>
              <Part label="자율성 (L ÷ 5)" weight={COMPLETION_WEIGHTS.autonomy} value={parts.autonomy} empty="평가 없음" />
              <Part label="매출 목표 달성" weight={COMPLETION_WEIGHTS.revenue} value={parts.revenue} empty="목표 없음" />
              <Part label="이양률" weight={COMPLETION_WEIGHTS.transfer} value={parts.transfer} empty="이양 계획 없음" />
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-muted">
                없는 항목은 0으로 넣지 않고 빼고 계산합니다. 0~25 기초 · ~60 골조 · ~90 마감 · 100 완공.
              </p>
            </div>
          </>
        )}

        <Link
          href={item.href}
          className="flex items-center justify-center gap-1 rounded-lg border border-line bg-raised px-3 py-2 text-[12.5px] font-semibold transition-colors hover:border-accent"
        >
          {lot ? '이니셔티브 상세' : '회사 상세'}
          <Icon name="chevron-right" className="size-4" />
        </Link>
      </div>
    </aside>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line-soft bg-raised px-2 py-2" title={hint}>
      <dt className="text-[10.5px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-bold tnum">{value}</dd>
    </div>
  )
}

function Part({ label, weight, value, empty }: { label: string; weight: number; value: number | null; empty: string }) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11.5px]">
      <span className="w-[108px] shrink-0 text-ink-dim">
        {label} <span className="text-ink-muted tnum">×{weight}</span>
      </span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
        {pct !== null ? <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /> : null}
      </span>
      <span className="w-[76px] shrink-0 text-right text-ink-dim tnum">{pct === null ? empty : `${pct}%`}</span>
    </div>
  )
}
