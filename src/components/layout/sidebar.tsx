'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

import { Icon } from '@/components/ui/icon'
import { NAV, navHref, type NavItem } from '@/lib/nav'

/**
 * 좌측 네비. 05_Architecture의 모듈 경로를 그대로 화면 메뉴로 편다.
 * Layer 0(관제) → 회사 → Layer 2(기능 시스템) 순서라 스크롤을 내릴수록 아래 계층으로 간다.
 *
 * 메뉴 목록 자체는 lib/nav.ts에 있다. /coming-soon이 같은 목록을 봐야 하기 때문이다 —
 * 아직 없는 화면을 누르면 404 대신 그쪽으로 간다(DEFERRED D-14 선택지 B).
 */
export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /**
   * 지금 이 메뉴에 있는가.
   *
   * 준비 중 메뉴는 전부 /coming-soon 한 주소를 쓴다. 경로만 비교하면 열세 개가 동시에
   * 켜지므로 ?menu= 까지 본다 — 그게 그 화면이 어느 메뉴로 왔는지 아는 유일한 값이다.
   */
  const isActive = (item: NavItem) =>
    item.ready
      ? pathname === item.href
      : pathname === '/coming-soon' && searchParams.get('menu') === item.label

  return (
    <aside className="flex w-[212px] shrink-0 flex-col border-r border-line-soft bg-nav">
      <div className="flex h-14 items-center gap-2 px-4">
        <Icon name="crown" className="size-5 text-gold" filled />
        <span className="text-[15px] font-bold tracking-tight">CHAIRMAN OS</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        {NAV.map((group, i) => (
          <div key={group.title ?? i} className={i > 0 ? 'mt-4' : ''}>
            {group.title ? (
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-muted">
                {group.title.toUpperCase()}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item)
                return (
                  <li key={item.label}>
                    <Link
                      href={navHref(item)}
                      aria-current={active ? 'page' : undefined}
                      className={[
                        'group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
                        active
                          ? 'bg-accent font-semibold text-white'
                          : 'text-ink-dim hover:bg-raised hover:text-ink',
                        // 아직 없는 화면은 글자를 한 단계 죽인다. 눌러도 되지만 같은 무게는 아니다.
                        item.ready || active ? '' : 'opacity-60',
                      ].join(' ')}
                    >
                      <Icon name={item.icon} className="size-[17px] shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="ml-auto rounded bg-ok/15 px-1.5 py-px text-[9px] font-bold text-ok">
                          {item.badge}
                        </span>
                      ) : null}
                      {item.expandable && !item.badge ? (
                        <Icon name="chevron-right" className="ml-auto size-3.5 text-ink-muted" />
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line-soft p-2.5">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-2 text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Icon name="plus" className="size-4" />
          기업(A,B,C) 추가
        </button>
        <label className="mt-2.5 flex cursor-pointer items-center gap-2 px-1 text-[11px] text-ink-muted">
          <span className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-line transition-colors">
            <span className="absolute left-0.5 size-3 rounded-full bg-ink-muted" />
          </span>
          숨김 기업 관리
        </label>
      </div>
    </aside>
  )
}
