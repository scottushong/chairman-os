import Link from 'next/link'

import { CITY_ASPECT, citySrc, citySrcSet, type CityItem, type CityPhase } from '@/lib/city'
import { formatEok } from '@/lib/format'

/**
 * 전경 한 장 + 핫스팟. /group이 쓴다(HOME 띠는 city-strip.tsx가 같은 조각을 잘라 쓴다).
 *
 * **좌표는 그림에 대한 %다.** 그림 상자를 원본 비율(2752×1536)로 고정하고 그 안에 핫스팟을
 * %로 올린다 — 폭이 바뀌어도 건물 위에 그대로 선다.
 *
 * next/image를 쓰지 않는다. 폭 셋(1280/1920/2752)을 scripts/city-assets.mjs가 이미 webp로
 * 만들어 두었고, next/image는 그것을 한 번 더 인코딩한다 — srcset으로 그대로 고르게 한다.
 */
export function CityMap({
  phase,
  items,
  selectedId,
  focusHref,
  sizes = '(min-width: 1024px) 70vw, 100vw',
}: {
  phase: CityPhase
  items: CityItem[]
  /** 지금 패널에 열린 줄(city_layout.id). */
  selectedId?: number | null
  /** 핫스팟을 누르면 갈 주소. layout.id를 받는다. */
  focusHref: (layoutId: number) => string
  sizes?: string
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-glass" style={{ aspectRatio: `${1 / CITY_ASPECT}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 폭 셋을 미리 만들어 두었다(머리 주석). */}
      <img
        src={citySrc(phase)}
        srcSet={citySrcSet(phase)}
        sizes={sizes}
        alt={phase === 'day' ? '그룹 시티 전경 — 낮' : '그룹 시티 전경 — 저녁'}
        className="absolute inset-0 size-full object-cover"
      />
      {items.map((item) => (
        <Hotspot
          key={item.layout.id}
          item={item}
          selected={selectedId === item.layout.id}
          href={focusHref(item.layout.id)}
        />
      ))}
    </div>
  )
}

/** 라벨 한 줄에 들어가는 숫자들. 없는 값은 빼고 말한다 — '0억'·'L—'로 자리를 채우지 않는다. */
export function hotspotFacts(item: CityItem): string[] {
  if (item.kind === 'initiative') return ['이니셔티브 터']
  const facts: string[] = []
  if (item.revenue !== null) facts.push(formatEok(item.revenue))
  if (item.level) facts.push(item.level)
  facts.push(item.completion.pct === null ? '완성도 —' : `${item.completion.pct}%`)
  return facts
}

function Hotspot({ item, selected, href }: { item: CityItem; selected: boolean; href: string }) {
  const { x, y, w, h } = item.layout
  const lot = item.kind === 'initiative'
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={`${item.name} — ${hotspotFacts(item).join(' · ')}`}
      aria-current={selected ? 'true' : undefined}
      className="group absolute"
      style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
    >
      {/* 상자. 평소에는 거의 안 보이고(그림을 가리지 않는다), 가리키거나 고르면 선다. */}
      <span
        className={`absolute inset-0 rounded-lg border-2 transition-colors ${
          selected
            ? 'border-gold bg-gold/10'
            : lot
              ? 'border-dashed border-white/70 group-hover:border-white'
              : 'border-transparent group-hover:border-white/80'
        }`}
      />
      {/* 라벨은 상자 위 가운데. 그림 위에 글자를 바로 놓지 않는다 — 어두운 유리 한 장을 깐다. */}
      <span
        className={`pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-t11 leading-tight text-white shadow-lg backdrop-blur-sm ${
          selected ? 'bg-black/80 ring-1 ring-gold' : 'bg-black/60'
        }`}
      >
        <span className="font-semibold">{item.name}</span>
        <span className="ml-1.5 text-white/80 tnum">{hotspotFacts(item).join(' · ')}</span>
      </span>
    </Link>
  )
}
