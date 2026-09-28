import Link from 'next/link'

import { hotspotFacts } from '@/components/city/city-map'
import { CityLiveOverlay } from '@/components/city/city-live-overlay'
import { CITY_ASPECT, citySrc, citySrcSet, imageOf, type CityItem } from '@/lib/city'
import type { CityLive, CitySky } from '@/lib/city-live'

/**
 * HOME 도시 띠 — 전경을 560px 높이로 잘라 회사 핫스팟과 살아 있는 레이어를 올린다
 * (Phase 8 G-1 · G-2b에서 260 → 560px, 브리핑 바로 아래 2줄로 올라왔다).
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
const STRIP = 560

/**
 * 폰(768px 미만)은 **폭 기준 4:3** 창이다. 그림 상자는 창 높이에 맞춰(원본 비율 그대로) 창보다 넓어지고,
 * 회사들의 가로 가운데가 창 가운데에 오게 옆으로 민다 — object-cover로 자르면 %로 둔 사람 · 핫스팟이
 * 건물에서 떨어진다(위 머리 주석과 같은 이유). 4:3 창 높이 = 폭 × 0.75라 그림 폭 = 0.75 ÷ CITY_ASPECT배.
 */
const PHONE_WIDE = 0.75 / CITY_ASPECT

export function CityStrip({
  sky,
  items,
  live,
  flow,
}: {
  sky: CitySky
  items: CityItem[]
  /** 서버가 접은 첫 장. 이후는 레이어가 1분마다 스스로 읽는다. */
  live: CityLive
  /** 강물 · 구름 흐름(설정 city_motion). */
  flow: boolean
}) {
  const phase = imageOf(sky)
  const companies = items.filter((i) => i.kind === 'business')
  const xs = companies.map((i) => i.layout.x + i.layout.w / 2)
  const cx = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : 50
  const phoneLeft = `clamp(${(1 - PHONE_WIDE) * 100}%, calc(50% - ${PHONE_WIDE * cx}%), 0%)`
  const centers = companies.map((i) => i.layout.y + i.layout.h / 2)
  const cy = centers.length > 0 ? (Math.min(...centers) + Math.max(...centers)) / 2 : 50
  const imageH = `(100cqw * ${CITY_ASPECT})`
  // top = 창 가운데(130px) - 그림 높이 × cy%. 0보다 크면 위가 비고, 260 - 그림 높이보다 작으면 아래가 빈다.
  const top = `clamp(calc(${STRIP}px - ${imageH}), calc(${STRIP / 2}px - ${imageH} * ${cy / 100}), 0px)`

  return (
    <section aria-label="그룹 시티">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-t13 font-semibold">그룹 시티</h2>
        <span className="text-t11 text-ink-dim tnum">회사 {companies.length}곳</span>
        <Link
          href="/group"
          className="ml-auto text-t11h text-ink-dim underline-offset-2 hover:text-ink hover:underline"
        >
          전체 보기 →
        </Link>
      </div>

      {/* 폰(768px 미만)은 폭 기준 4:3 창(PHONE_WIDE). 폰에는 그림 위 라벨이 없다 — 아래 줄이 대신 말한다. */}
      <div
        className="relative overflow-hidden rounded-glass max-md:h-auto! max-md:aspect-[4/3]"
        style={{ height: STRIP, containerType: 'inline-size' }}
      >
        <div
          className="absolute inset-x-0 max-md:top-0! max-md:h-full! max-md:right-auto! max-md:left-(--phone-left)! max-md:w-(--phone-w)!"
          style={
            {
              top,
              height: `calc${imageH}`,
              '--phone-left': phoneLeft,
              '--phone-w': `${PHONE_WIDE * 100}%`,
            } as React.CSSProperties
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 폭 셋을 미리 만들어 두었다(city-map.tsx). */}
          <img
            src={citySrc(phase)}
            srcSet={citySrcSet(phase)}
            sizes="100vw"
            alt={phase === 'day' ? '그룹 시티 전경 — 낮' : '그룹 시티 전경 — 저녁'}
            className="absolute inset-0 size-full object-cover"
          />
          <CityLiveOverlay initial={{ items, live }} sky={sky} flow={flow} />
        </div>
        {companies.map((item) => {
          const cx = item.layout.x + item.layout.w / 2
          const cyItem = (item.layout.y + item.layout.h / 2) / 100
          return (
            <Link
              key={item.layout.id}
              href={`/group?focus=${item.layout.id}`}
              aria-label={`${item.name} — ${hotspotFacts(item).join(' · ')}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/60 max-md:hidden px-2 py-1 text-t11 leading-tight text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/80"
              style={{
                left: `clamp(64px, ${cx}%, calc(100% - 64px))`,
                // 건물의 세로 가운데. 창 밖이면 띠의 위·아래 끝에 붙인다 — 가로는 건물 그대로라
                // 라벨이 «이 방향 위(아래)에 있다»를 말한다.
                top: `clamp(18px, calc(${top} + ${imageH} * ${cyItem}), ${STRIP - 18}px)`,
                zIndex: 2,
              }}
            >
              <span className="font-semibold">{item.name}</span>
              <span className="ml-1.5 text-white/80 tnum">{hotspotFacts(item).join(' · ')}</span>
            </Link>
          )
        })}
      </div>

      {/*
       * 폰(768px 미만)은 그림 위 라벨을 빼고 이 줄로 대신한다. 360px 띠에 여섯 라벨을 얹으면
       * 서로 겹치고 화면 밖으로 잘려 이름도 숫자도 읽히지 않았다. 그림은 풍경으로만 두고,
       * 누를 것은 그림 아래 옆으로 미는 한 줄에 모은다.
       */}
      {companies.length > 0 ? (
        <div className="m-tabs mt-2 flex gap-1.5 md:hidden">
          {companies.map((item) => (
            <Link
              key={item.layout.id}
              href={`/group?focus=${item.layout.id}`}
              className="flex items-center rounded-lg border border-line-soft bg-panel px-3 text-t12 text-ink-dim transition-colors hover:text-ink"
            >
              <span className="font-semibold text-ink">{item.name}</span>
              <span className="ml-1.5 tnum">{hotspotFacts(item).join(' · ')}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {companies.length === 0 ? (
        <p className="mt-1.5 text-t11 text-ink-dim">도시에 아직 배치된 회사가 없습니다. 그룹 화면에서 배치합니다.</p>
      ) : null}
    </section>
  )
}
