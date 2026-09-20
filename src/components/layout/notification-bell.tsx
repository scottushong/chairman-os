'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { markNotificationsRead } from '@/app/actions/notifications'
import { Icon } from '@/components/ui/icon'
import { formatDateTime } from '@/lib/format'
import { NOTIFICATION_KIND_LABEL_KO, type AppNotification } from '@/types'

/**
 * 헤더 알림 종 (Phase 5-E 1-2절).
 *
 * ■ 무엇이 바뀌었나 ■
 * 예전에는 종이 **둘**이었고 각각 `12`와 `5`를 하드코딩하고 있었다. 시안에서 온 숫자라
 * 아무것도 세지 않았고, onClick이 없어 눌러도 열리지 않았다. 지금은 종이 하나이고
 * 0030 notifications를 센다.
 *
 * **둘을 하나로 합친 이유.** 두 종은 '급한 것(빨강)'과 '일반(파랑)'이었는데, 그 둘을
 * 가르는 칸이 표에 없다. 없는 구분을 색으로 그리면 회장이 빨간 숫자를 '급한 건수'로 읽고,
 * 실제로는 아무 뜻도 없는 숫자가 된다 — 하드코딩 12/5를 지운 이유가 정확히 그것이다.
 * 급함을 나눌 칸이 생기는 날 다시 둘로 선다(DEFERRED.md Phase 5-E).
 *
 * **지금 0이 뜨는 것이 정상이다.** 알림을 만드는 코드가 아직 없고 0030이 insert를
 * 아무에게도 주지 않았다. 0은 사실이고 12는 거짓말이다.
 */
export function NotificationBell({
  unread,
  items,
}: {
  unread: number
  items: AppNotification[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const boxRef = useRef<HTMLDivElement>(null)

  // 바깥을 누르면 닫힌다. 드롭다운 하나 때문에 화면 전체를 덮는 투명 레이어를 깔지 않는다 —
  // 그 레이어가 있으면 첫 클릭이 늘 '닫기'로 먹혀서 검색창이 한 번에 안 잡힌다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unreadIds = items.filter((n) => n.read_at === null).map((n) => n.notification_id)

  const markAll = () => {
    if (unreadIds.length === 0) return
    startTransition(async () => {
      await markNotificationsRead(unreadIds)
      // 건수는 서버가 센다. 클라이언트에서 0으로 깎아 두면 실패한 날 화면만 0이 된다.
      router.refresh()
    })
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread > 0 ? `알림 ${unread}건` : '알림 없음'}
        title="알림"
        className="relative rounded-md p-2 text-ink-dim transition-colors hover:bg-raised hover:text-ink"
      >
        <Icon name="bell" className="size-[18px]" />
        {/* 0건일 때는 뱃지를 아예 그리지 않는다. '0'이 적힌 동그라미는 읽는 순간
            "뭔가 있나?"로 한 번 더 보게 만든다 — 없는 것은 없는 모양이어야 한다. */}
        {unread > 0 ? (
          <span className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[9px] font-bold text-white tnum">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute top-full right-0 z-30 mt-1 w-[320px] rounded-xl border border-line-soft bg-panel p-2 shadow-lg">
          <div className="flex items-baseline justify-between px-1.5 pb-1.5">
            <span className="text-[12px] font-semibold">알림</span>
            {unreadIds.length > 0 ? (
              <button
                type="button"
                onClick={markAll}
                disabled={pending}
                className="rounded px-1.5 py-0.5 text-[10.5px] text-ink-dim transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
              >
                {pending ? '표시하는 중…' : '모두 읽음으로'}
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-1.5 py-6 text-center text-[11.5px] text-ink-muted">
              새 알림이 없습니다.
            </p>
          ) : (
            <ul className="max-h-[320px] space-y-0.5 overflow-y-auto">
              {items.map((n) => (
                <li key={n.notification_id}>
                  <NotificationRow notification={n} onNavigate={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 border-t border-line-soft pt-1.5">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="block rounded px-1.5 py-1 text-[10.5px] text-ink-dim transition-colors hover:bg-raised hover:text-ink"
            >
              알림 설정
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 한 줄. link가 없는 알림은 누를 곳이 없으므로 <Link>로 감싸지 않는다(죽은 링크를 만들지 않는다). */
function NotificationRow({
  notification: n,
  onNavigate,
}: {
  notification: AppNotification
  onNavigate: () => void
}) {
  const body = (
    <>
      <span className="flex items-baseline gap-1.5">
        {n.read_at === null ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
        <span className="text-[11.5px] font-semibold text-ink">{n.title}</span>
        <span className="ml-auto shrink-0 text-[9.5px] text-ink-muted">
          {NOTIFICATION_KIND_LABEL_KO[n.kind]}
        </span>
      </span>
      {n.body ? <span className="mt-0.5 block text-[10.5px] text-ink-dim">{n.body}</span> : null}
      <span className="mt-0.5 block text-[9.5px] text-ink-muted tnum">
        {formatDateTime(n.created_at)}
      </span>
    </>
  )

  const cls = 'block rounded-lg px-1.5 py-1.5 transition-colors hover:bg-raised'
  return n.link ? (
    <Link href={n.link} onClick={onNavigate} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
