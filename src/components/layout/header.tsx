import { signOut } from '@/app/actions/auth'
import { DataModeBadge } from '@/components/layout/data-mode-badge'
import { GlobalSearch } from '@/components/layout/global-search'
import { Icon } from '@/components/ui/icon'
import { getFxStrip } from '@/lib/fx'
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
  // 헤더에는 USD 하나만 세운다. 다섯 개는 아침 루틴의 띠가 맡는다 —
  // 여기는 검색창이 가장 넓은 자리를 써야 하는 바라 칩을 늘리면 그 자리를 뺏는다.
  //
  // 기준일을 칩과 같이 들고 다니게 접어 둔다. 따로 두면 그리는 자리에서 fx가 null이 아님을
  // 단언(!)하게 되고, 이 저장소는 그 단언을 쓰지 않는다(weather-panel.tsx의 flatMap과 같은 이유).
  const chip = fx?.chips.find((c) => c.code === 'USD')
  const usd = chip ? { ...chip, asOf: fx?.asOf ?? '', comparedTo: fx?.comparedTo ?? '' } : null

  return (
    // glass-nav = --color-nav 면 + backdrop-blur. 사이드바·시스템바와 같은 면이라 같은 클래스를 쓴다.
    <header className="glass-nav flex h-14 shrink-0 items-center gap-4 border-b border-line-soft px-5">
      {/* CH-043. 이 헤더는 서버 컴포넌트로 두고 검색창만 클라이언트로 떼어 낸다 —
          세션(user)은 여기서 그리고, 입력·드롭다운만 브라우저로 내려간다. */}
      <GlobalSearch />

      <div className="flex shrink-0 items-center gap-1">
        {/* USD 칩. 못 불러오면 자리표시자를 남기지 않고 통째로 뺀다 —
            회장이 매일 보는 화면에서 em 대시는 '값이 없다'가 아니라 '고장'으로 읽힌다.
            title에 기준일을 넣는 이유는 주말 아침에 숫자가 안 바뀌는 것이 고장이 아님을
            hover로 확인할 수 있어야 하기 때문이다(ECB는 주말에 고시하지 않는다). */}
        {usd ? (
          <span
            title={`USD/KRW · ${usd.asOf} 고시 · 전일(${usd.comparedTo}) 대비 ${usd.deltaKrw >= 0 ? '+' : '−'}${Math.abs(usd.deltaKrw).toFixed(2)}원`}
            className="flex shrink-0 items-center gap-1 px-1 text-[11px] text-ink-muted"
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
        <DataModeBadge />
        <NotificationButton count={12} tone="critical" />
        <NotificationButton count={5} tone="accent" />
        <button
          type="button"
          aria-label="설정"
          className="rounded-md p-2 text-ink-dim transition-colors hover:bg-raised hover:text-ink"
        >
          <Icon name="settings" className="size-[18px]" />
        </button>

        <div className="ml-2 flex items-center gap-2.5 border-l border-line pl-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-[12px] font-bold text-ink">
            {user?.name.slice(0, 1) ?? '?'}
          </span>
          <span className="leading-tight">
            <span className="block text-[13px] font-semibold">
              {user ? user.name : '알 수 없음'}
            </span>
            <span className="block text-[11px] text-ink-muted">
              {user ? (user.title_ko || ROLE_LABEL_KO[user.role]) : '세션 없음'}
            </span>
          </span>

          {/* 로그아웃은 Server Action이다. 쿠키를 지우는 건 서버만 할 수 있다. */}
          <form action={signOut}>
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

/** 뱃지 색으로 급한 알림(빨강)과 일반 알림(파랑)을 갈라 놓는다. */
function NotificationButton({ count, tone }: { count: number; tone: 'critical' | 'accent' }) {
  return (
    <button
      type="button"
      aria-label={`알림 ${count}건`}
      className="relative rounded-md p-2 text-ink-dim transition-colors hover:bg-raised hover:text-ink"
    >
      <Icon name="bell" className="size-[18px]" />
      <span
        className={[
          'absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white tnum',
          tone === 'critical' ? 'bg-critical' : 'bg-accent',
        ].join(' ')}
      >
        {count}
      </span>
    </button>
  )
}
