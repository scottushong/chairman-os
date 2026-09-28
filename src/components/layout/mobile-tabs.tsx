'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Icon, type IconName } from '@/components/ui/icon'

/**
 * 폰 하단 탭 (Phase 9 블록 6 — 원문 "폰 하단 탭에 «채팅» 추가").
 *
 * 이 저장소에 폰 하단 탭이 아직 없었다(Phase 6 /me의 탭은 명세뿐). 그래서 탭 막대를 새로 세우고
 * 넷만 둔다 — 홈 · 그룹웨어 · 결재 · 채팅. 폰에서 매일 여는 것만. 나머지는 사이드바(햄버거)에 있다.
 * md 이상에서는 그리지 않는다 — 넓은 화면에는 사이드바와 아래 시스템 바가 이미 있다.
 */
const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/groupware', label: '그룹웨어', icon: 'layers' },
  { href: '/approvals', label: '결재', icon: 'stamp' },
  { href: '/chat', label: '채팅', icon: 'message' },
]

export function MobileTabs() {
  const path = usePathname()
  return (
    <nav aria-label="하단 탭" className="glass-nav grid h-14 shrink-0 grid-cols-4 border-t border-line-soft md:hidden">
      {TABS.map((t) => {
        const active = t.href === '/' ? path === '/' : path.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10.5px] ${active ? 'font-semibold text-ink' : 'text-ink-muted'}`}
          >
            <Icon name={t.icon} className="size-5" />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
