import Link from 'next/link'

import { signOut } from '@/app/actions/auth'
import { DataModeBadge } from '@/components/layout/data-mode-badge'
import { GlobalSearch } from '@/components/layout/global-search'
import { MenuButton } from '@/components/layout/menu-button'
import { NotificationBell } from '@/components/layout/notification-bell'
import { Icon } from '@/components/ui/icon'
import { getFxStrip } from '@/lib/fx'
import { getRepository } from '@/lib/repository'
import { loadUiPrefs } from '@/lib/ui-prefs-server'
import { ROLE_LABEL_KO, type SessionUser } from '@/types'

/**
 * 상단 바. CH-043 Global Search와 CH-044 AI Query가 같은 입력창을 쓰기로 되어 있어
 * 검색창을 화면 가운데 가장 넓은 자리에 둔다. 지금 그 자리는 CH-043이 쓰고 있고,
 * AI Query(CH-044)가 붙으면 같은 컴포넌트 안에서 갈라진다.
 *
 * 오른쪽 끝의 이름은 세션에서 온다. 하드코딩해 두면 어느 계정으로 보고 있는지 알 수 없고,
 * 그건 권한이 역할마다 갈라지는 화면에서 가장 위험한 종류의 거짓말이다.
 *
 * **Phase 5-D에서 시간·날씨 칩이 빠졌다.** 둘은 대시보드 1줄의 카드로 옮겼다 —
 * 헤더에서는 11px 한 줄이라 훑기 어려웠고, 검색창이 가장 넓은 자리를 써야 하는 바에서
 * 자리만 다투고 있었다. 남은 것은 USD 칩 하나다(Phase 5-C).
 *
 * USD 값은 이 컴포넌트가 직접 읽는다. 레이아웃을 거쳐 내리지 않는 이유는 이 값이 세션과 달리
 * 화면 어디에도 다시 안 쓰이기 때문이다 — 셸에서 이 칩 하나만 쓰는 값을 layout의 prop 목록에
 * 올릴 이유가 없다. getFxStrip()은 cache: 'force-cache'로 30분 캐시를 탄다(lib/fx.ts).
 */
export async function Header({ user }: { user: SessionUser | null }) {
  // Phase 5-D에서 시간·날씨 칩을 대시보드 1줄 카드로 옮겼다. 헤더에는 USD 칩만 남는다 —
  // 검색창이 이 바에서 가장 넓은 자리를 써야 하고, 칩이 늘수록 그 자리를 뺏는다.
  const fx = await getFxStrip()

  /**
   * 알림함(Phase 5-E 1-2절). 예전에는 이 자리에 `12`와 `5`가 박혀 있었다.
   *
   * 꺼 둔 종류는 뱃지와 목록에서 **뺀다**(설정 → 알림). 저장만 하고 아무 데서도 안 보는
   * 스위치는 죽은 버튼과 같은 종류의 거짓말이라, 이 한 줄이 그 설정을 실제로 만든다.
   * 드롭다운은 열 줄까지다 — 그 아래는 스크롤이고, 뱃지는 잘림과 무관하게 전부를 센다.
   */
  const repo = await getRepository()
  const [inbox, prefs] = await Promise.all([repo.listNotifications(10), loadUiPrefs()])
  const notify = prefs.app.notify
  const items = inbox.items.filter((n) => notify[n.kind])
  const unread = items.filter((n) => n.read_at === null).length
  // 헤더에는 USD 하나만 세운다. 다섯 개는 아침 루틴의 띠가 맡는다 —
  // 여기는 검색창이 가장 넓은 자리를 써야 하는 바라 칩을 늘리면 그 자리를 뺏는다.
  //
  // 기준일을 칩과 같이 들고 다니게 접어 둔다. 따로 두면 그리는 자리에서 fx가 null이 아님을
  // 단언(!)하게 되고, 이 저장소는 그 단언을 쓰지 않는다(weather-panel.tsx의 flatMap과 같은 이유).
  const chip = fx?.chips.find((c) => c.code === 'USD')
  const usd = chip ? { ...chip, asOf: fx?.asOf ?? '', comparedTo: fx?.comparedTo ?? '' } : null

  return (
    // glass-nav = --color-nav 면 + backdrop-blur. 사이드바·시스템바와 같은 면이라 같은 클래스를 쓴다.
    // 폰(768px 미만)은 로고 · 검색 돋보기 · 알림 · 프로필만(회장 지시 2026-09-28). 1024px 미만은 햄버거로 서랍을 연다.
    // 노치 자리만큼 위를 비운다(safe-top) — iOS 홈 화면 앱은 상태 막대가 비치는 black-translucent다.
    <header className="glass-nav safe-top box-content flex h-14 shrink-0 items-center gap-1 border-b border-line-soft px-2 md:gap-4 md:px-5">
      <MenuButton />
      <Link href="/" aria-label="대시보드" className="flex min-h-11 items-center gap-1.5 px-1 lg:hidden">
        <Icon name="crown" className="size-5 text-gold" filled />
        <span className="hidden text-t13 font-bold tracking-[0.04em] text-ink min-[400px]:inline">CHAIRMAN OS</span>
      </Link>
      {/* CH-043. 이 헤더는 서버 컴포넌트로 두고 검색창만 클라이언트로 떼어 낸다 —
          세션(user)은 여기서 그리고, 입력·드롭다운만 브라우저로 내려간다. */}
      <GlobalSearch />

      <div className="flex shrink-0 items-center gap-0.5 md:gap-1">
        {/* USD 칩. 못 불러오면 자리표시자를 남기지 않고 통째로 뺀다 —
            회장이 매일 보는 화면에서 em 대시는 '값이 없다'가 아니라 '고장'으로 읽힌다.
            title에 기준일을 넣는 이유는 주말 아침에 숫자가 안 바뀌는 것이 고장이 아님을
            hover로 확인할 수 있어야 하기 때문이다(ECB는 주말에 고시하지 않는다). */}
        {usd ? (
          <span
            title={`USD/KRW · ${usd.asOf} 고시 · 전일(${usd.comparedTo}) 대비 ${usd.deltaKrw >= 0 ? '+' : '−'}${Math.abs(usd.deltaKrw).toFixed(2)}원`}
            className="hidden shrink-0 items-center gap-1 px-1 text-t11 text-ink-muted md:flex"
          >
            <span>USD</span>
            <span className="text-ink-dim tnum">{Math.round(usd.krw).toLocaleString('ko-KR')}</span>
            {usd.direction !== 'flat' ? (
              <span className={usd.direction === 'up' ? 'text-critical' : 'text-ok'}>
                {usd.direction === 'up' ? '▲' : '▼'}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="hidden md:contents">
          <DataModeBadge />
        </span>
        <NotificationBell unread={unread} items={items} />
        {/* 설정 톱니. Phase 5-E 4절이 /settings 허브를 세우기 전까지 이 버튼은 onClick도
            href도 없었다 — 갈 곳이 없어서 아무 데도 안 갔다. */}
        <Link
          href="/settings"
          aria-label="설정"
          title="설정"
          className="hidden rounded-md p-2 text-ink-dim transition-colors hover:bg-raised hover:text-ink md:block"
        >
          <Icon name="settings" className="size-[18px]" />
        </Link>

        {/* Phase 5-E 2절. 이름+직함이 /settings/profile로 가는 링크가 됐다.
            세션이 없으면 링크가 아니라 글자다 — 누를 프로필이 없는데 누르는 자리를
            만들면 그것이 곧 죽은 버튼이다. */}
        <div className="flex items-center gap-2.5 md:ml-2 md:border-l md:border-line md:pl-3">
          {user ? (
            <Link
              href="/settings/profile"
              title={`${user.name} · 프로필 설정`}
              className="flex min-h-11 min-w-11 items-center justify-center gap-2.5 rounded-md px-1 py-0.5 transition-colors hover:bg-raised"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-t12 font-bold text-ink">
                {user.name.slice(0, 1)}
              </span>
              <span className="hidden leading-tight md:block">
                <span className="block text-t13 font-semibold">{user.name}</span>
                <span className="block text-t11 text-ink-muted">
                  {user.title_ko || ROLE_LABEL_KO[user.role]}
                </span>
              </span>
            </Link>
          ) : (
            <span className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-t12 font-bold text-ink">
                ?
              </span>
              <span className="hidden leading-tight md:block">
                <span className="block text-t13 font-semibold">알 수 없음</span>
                <span className="block text-t11 text-ink-muted">세션 없음</span>
              </span>
            </span>
          )}

          {/* 로그아웃은 Server Action이다. 쿠키를 지우는 건 서버만 할 수 있다. */}
          <form action={signOut} className="hidden md:block">
            <button
              type="submit"
              aria-label="로그아웃"
              title="로그아웃"
              className="rounded-md p-2 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Icon name="log-out" className="size-[18px]" />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
