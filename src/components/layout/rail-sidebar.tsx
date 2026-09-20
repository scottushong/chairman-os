'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore } from 'react'

import { signOut } from '@/app/actions/auth'
import { Icon } from '@/components/ui/icon'
import { NAV, navHref, readyItems, type NavItem } from '@/lib/nav'
import { ROLE_LABEL_KO, type SessionUser } from '@/types'

/**
 * 아침 루틴 셸의 사이드바. 접으면 76px 아이콘 레일, 펼치면 212px 라벨 메뉴다.
 * 두 치수는 각각 이 셸의 원래 레일과 (dashboard) Sidebar에서 그대로 가져왔다 —
 * 새 숫자를 만들면 두 셸의 아랫선과 본문 폭 계산이 어긋난다.
 *
 * **접힘이 기본이다.** /ai 본문은 2단(560px + 나머지)이고 그 폭이 76px 레일을 전제로 짜였다
 * ((morning)/layout.tsx 주석). 펼침은 회장이 메뉴를 찾을 때 잠깐 쓰는 상태지
 * 아침에 화면을 여는 기본 모습이 아니다.
 *
 * **항목이 상태에 따라 갈린다.**
 *   펼침  NAV 전부(21개). 그룹 제목이 서고, 준비 중은 opacity-60으로 죽인다.
 *          (dashboard) Sidebar와 같은 규칙이다 — 라벨이 있으면 '눌러도 되지만 같은 무게는
 *          아니다'를 글자 농도로 말할 수 있다.
 *   접힘  ready만(8개). 아이콘만 남은 줄에서 '준비 중'은 눌러야만 알 수 있는 상태가 되고,
 *          그건 아침에 회장이 잘못 누르는 칸을 열세 개 만드는 것과 같다.
 *
 * 그래서 이 파일은 (dashboard) Sidebar와 달리 useSearchParams를 쓰지 않는다.
 * 준비 중 항목의 활성 표시는 ?menu=로 가려야 하는데, /coming-soon은 (dashboard) 셸이라
 * 누르는 순간 이 셸을 떠난다 — 여기서 켜질 일이 없는 표시다.
 * 안 쓰면 Suspense 경계도 필요 없어진다.
 *
 * 검색창(GlobalSearch)은 펼친 상태에서도 **일부러 뺐다.** 레일은 아침에 시선을 뺏지
 * 않는 것이 목적이고, 검색은 대시보드로 한 번만 건너가면 있다. 빠뜨린 것이 아니다.
 */

const STORAGE_KEY = 'chairman-os:morning-sidebar-expanded'

/**
 * 접힘/펼침은 React 바깥(localStorage)에 산다. useEffect에서 읽어 setState하는 방식은
 * react-hooks/set-state-in-effect가 막는다(weather-panel.tsx가 같은 규칙에 걸려 본 자리다).
 * useSyncExternalStore는 바로 이런 값을 위한 고리라, 서버 스냅샷과 클라이언트 스냅샷을
 * 따로 주면 하이드레이션 불일치 없이 한 박자 뒤에 실제 값으로 갈아탄다.
 */

/** 저장소가 막혔을 때만 쓰는 이번 세션 값. 평소에는 null이고 localStorage가 정본이다. */
let memoryFallback: boolean | null = null
let listeners: (() => void)[] = []

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void) {
  listeners = [...listeners, onChange]
  // 다른 탭에서 접었다 펴면 이 탭도 따라간다. 회장이 대시보드와 아침 화면을
  // 두 탭에 띄워 두는 것이 이 앱의 정상 사용이다.
  window.addEventListener('storage', onChange)
  return () => {
    listeners = listeners.filter((l) => l !== onChange)
    window.removeEventListener('storage', onChange)
  }
}

function readExpanded(): boolean {
  if (memoryFallback !== null) return memoryFallback
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // 사생활 보호 모드 등으로 막혀 있으면 접힘으로 둔다.
    return false
  }
}

/** 서버에는 저장소가 없다. 첫 그림은 언제나 접힘이고, 그래서 서버와 클라이언트가 같다. */
function readExpandedOnServer(): boolean {
  return false
}

function writeExpanded(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    memoryFallback = null
  } catch {
    // 못 적어도 이번 세션 동안은 펼쳐진 채로 쓸 수 있다. 저장만 안 될 뿐이다 —
    // 메뉴를 접었다 펴는 일로 화면이 잠기면 안 된다.
    memoryFallback = next
  }
  emit()
}

export function RailSidebar({ user }: { user: SessionUser | null }) {
  const pathname = usePathname()
  const expanded = useSyncExternalStore(subscribe, readExpanded, readExpandedOnServer)

  const toggle = () => writeExpanded(!expanded)

  return (
    // glass-nav = --color-nav 면 + backdrop-blur. 다크에서는 같은 이름이 흰색 4%로 뒤집힌다.
    // 셸에는 그림자를 주지 않는다 — 고정된 틀이 떠 보이면 그 위의 카드가 뜨지 못한다.
    <aside
      className={`glass-nav flex shrink-0 flex-col border-r border-line-soft transition-[width] duration-200 ${
        expanded ? 'w-[212px]' : 'w-[76px] items-center'
      }`}
    >
      {/* 워드마크 자리. 76px에는 글자가 안 들어가 왕관만 남긴다. 대시보드로 간다. */}
      <Link
        href="/"
        title="대시보드로"
        aria-label="대시보드로"
        className={`flex h-14 w-full items-center border-b border-line-soft rounded-xl transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-accent ${
          expanded ? 'gap-2 px-4' : 'justify-center'
        }`}
      >
        <Icon name="crown" className="size-5 shrink-0 text-gold" filled />
        {expanded ? (
          <span className="truncate text-[15px] font-bold tracking-[0.04em] text-ink">
            CHAIRMAN OS
          </span>
        ) : null}
      </Link>

      <nav
        aria-label="주요 메뉴"
        className={`flex-1 overflow-y-auto py-3 ${expanded ? 'px-2.5' : ''}`}
      >
        {expanded ? (
          <ExpandedMenu pathname={pathname} />
        ) : (
          <CollapsedMenu pathname={pathname} />
        )}
      </nav>

      <div
        className={`flex w-full flex-col border-t border-line-soft py-3 ${
          expanded ? 'gap-2 px-2.5' : 'items-center gap-1.5'
        }`}
      >
        {/*
         * 접기 버튼. aria-expanded로 상태를 읽히고, title/aria-label은 '누르면 무엇이 되는가'로
         * 적는다 — 스크린 리더에서 '펼치기(접힘)'가 두 번 읽히지 않게 한쪽만 동작으로 쓴다.
         */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? '메뉴 접기' : '메뉴 펼치기'}
          title={expanded ? '메뉴 접기' : '메뉴 펼치기'}
          className={`flex items-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink ${
            expanded ? 'gap-2 px-2.5 py-2 text-[12px]' : 'size-9 justify-center'
          }`}
        >
          <Icon
            name="chevron-right"
            className={`size-[17px] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
          {expanded ? <span>접기</span> : null}
        </button>

        {user ? (
          expanded ? (
            <span className="flex items-center gap-2.5 px-1.5 py-1">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-ink">
                {user.name.slice(0, 1)}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[12.5px] font-semibold text-ink">
                  {user.name}
                </span>
                <span className="block truncate text-[10.5px] text-ink-muted">
                  {user.title_ko || ROLE_LABEL_KO[user.role]}
                </span>
              </span>
            </span>
          ) : (
            // 이름은 첫 글자만 남는다. 전체 이름과 직함은 title로 붙여 둔다 —
            // 레일에는 글자가 들어갈 폭이 없고, 어느 계정으로 보고 있는지는 알 수 있어야 한다.
            <span
              title={`${user.name} · ${user.title_ko || ROLE_LABEL_KO[user.role]}`}
              className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-ink"
            >
              {user.name.slice(0, 1)}
            </span>
          )
        ) : null}

        {/* 로그아웃은 Server Action이다. 쿠키를 지우는 건 서버만 할 수 있다.
            이 화면에 헤더가 없어 여기가 이 셸에서 계정을 놓는 유일한 자리다. */}
        <form action={signOut} className={expanded ? 'w-full' : ''}>
          <button
            type="submit"
            aria-label="로그아웃"
            title="로그아웃"
            className={`flex items-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink ${
              expanded ? 'w-full gap-2 px-2.5 py-2 text-[12px]' : 'size-9 justify-center'
            }`}
          >
            <Icon name="log-out" className="size-[17px] shrink-0" />
            {expanded ? <span>로그아웃</span> : null}
          </button>
        </form>
      </div>
    </aside>
  )
}

/**
 * 접힘 — ready만 그린다. href가 곧 실제 주소라 navHref()를 거칠 일이 없다.
 *
 * **아이콘 하나에 title과 aria-label을 둘 다 단다.** title은 눈으로 보는 사람이 hover로
 * 확인하는 이름이고, aria-label은 스크린 리더가 읽는 이름이다. 아이콘만 있는 내비게이션은
 * 둘 중 하나만 있으면 한쪽 사용자에게는 이름 없는 그림이 된다.
 */
function CollapsedMenu({ pathname }: { pathname: string }) {
  return (
    <ul className="space-y-1">
      {readyItems().map((item) => (
        <li key={item.label}>
          <Link
            href={item.href}
            title={item.label}
            aria-label={item.label}
            aria-current={pathname === item.href ? 'page' : undefined}
            className={[
              'flex size-11 items-center justify-center rounded-xl transition-colors',
              // 활성 표시는 흰 필이다((dashboard) 사이드바와 같은 규칙 — 골드는 상태가 아니다).
              // 다만 글자색은 text-ink가 아니라 text-app이다: 다크에서 --color-ink는
              // 흰색에 가까운 #e9e6f2라 흰 필 위에 올리면 아이콘이 사라진다.
              // --color-app(#0c1224)이 이 트리에서 '가장 어두운 면'이라 흰 필 위의 잉크가 된다.
              pathname === item.href
                ? 'bg-white/90 text-app shadow-sm'
                : 'text-ink-dim hover:bg-raised hover:text-ink',
            ].join(' ')}
          >
            <Icon name={item.icon} className="size-[19px]" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** 펼침 — (dashboard) Sidebar와 같은 항목·같은 그룹·같은 농도 규칙. */
function ExpandedMenu({ pathname }: { pathname: string }) {
  const active = (item: NavItem) => item.ready && pathname === item.href

  return (
    <>
      {NAV.map((group, i) => (
        <div key={group.title ?? i} className={i > 0 ? 'mt-4' : ''}>
          {group.title ? (
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-muted">
              {group.title.toUpperCase()}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.label}>
                <Link
                  href={navHref(item)}
                  aria-current={active(item) ? 'page' : undefined}
                  className={[
                    'group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
                    active(item)
                      ? 'bg-white/90 font-semibold text-app shadow-sm'
                      : 'text-ink-dim hover:bg-raised hover:text-ink',
                    // 아직 없는 화면은 글자를 한 단계 죽인다. 눌러도 되지만 같은 무게는 아니다.
                    item.ready || active(item) ? '' : 'opacity-60',
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
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}
