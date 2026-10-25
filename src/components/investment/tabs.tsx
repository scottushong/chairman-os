'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { investmentMenu, menuActive } from '@/lib/investment/menu'

/** 화면 위 하위 메뉴 탭 — 폰에서 사이드바를 열지 않아도 옮겨 다닌다(옆으로 민다). */
export function InvestmentTabs() {
  const pathname = usePathname()
  return (
    <nav aria-label="Investment Intelligence 메뉴" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line-soft">
        {investmentMenu().map((m) => {
          const active = menuActive(pathname, m)
          return (
            <li key={m.key}>
              <Link
                href={m.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-[14px] whitespace-nowrap transition-colors ${active ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
              >
                {m.no ? `${m.no}. ` : ''}
                {m.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
