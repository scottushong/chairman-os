'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { Icon } from '@/components/ui/icon'

/**
 * 좁은 화면(1024px 미만)의 사이드바 서랍 (모바일 전면 점검 2026-09-28).
 *
 * 넓은 화면의 사이드바를 그대로 서랍 안에 한 번 더 그린다 — 메뉴 목록 · 숨김 · 접힘이 한 벌이어야
 * 폰과 PC가 다른 메뉴를 보여 주지 않는다. 여는 손잡이는 둘이다: 헤더 햄버거 · 하단 탭 «더보기».
 * 둘 다 이 창 이벤트를 쏜다(서로 다른 트리에 있어 상태를 나눠 가질 부모가 없다).
 * 주소가 바뀌면 닫는다 — 메뉴를 눌렀는데 서랍이 남아 있으면 이동이 안 된 것처럼 보인다.
 */
export const OPEN_NAV_DRAWER = 'chairman:nav-drawer'

export function openNavDrawer() {
  window.dispatchEvent(new Event(OPEN_NAV_DRAWER))
}

export function NavDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_NAV_DRAWER, onOpen)
    return () => window.removeEventListener(OPEN_NAV_DRAWER, onOpen)
  }, [])

  // 이동하면 닫는다. 렌더 중 비교(이전 값 보관)로 — effect에서 setState하면 한 프레임 늦게 닫힌다.
  const [seen, setSeen] = useState(pathname)
  if (seen !== pathname) {
    setSeen(pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="메뉴">
      <div className="safe-left safe-top safe-bottom flex h-full bg-app">{children}</div>
      <button
        type="button"
        aria-label="메뉴 닫기"
        onClick={() => setOpen(false)}
        className="flex-1 bg-black/35 backdrop-blur-[2px]"
      >
        <Icon name="x" className="safe-top mt-3 ml-3 size-6 text-white" />
      </button>
    </div>
  )
}
