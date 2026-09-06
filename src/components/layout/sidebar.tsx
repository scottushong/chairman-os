'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Icon, type IconName } from '@/components/ui/icon'

/**
 * 좌측 네비. 05_Architecture의 모듈 경로를 그대로 화면 메뉴로 편다.
 * Layer 0(관제) → 회사 → Layer 2(기능 시스템) 순서라 스크롤을 내릴수록 아래 계층으로 간다.
 */

interface NavItem {
  label: string
  href: string
  icon: IconName
  badge?: string
  /** 하위 화면이 더 있는 항목. 지금은 표식만 두고 펼침은 다음 단계다. */
  expandable?: boolean
}

interface NavGroup {
  title?: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    items: [
      { label: '대시보드', href: '/', icon: 'home' },
      { label: '그룹 전체 현황', href: '/group', icon: 'layers' },
      // CH-041 전자결재. 라벨은 시안 그대로 두고 대상만 실제 화면으로 잇는다 —
      // 그 화면이 곧 대시보드 '내 결정 사항' 패널의 전체 화면 버전이다.
      { label: '내 결정 사항', href: '/approvals', icon: 'check-circle' },
      { label: 'AI 인사이트', href: '/ai', icon: 'sparkles', badge: 'NEW' },
      { label: '캘린더', href: '/calendar', icon: 'calendar' },
      { label: '업무 관리', href: '/tasks', icon: 'clipboard' },
      { label: '프로젝트', href: '/projects', icon: 'folder' },
      { label: '기업 관리 (A,B,C)', href: '/businesses', icon: 'building', expandable: true },
    ],
  },
  {
    title: '기능 시스템',
    items: [
      { label: '재무 / 회계', href: '/finance', icon: 'coin' },
      { label: '인사 / 조직', href: '/hr', icon: 'users' },
      { label: '문서 / 지식', href: '/documents', icon: 'book' },
      { label: '영업 / CRM', href: '/crm', icon: 'target' },
      { label: '구매 / SCM', href: '/scm', icon: 'cart' },
      { label: '생산 / MES', href: '/mes', icon: 'factory' },
      { label: '연구 / R&D', href: '/rnd', icon: 'flask' },
      { label: '자산 / 설비', href: '/assets', icon: 'server' },
      { label: '리스크 / 컴플라이언스', href: '/risk', icon: 'shield' },
    ],
  },
  {
    items: [{ label: '설정', href: '/settings', icon: 'settings', expandable: true }],
  },
]

export function Sidebar() {
  const pathname = usePathname()

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
                const active = pathname === item.href
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={[
                        'group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
                        active
                          ? 'bg-accent font-semibold text-white'
                          : 'text-ink-dim hover:bg-raised hover:text-ink',
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
