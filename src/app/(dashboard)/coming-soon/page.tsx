import Link from 'next/link'

import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { findNavItem, readyItems } from '@/lib/nav'
import { firstParam } from '@/lib/query'

/**
 * 아직 만들지 않은 메뉴가 도착하는 한 화면 (DEFERRED D-14 선택지 B).
 *
 * 왜 404가 아닌가
 *   404는 '그런 주소는 없다'는 말이다. 그런데 사이드바에 그 메뉴가 버젓이 있으므로,
 *   회장이 읽는 말은 '고장났다'가 된다. 열세 개 메뉴가 전부 그렇게 보이면
 *   서 있는 다섯 화면까지 못 믿게 된다.
 *
 * 왜 메뉴를 지우지 않는가
 *   05_Architecture의 모듈 경로를 화면 구조로 그대로 두기로 했다. 메뉴가 있어야
 *   Chairman OS가 최종적으로 무엇을 덮는지 보인다. 지우면 전체 그림이 사라진다.
 *
 * 이 화면이 하는 일은 셋이다.
 *   1) 고장이 아니라 아직 안 만든 것임을 말한다
 *   2) 무엇을 기다리고 있는지 말한다(대개 Phase 2의 ECOUNT·MES·미래소프트 연동)
 *   3) 지금 쓸 수 있는 화면으로 되돌려 보낸다 — 막다른 길로 두지 않는다
 */
export default async function ComingSoonPage(props: PageProps<'/coming-soon'>) {
  const params = await props.searchParams
  const label = firstParam(params.menu) ?? ''
  const item = findNavItem(label)
  const ready = readyItems()

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon={item?.icon ?? 'layers'}
        title={item?.label ?? '준비 중'}
        code="Phase 2"
        description="이 메뉴는 아직 화면이 없습니다. 고장이 아니라 아직 만들지 않은 것입니다."
      >
        <Link
          href="/"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          대시보드로
        </Link>
      </PageHeader>

      <div className="mt-4 grid grid-cols-12 gap-3.5 pb-6">
        <section className="col-span-12 rounded-xl border border-line-soft bg-panel p-5 xl:col-span-7">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <Icon name="clock" className="size-4 text-ink-dim" />
            무엇을 기다리고 있나
          </p>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-dim">
            {item?.waitingFor ??
              // 사이드바에 없는 라벨로 들어온 경우. 손으로 주소를 친 것이거나 목록이 바뀐 것이다.
              '사이드바에 없는 메뉴입니다. 주소를 직접 입력하셨다면 왼쪽 메뉴에서 다시 골라 주세요.'}
          </p>

          {item ? (
            <p className="mt-4 rounded-lg bg-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-muted">
              계획된 주소는 <span className="text-ink-dim tnum">{item.href}</span> 입니다.
              메뉴를 지우지 않은 것은 05_Architecture의 모듈 경로를 화면 구조로 그대로 두기로
              했기 때문입니다 — 메뉴가 있어야 Chairman OS가 최종적으로 무엇을 덮는지 보입니다.
            </p>
          ) : null}
        </section>

        <section className="col-span-12 rounded-xl border border-line-soft bg-panel p-5 xl:col-span-5">
          <p className="text-[13px] font-semibold">지금 쓸 수 있는 화면</p>
          <ul className="mt-2.5 space-y-1">
            {ready.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] text-ink-dim transition-colors hover:bg-raised hover:text-ink"
                >
                  <Icon name={r.icon} className="size-4 shrink-0 text-ink-muted" />
                  {r.label}
                  <Icon name="chevron-right" className="ml-auto size-3.5 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
