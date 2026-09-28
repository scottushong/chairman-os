'use client'

import { openNavDrawer } from '@/components/layout/nav-drawer'
import { Icon } from '@/components/ui/icon'

/** 헤더 햄버거 — 1024px 미만에서 사이드바 서랍을 연다. 헤더는 서버 컴포넌트라 이 버튼만 떼어 낸다. */
export function MenuButton() {
  return (
    <button
      type="button"
      aria-label="메뉴 열기"
      onClick={openNavDrawer}
      className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-raised lg:hidden"
    >
      <Icon name="menu" className="size-5" />
    </button>
  )
}
