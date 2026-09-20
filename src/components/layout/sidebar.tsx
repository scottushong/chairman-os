'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveGroupCollapsed } from '@/app/actions/ui-prefs'
import { Icon } from '@/components/ui/icon'
import { NAV, navHref, type NavItem } from '@/lib/nav'
import { isCollapsed, isHidden, type SidebarPrefs } from '@/lib/ui-prefs'
import { ROLE_LABEL_KO, type SessionUser } from '@/types'

/**
 * 좌측 네비. 05_Architecture의 모듈 경로를 그대로 화면 메뉴로 편다.
 * Layer 0(관제) → 회사 → Layer 2(기능 시스템) 순서라 스크롤을 내릴수록 아래 계층으로 간다.
 *
 * 메뉴 목록 자체는 lib/nav.ts에 있다. /coming-soon이 같은 목록을 봐야 하기 때문이다 —
 * 아직 없는 화면을 누르면 404 대신 그쪽으로 간다(DEFERRED D-14 선택지 B).
 *
 * user는 (dashboard)/layout.tsx가 이미 읽어 둔 세션이다. 여기서 다시 묻지 않는다 —
 * 이 컴포넌트는 클라이언트라 물으려면 왕복이 하나 더 생기고, 그 값은 이미 서버에 있다.
 *
 * ■ 접기·숨김은 **항목 목록과 분리된 메커니즘**이다 (Phase 5-E 3절) ■
 *
 * prefs가 들고 있는 것은 키의 목록뿐이다 — 라벨도, 순서도, 항목의 모양도 아니다.
 * 곧 올 Phase 7 블록 E가 이 사이드바를 10개 항목으로 통째로 갈아 끼우는데, 그때
 * 이 파일이 하는 일은 `isHidden(item, prefs)` 한 줄로 그대로다. 모르는 키는
 * 아무 항목과도 맞지 않아 조용히 무시되고, 새 항목은 키가 목록에 없으니 그냥 보인다.
 * 판정 규칙은 lib/ui-prefs.ts 한 곳에만 있다 — 여기에 복사하면 두 벌이 된다.
 */
export function Sidebar({ user, prefs }: { user: SessionUser | null; prefs: SidebarPrefs }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [, startTransition] = useTransition()

  /**
   * 접힘은 서버(user_settings)에 있지만 화면은 기다리지 않는다.
   * 왕복을 기다렸다 접으면 메뉴 제목을 눌렀을 때 한 박자 늦게 움직여 '안 눌렸나'로 읽힌다.
   * 대시보드의 핀·숨김이 같은 방식이다(dashboard-board.tsx persist).
   */
  const [collapsed, setCollapsed] = useState<string[]>(prefs.collapsed_groups)

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

  const toggleGroup = (key: string) => {
    const next = !collapsed.includes(key)
    setCollapsed((c) => (next ? [...c, key] : c.filter((k) => k !== key)))
    startTransition(async () => {
      const result = await saveGroupCollapsed(key, next)
      // 못 저장했으면 화면도 되돌린다. 접힌 채로 보이는데 저장이 안 된 상태가 제일 나쁘다.
      if (result.error) {
        setCollapsed((c) => (next ? c.filter((k) => k !== key) : [...c, key]))
        return
      }
      router.refresh()
    })
  }

  return (
    // glass-nav = --color-nav 면 + backdrop-blur. 셸은 배경 그라데이션 위에 얹힌 유리 틀이고,
    // 그림자는 주지 않는다 — 고정된 틀이 떠 보이면 그 위의 카드가 뜨지 못한다.
    <aside className="glass-nav flex w-[212px] shrink-0 flex-col border-r border-line-soft">
      {/* 워드마크. 대시보드로 간다. 높이 14는 헤더와 같아야 한다. 다르면 셸 두 장의 아랫선이 어긋난다. */}
      <Link
        href="/"
        className="flex h-14 items-center gap-2 border-b border-line-soft px-4 rounded-md transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-accent"
      >
        <Icon name="crown" className="size-5 text-gold" filled />
        <span className="text-[15px] font-bold tracking-[0.04em] text-ink">CHAIRMAN OS</span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        {NAV.map((group, i) => {
          // 숨긴 항목은 아예 그리지 않는다. 회색으로 죽여 두면 '숨김'이 아니라 '고장'으로 읽힌다.
          // 지금 보고 있는 화면의 메뉴는 숨겨도 남는다 — 길을 잃지 않게(isHidden의 active).
          const items = group.items.filter(
            (item) => !isHidden(item, { ...prefs, collapsed_groups: collapsed }, isActive(item)),
          )
          if (items.length === 0) return null

          const groupKey = group.key ?? null
          const folded = isCollapsed(groupKey, { ...prefs, collapsed_groups: collapsed })

          return (
            <div key={group.title ?? i} className={i > 0 ? 'mt-4' : ''}>
              {group.title && groupKey ? (
                /* 제목이 곧 손잡이다. 접기 화살표를 따로 두면 제목을 눌렀을 때 아무 일도
                   안 나는 자리가 하나 더 생긴다 — 그것이 죽은 버튼이 태어나는 방식이다. */
                <button
                  type="button"
                  onClick={() => toggleGroup(groupKey)}
                  aria-expanded={!folded}
                  className="flex w-full items-center gap-1 rounded px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-muted transition-colors hover:text-ink-dim"
                >
                  <Icon
                    name="chevron-down"
                    className={`size-3 shrink-0 transition-transform ${folded ? '-rotate-90' : ''}`}
                  />
                  <span>{group.title.toUpperCase()}</span>
                  {folded ? (
                    <span className="ml-auto text-[9px] font-normal tnum">{items.length}</span>
                  ) : null}
                </button>
              ) : group.title ? (
                <p className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-muted">
                  {group.title.toUpperCase()}
                </p>
              ) : null}

              {folded ? null : (
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active = isActive(item)
                    return (
                      <li key={item.key}>
                        <Link
                          href={navHref(item)}
                          aria-current={active ? 'page' : undefined}
                          className={[
                            'group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
                            // 활성 메뉴는 골드 필이 아니라 흰 필이다. 라이트 글래스에서는
                            // 유리가 한 겹 더 두꺼워진 것이 곧 '여기 있다'로 읽히고,
                            // 골드 배경 위 흰 글자(2.23:1)를 보정하던 문제도 같이 사라진다.
                            active
                              ? 'bg-white/80 font-semibold text-ink shadow-sm'
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
              )}
            </div>
          )
        })}
      </nav>

      {/*
       * Phase 5-E 1절에서 이 칸의 죽은 둘을 걷어냈다.
       *
       *   '기업(A,B,C) 추가'  onClick 없는 <button>이었다. 진짜 추가 버튼은 대시보드
       *                        회사 카드 줄 끝에 이미 있고(dashboard-board.tsx의 '기업 추가'),
       *                        거기서만 AddBusinessModal이 열린다.
       *   '숨김 기업 관리'      <input>이 없는 가짜 토글이었다. 숨김 관리는 대시보드의
       *                        '숨김 N개 (데이터는 그대로 있습니다)' 줄이 실제로 하고 있다.
       *
       * 그 자리에 '메뉴 설정'이 섰다 — 이 사이드바에서 무엇을 감출지 고르는 화면이다.
       */}
      <div className="border-t border-line-soft p-2.5">
        <ProfileBlock user={user} />
        <Link
          href="/settings/sidebar"
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-2 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Icon name="settings" className="size-3.5" />
          메뉴 설정
        </Link>
      </div>
    </aside>
  )
}

/**
 * 사이드바 하단 프로필.
 *
 * 헤더에도 이름이 있지만 자리가 다르다. 헤더의 것은 '지금 어느 계정으로 보고 있나'라
 * 로그아웃과 붙어 있고, 여기 것은 '이 화면의 주인이 누구인가'다 — 그래서 직함을 같이 둔다.
 *
 * 영문 줄은 display_name_en이 있을 때만 그린다. 없으면 아예 없다.
 * 한글 이름을 로마자로 음차하지 않는다 — 본인이 쓰는 철자가 유일한 정답이라는 것이 0017의 판단이고,
 * 화면이 그 판단을 뒤집어 'Hong Seok-hyun' 같은 값을 만들어 내면 대외 문서로 새어 나간다.
 */
function ProfileBlock({ user }: { user: SessionUser | null }) {
  if (!user) return null

  const title = user.title_ko || ROLE_LABEL_KO[user.role]
  const en = user.display_name_en?.trim()

  return (
    <Link
      href="/settings/profile"
      className="mb-2.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-raised"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-ink">
        {user.name.slice(0, 1)}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12.5px] font-semibold text-ink">{user.name}</span>
        <span className="block truncate text-[10.5px] text-ink-muted">
          {en ? `${title} · ${en}` : title}
        </span>
      </span>
    </Link>
  )
}
