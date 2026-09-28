import Link from 'next/link'

import { hotspotFacts } from '@/components/city/city-map'
import { CITY_ASPECT, citySrc, citySrcSet, type CityItem, type CityPhase } from '@/lib/city'

/**
 * HOME 도시 띠 — 전경을 260px 높이로 잘라 회사 핫스팟만 올린다 (Phase 8 G-1).
 *
 * **object-cover로 자르지 않는다.** 그러면 폭마다 잘리는 자리가 달라져 %로 둔 핫스팟이
 * 건물에서 떨어진다. 대신 그림 상자를 원본 비율 그대로(폭 100%) 두고, 띠(260px)를 창으로 삼아
 * **그 상자를 위아래로 민다.** 핫스팟은 그림 상자 안에 %로 있으므로 그림과 같이 움직인다.
 *
 * 창의 가운데는 핫스팟들의 세로 가운데다. 그림 끝을 넘어 빈 칸이 보이지 않게 clamp로 가둔다
 * — 그림 높이는 폭 × 1536/2752이고, CSS 컨테이너 폭 단위(cqw)로 적는다.
 *
 * **라벨은 그림 상자 밖(띠 좌표)에 둔다.** 넓은 화면에서는 창이 그림의 30% 남짓만 보여서
 * 그림 안에 두면 다섯 중 둘만 남았다(실화면에서 그랬다). 가로는 건물의 가운데 그대로, 세로는
 * 건물의 가운데를 띠 안으로 가둔다 — 창 밖 건물의 라벨은 위·아래 끝에 붙어 «이쪽에 있다»를 말한다.
 */
const STRIP = 260

export function CityStrip({ phase, items }: { phase: CityPhase; items: CityItem[] }) {
  const companies = items.filter((i) => i.kind === 'business')
  const centers = companies.map((i) => i.layout.y + i.layout.h / 2)
  const cy = centers.length > 0 ? (Math.min(...centers) + Math.max(...centers)) / 2 : 50
  const imageH = `(100cqw * ${CITY_ASPECT})`
  // top = 창 가운데(130px) - 그림 높이 × cy%. 0보다 크면 위가 비고, 260 - 그림 높이보다 작으면 아래가 빈다.
  const top = `clamp(calc(${STRIP}px - ${imageH}), calc(${STRIP / 2}px - ${imageH} * ${cy / 100}), 0px)`

  return (
    <section aria-label="그룹 시티">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold">그룹 시티</h2>
        <span className="text-[11px] text-ink-dim tnum">회사 {companies.length}곳</span>
        <Link
          href="/group"
          className="ml-auto text-[11.5px] text-ink-dim underline-offset-2 hover:text-ink hover:underline"
        >
          전체 보기 →
        </Link>
      </div>

      <div className="relative overflow-hidden rounded-glass" style={{ height: STRIP, containerType: 'inline-size' }}>
        <div className="absolute inset-x-0" style={{ top, height: `calc${imageH}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 폭 셋을 미리 만들어 두었다(city-map.tsx). */}
          <img
            src={citySrc(phase)}
            srcSet={citySrcSet(phase)}
            sizes="100vw"
            alt={phase === 'day' ? '그룹 시티 전경 — 낮' : '그룹 시티 전경 — 저녁'}
            className="absolute inset-0 size-full object-cover"
          />
        </div>
        {companies.map((item) => {
          const cx = item.layout.x + item.layout.w / 2
          const cyItem = (item.layout.y + item.layout.h / 2) / 100
          return (
            <Link
              key={item.layout.id}
              href={`/group?focus=${item.layout.id}`}
              aria-label={`${item.name} — ${hotspotFacts(item).join(' · ')}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/60 px-2 py-1 text-[11px] leading-tight text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/80"
              style={{
                left: `clamp(64px, ${cx}%, calc(100% - 64px))`,
                // 건물의 세로 가운데. 창 밖이면 띠의 위·아래 끝에 붙인다 — 가로는 건물 그대로라
                // 라벨이 «이 방향 위(아래)에 있다»를 말한다.
                top: `clamp(18px, calc(${top} + ${imageH} * ${cyItem}), ${STRIP - 18}px)`,
              }}
            >
              <span className="font-semibold">{item.name}</span>
              <span className="ml-1.5 text-white/80 tnum">{hotspotFacts(item).join(' · ')}</span>
            </Link>
          )
        })}
      </div>

      {companies.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-ink-dim">도시에 아직 배치된 회사가 없습니다. 그룹 화면에서 배치합니다.</p>
      ) : null}
    </section>
  )
}
