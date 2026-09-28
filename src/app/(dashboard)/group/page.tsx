import Link from 'next/link'

import { CityHotspotList, CityMap } from '@/components/city/city-map'
import { CityPanel } from '@/components/city/city-panel'
import { CityScroller } from '@/components/city/city-scroller'
import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { cityPhase } from '@/lib/city-phase'
import { loadCity } from '@/lib/city-load'
import { getRepository } from '@/lib/repository'

/**
 * `/group` — 그룹 시티 (Phase 8 G-1).
 *
 * 전경 한 장(현지 시각으로 낮/저녁) 위에 회사와 이니셔티브 터를 핫스팟으로 올린다.
 * 핫스팟을 누르면 우측 패널에 클로즈업 · 요약 · 상세 링크.
 *
 * **고른 줄은 주소(?focus=)에 싣는다.** 클라이언트 상태로 두면 패널을 서버가 못 그리고,
 * 새로고침하거나 링크를 보내면 고른 것이 사라진다. 서버가 그대로 그리므로 이 화면에는
 * 'use client'가 한 줄도 없다.
 *
 * 배치가 없는 회사는 지도 아래에 따로 적는다. 조용히 빼면 «도시에 없는 회사»가 «없는 회사»로
 * 읽힌다.
 */
export default async function GroupPage({ searchParams }: PageProps<'/group'>) {
  await recordScreenRead({ path: '/group', kind: 'page' })

  const params = await searchParams
  const rawFocus = Array.isArray(params.focus) ? params.focus[0] : params.focus
  const focus = Number(rawFocus)

  const repo = await getRepository()
  const [user, phase, city] = await Promise.all([currentUser(), cityPhase(), loadCity(repo)])
  const { items, businesses } = city

  const selected = items.find((i) => i.layout.id === focus) ?? null
  const placed = new Set(items.filter((i) => i.kind === 'business').map((i) => i.id))
  const unplaced = businesses.filter((b) => b.visible && !placed.has(b.business_id))

  // 폰에서 그림을 옆으로 밀 때 처음 창 자리(그림 폭의 %). 고른 건물이 있으면 그 건물, 없으면 회사들의 가운데.
  const centerOf = (i: (typeof items)[number]) => i.layout.x + i.layout.w / 2
  const companyCenters = items.filter((i) => i.kind === 'business').map(centerOf)
  const focusX = selected
    ? centerOf(selected)
    : companyCenters.length > 0
      ? (Math.min(...companyCenters) + Math.max(...companyCenters)) / 2
      : 50

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="layers"
        title="그룹"
        code="Phase 8 · Group City"
        description="회사는 건물로, 준비 중인 일은 빈 터로 섭니다. 건물은 완성도(자율성 · 매출 목표 · 이양률)만큼 올라갑니다."
      >
        {/* 배치 편집은 끌어서 옮기는 일이라 PC 전용이다(1024px 미만은 편집 화면이 안내만 한다) — 폰에서는 단추를 빼 둔다. */}
        {user?.role === 'Chairman' ? (
          <Link
            href="/group/edit"
            className="flex items-center gap-1.5 max-lg:hidden rounded-lg border border-line bg-raised px-3 py-1.5 text-t12 font-semibold transition-colors hover:border-accent"
          >
            <Icon name="pencil" className="size-3.5" />
            배치 편집
          </Link>
        ) : null}
      </PageHeader>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <CityScroller focusX={focusX}>
            <CityMap
              phase={phase}
              items={items}
              selectedId={selected?.layout.id ?? null}
              focusHref={(id) => `/group?focus=${id}`}
              sizes="(min-width: 1024px) 70vw, (min-width: 768px) 100vw, 200vw"
            />
          </CityScroller>
          {/* 폰 전용. 그림 위 라벨 대신 이 목록이 이름과 숫자를 말한다(city-map.tsx CityHotspotList). */}
          <p className="mt-1.5 text-t11 text-ink-dim md:hidden">그림은 옆으로 밀어 볼 수 있습니다.</p>
          <CityHotspotList
            items={items}
            selectedId={selected?.layout.id ?? null}
            focusHref={(id) => `/group?focus=${id}`}
            className="mt-2 md:hidden"
          />
          {unplaced.length > 0 ? (
            <p className="mt-2 rounded-lg border border-line-soft bg-raised px-3 py-2 text-t11h text-ink-dim">
              도시에 아직 자리가 없는 회사: {unplaced.map((b) => b.name).join(', ')}
              {user?.role === 'Chairman' ? (
                <Link href="/group/edit" className="ml-2 underline underline-offset-2 hover:text-ink max-lg:hidden">
                  배치하기
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>

        {selected ? (
          <CityPanel item={selected} />
        ) : (
          <aside className="glass rounded-glass p-5 text-t12h leading-relaxed text-ink-dim">
            <p className="font-semibold text-ink">건물을 눌러 보세요.</p>
            <p className="mt-1">
              회사를 누르면 클로즈업과 매출 · 자율성 · 완성도가, 빈 터를 누르면 그 이니셔티브가 열립니다.
            </p>
            {/* 폰은 그림 바로 아래 CityHotspotList가 같은 목록이라 여기서는 뺀다.
                태블릿(768~1023)은 이 목록을 쓰되 줄을 flex로 세워 44px 터치 규칙이 먹게 한다(inline 링크에는 min-height가 안 먹는다). */}
            <ul className="mt-3 space-y-1 max-md:hidden">
              {items.map((i) => (
                <li key={i.layout.id}>
                  <Link href={`/group?focus=${i.layout.id}`} scroll={false} className="hover:text-ink hover:underline max-lg:flex max-lg:items-center">
                    {i.name}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  )
}
