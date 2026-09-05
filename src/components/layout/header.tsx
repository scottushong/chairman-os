import { signOut } from '@/app/actions/auth'
import { DataModeBadge } from '@/components/layout/data-mode-badge'
import { Icon } from '@/components/ui/icon'
import { ROLE_LABEL_KO, type SessionUser } from '@/types'

/**
 * 상단 바. CH-043 Global Search와 CH-044 AI Query가 같은 입력창을 쓰기로 되어 있어
 * 검색창을 화면 가운데 가장 넓은 자리에 둔다.
 *
 * 오른쪽 끝의 이름은 세션에서 온다. 하드코딩해 두면 어느 계정으로 보고 있는지 알 수 없고,
 * 그건 권한이 역할마다 갈라지는 화면에서 가장 위험한 종류의 거짓말이다.
 */
export function Header({ user }: { user: SessionUser | null }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line-soft bg-nav px-5">
      <div className="relative mx-auto w-full max-w-[560px]">
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
        />
        <input
          type="search"
          placeholder="전체 검색 (회사, 프로젝트, 문서, 사람, 업무 등)"
          className="h-9 w-full rounded-lg border border-line bg-panel pr-3 pl-9 text-[13px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
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
