'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { signOut } from '@/app/actions/auth'
import { Icon } from '@/components/ui/icon'
import { NAV } from '@/lib/nav'
import { ROLE_LABEL_KO, type SessionUser } from '@/types'

/**
 * 아침 루틴 셸의 76px 아이콘 레일. (dashboard)의 212px Sidebar가 하던 자리를 대신한다.
 *
 * 목록은 같은 lib/nav.ts를 본다. 다른 점은 **ready 항목만 그린다**는 것이다 —
 * 아이콘만 남은 레일에서 '준비 중'은 눌러야만 알 수 있는 상태가 되고,
 * 그건 아침에 회장이 잘못 누르는 칸을 열세 개 만드는 것과 같다.
 * 그룹 구분선도 지운다. 라벨 없는 세로줄에서 소제목은 그릴 자리가 없고,
 * 계층은 (dashboard) 사이드바가 이미 보여 준다.
 *
 * **아이콘 하나에 title과 aria-label을 둘 다 단다.** title은 눈으로 보는 사람이 hover로
 * 확인하는 이름이고, aria-label은 스크린 리더가 읽는 이름이다. 아이콘만 있는 내비게이션은
 * 둘 중 하나만 있으면 한쪽 사용자에게는 이름 없는 그림이 된다.
 */
export function RailSidebar({ user }: { user: SessionUser | null }) {
  const pathname = usePathname()

  // ready만 남긴다. 그러면 href가 곧 실제 주소라 navHref()를 거칠 일이 없다.
  const items = NAV.flatMap((g) => g.items).filter((i) => i.ready)

  return (
    // glass-nav = --color-nav 면 + backdrop-blur. 다크에서는 같은 이름이 흰색 4%로 뒤집힌다.
    // 셸에는 그림자를 주지 않는다 — 고정된 틀이 떠 보이면 그 위의 카드가 뜨지 못한다.
    <aside className="glass-nav flex w-[76px] shrink-0 flex-col items-center border-r border-line-soft">
      {/* 워드마크 자리. 76px에는 글자가 안 들어가 왕관만 남긴다.
          누를 수 없는 것은 (dashboard) 사이드바와 같다 — 대시보드로 가는 Link는 별도 Task다. */}
      <div className="flex h-14 w-full items-center justify-center border-b border-line-soft">
        <Icon name="crown" className="size-5 text-gold" filled />
      </div>

      <nav aria-label="주요 메뉴" className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-1">
          {items.map((item) => {
            const active = pathname === item.href
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex size-11 items-center justify-center rounded-xl transition-colors',
                    // 활성 표시는 흰 필이다((dashboard) 사이드바와 같은 규칙 — 골드는 상태가 아니다).
                    // 다만 글자색은 text-ink가 아니라 text-app이다: 다크에서 --color-ink는
                    // 흰색에 가까운 #e9e6f2라 흰 필 위에 올리면 아이콘이 사라진다.
                    // --color-app(#0c1224)이 이 트리에서 '가장 어두운 면'이라 흰 필 위의 잉크가 된다.
                    active
                      ? 'bg-white/90 text-app shadow-sm'
                      : 'text-ink-dim hover:bg-raised hover:text-ink',
                  ].join(' ')}
                >
                  <Icon name={item.icon} className="size-[19px]" />
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="flex w-full flex-col items-center gap-1.5 border-t border-line-soft py-3">
        {user ? (
          // 이름은 첫 글자만 남는다. 전체 이름과 직함은 title로 붙여 둔다 —
          // 레일에는 글자가 들어갈 폭이 없고, 어느 계정으로 보고 있는지는 알 수 있어야 한다.
          <span
            title={`${user.name} · ${user.title_ko || ROLE_LABEL_KO[user.role]}`}
            className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-ink"
          >
            {user.name.slice(0, 1)}
          </span>
        ) : null}

        {/* 로그아웃은 Server Action이다. 쿠키를 지우는 건 서버만 할 수 있다.
            이 화면에 헤더가 없어 여기가 이 셸에서 계정을 놓는 유일한 자리다. */}
        <form action={signOut}>
          <button
            type="submit"
            aria-label="로그아웃"
            title="로그아웃"
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <Icon name="log-out" className="size-[17px]" />
          </button>
        </form>
      </div>
    </aside>
  )
}
