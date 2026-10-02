'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { openNavDrawer } from '@/components/layout/nav-drawer'
import { Icon, type IconName } from '@/components/ui/icon'
import { canReadInitiatives, homeHref } from '@/lib/nav'
import type { Role } from '@/types'

/**
 * 폰 · 태블릿 하단 탭 (Phase 9 블록 6 → 모바일 전면 점검 2026-09-28 회장 지시).
 *
 * 다섯 칸 — 홈 · 이니셔티브 · 결정 · 채팅 · 더보기. 더보기는 사이드바 서랍(nav-drawer)을 연다 — 나머지 메뉴는 전부
 * 거기 있다. 1024px 이상에서는 그리지 않는다(사이드바와 아래 시스템 바가 있다).
 * 홈바(iPhone) 자리만큼 아래를 비운다(safe-bottom).
 * «홈»은 회장이면 대시보드(/), 아니면 직원 홈(/me) — 회장이 아니면 /가 /me로 돌아간다.
 * 이니셔티브를 못 읽는 역할(0017 — 회장 · 그룹 CFO 밖)은 그 칸 대신 «업무»(/tasks)다. 빈 화면으로 가는 탭을 두지 않는다.
 */
const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/initiatives', label: '이니셔티브', icon: 'target' },
  { href: '/approvals', label: '결정', icon: 'check-circle' },
  { href: '/chat', label: '채팅', icon: 'message' },
]

const TAB = 'flex min-h-14 flex-col items-center justify-center gap-0.5 text-t10h'

export function MobileTabs({ role }: { role: Role | null | undefined }) {
  const path = usePathname()
  const home = homeHref(role)
  const tabs = TABS.map((t) =>
    t.href === '/'
      ? { ...t, href: home }
      : t.href === '/initiatives' && !canReadInitiatives(role)
        ? { href: '/tasks', label: '업무', icon: 'clipboard' as IconName }
        : t.href === '/approvals' && role !== 'Chairman'
          ? { ...t, label: '결재' } // «결정»은 회장의 말이다(사이드바 «전자결재»와 같은 이유 — lib/nav.ts STAFF_NAV_OVERRIDE).
          : t,
  )
  return (
    <nav aria-label="하단 탭" className="glass-nav safe-bottom grid shrink-0 grid-cols-5 border-t border-line-soft lg:hidden">
      {tabs.map((t) => {
        // 홈은 정확히 그 주소일 때만 — '/me'를 startsWith로 보면 '/meet'까지 켜진다.
        const active = t.href === home ? path === home : path.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`${TAB} ${active ? 'font-semibold text-ink' : 'text-ink-muted'}`}
          >
            <Icon name={t.icon} className="size-5" />
            {t.label}
          </Link>
        )
      })}
      <button type="button" onClick={openNavDrawer} className={`${TAB} text-ink-muted`}>
        <Icon name="menu" className="size-5" />
        더보기
      </button>
    </nav>
  )
}
