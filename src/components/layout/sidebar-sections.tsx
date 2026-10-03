'use client'

import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'

import { Icon } from '@/components/ui/icon'
import { navHref, type NavItem } from '@/lib/nav'
import type { SidebarCompany, SidebarInitiative, SidebarLevel } from '@/lib/sidebar-data'

/**
 * 사이드바 «회사» · «이니셔티브» 펼침 칸 (사이드바 개편 2026-10).
 *
 * 제목은 링크(원래 가던 곳), 옆의 ▸/▾ 단추가 접고 편다 — 제목을 누르면 화면이 바뀌고 단추를 누르면 목록만 바뀐다.
 * 기본은 회사 펼침 · 이니셔티브 접힘. 지금 그 목록의 회사(/business/<id> · /finance/<id>…)나 이니셔티브(/initiatives/<id>)에
 * 있으면 저절로 펼치고 그 줄을 켠다.
 *
 * 펼침은 사람마다 localStorage에 둔다(키에 user_id). 서버는 저장소를 모르므로 첫 그림은 늘 기본값이고,
 * useSyncExternalStore가 하이드레이션 뒤 저장된 값으로 갈아탄다(rail-sidebar.tsx와 같은 방식 — 불일치 없음).
 * 저장소가 막혀 있으면(사생활 보호 모드 등) 이번 세션 메모리로만 기억한다.
 */

export type SectionKey = 'companies' | 'initiatives'

const DEFAULT_OPEN: Record<SectionKey, boolean> = { companies: true, initiatives: false }

const storageKey = (userId: string, section: SectionKey) => `chairman-os:sidebar-section:${userId}:${section}`

/** 저장소가 막혔을 때만 쓰는 이번 세션 값. */
const memoryFallback = new Map<string, boolean>()
let listeners: (() => void)[] = []

function subscribe(onChange: () => void) {
  listeners = [...listeners, onChange]
  // 다른 탭에서 접고 펴면 따라간다.
  window.addEventListener('storage', onChange)
  return () => {
    listeners = listeners.filter((l) => l !== onChange)
    window.removeEventListener('storage', onChange)
  }
}

function readOpen(key: string, fallback: boolean): boolean {
  const mem = memoryFallback.get(key)
  if (mem !== undefined) return mem
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writeOpen(key: string, next: boolean) {
  try {
    window.localStorage.setItem(key, next ? '1' : '0')
    memoryFallback.delete(key)
  } catch {
    memoryFallback.set(key, next)
  }
  for (const l of listeners) l()
}

function useSectionOpen(userId: string, section: SectionKey, autoOpen: boolean, pathname: string) {
  const key = storageKey(userId, section)
  const fallback = DEFAULT_OPEN[section]
  const stored = useSyncExternalStore(
    subscribe,
    () => readOpen(key, fallback),
    () => fallback,
  )
  /**
   * 지금 이 목록 안의 화면이면 저절로 펼친다. 그 자리에서 사람이 접으면 그 주소에서만은 접힌 채로 둔다 —
   * 그러지 않으면 접기 단추가 죽은 단추가 된다. 다른 주소로 가면 다시 저절로 펼친다.
   */
  const [dismissedOn, setDismissedOn] = useState<string | null>(null)
  const forced = autoOpen && dismissedOn !== pathname
  const open = stored || forced

  const toggle = () => {
    const next = !open
    writeOpen(key, next)
    setDismissedOn(next ? null : pathname)
  }
  return { open, toggle }
}

const ROW =
  'group flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-[7px] text-t13 transition-colors'
const ROW_ACTIVE = 'bg-white/80 font-semibold text-ink shadow-sm'
const ROW_IDLE = 'text-ink-dim hover:bg-raised hover:text-ink'
const CHILD =
  'flex min-w-0 items-center gap-2 rounded-md py-[5px] pr-2 pl-2.5 text-t12h transition-colors'

function SectionHead({
  item,
  titleActive,
  open,
  onToggle,
  controls,
}: {
  item: NavItem
  titleActive: boolean
  open: boolean
  onToggle: () => void
  controls: string
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Link
        href={navHref(item)}
        aria-current={titleActive ? 'page' : undefined}
        className={`${ROW} ${titleActive ? ROW_ACTIVE : ROW_IDLE}`}
      >
        <Icon name={item.icon} className="size-[17px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controls}
        aria-label={`${item.label} ${open ? '접기' : '펼치기'}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <Icon name="chevron-down" className={`size-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
    </div>
  )
}

const DOT: Record<SidebarLevel, string> = { RED: 'bg-critical', YELLOW: 'bg-warning' }
const DOT_LABEL: Record<SidebarLevel, string> = { RED: '주의 RED', YELLOW: '주의 YELLOW' }
// 회장이 아니면 «주의»라는 이름을 꺼내지 않는다 — 회장 전용 화면이다(직원 화면 용어 원칙, CLAUDE.md). 점의 뜻만 남긴다.
const DOT_LABEL_STAFF: Record<SidebarLevel, string> = { RED: '확인 필요 · 높음', YELLOW: '확인 필요' }

/** 이 회사의 화면인가 — 회사 상세와 그 회사의 재무(장부 · 계정 · 전표). */
function companyActive(pathname: string, id: string) {
  return ['/business/', '/finance/'].some((p) => pathname === `${p}${id}` || pathname.startsWith(`${p}${id}/`))
}

export function CompaniesSection({
  item,
  companies,
  userId,
  pathname,
  titleActive,
  chairman,
}: {
  item: NavItem
  companies: SidebarCompany[]
  userId: string
  pathname: string
  titleActive: boolean
  /** 보는 사람이 회장인가 — 점의 이름(title · aria-label)을 가른다. */
  chairman: boolean
}) {
  const dotLabel = chairman ? DOT_LABEL : DOT_LABEL_STAFF
  const activeId = companies.find((c) => companyActive(pathname, c.business_id))?.business_id ?? null
  const { open, toggle } = useSectionOpen(userId, 'companies', activeId !== null, pathname)
  const listId = 'sidebar-companies'
  return (
    <>
      <SectionHead item={item} titleActive={titleActive} open={open} onToggle={toggle} controls={listId} />
      {open ? (
        <ul id={listId} className="mt-0.5 mb-1 ml-[18px] space-y-px border-l border-line-soft pl-1.5">
          {companies.length === 0 ? (
            <li className="px-2.5 py-1 text-t11 text-ink-muted">보이는 회사가 없습니다.</li>
          ) : (
            companies.map((c) => {
              const active = c.business_id === activeId
              return (
                <li key={c.business_id}>
                  <Link
                    href={`/business/${c.business_id}`}
                    aria-current={active ? 'page' : undefined}
                    className={`${CHILD} ${active ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    <span className="truncate">{c.name}</span>
                    {c.level ? (
                      <span
                        className={`ml-auto size-2 shrink-0 rounded-full ${DOT[c.level]}`}
                        title={dotLabel[c.level]}
                        aria-label={dotLabel[c.level]}
                        role="img"
                      />
                    ) : null}
                  </Link>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </>
  )
}

export function InitiativesSection({
  item,
  initiatives,
  userId,
  pathname,
  titleActive,
}: {
  item: NavItem
  initiatives: SidebarInitiative[]
  userId: string
  pathname: string
  titleActive: boolean
}) {
  const activeId = initiatives.find((i) => pathname === `/initiatives/${i.initiative_id}`)?.initiative_id ?? null
  const { open, toggle } = useSectionOpen(userId, 'initiatives', activeId !== null, pathname)
  const listId = 'sidebar-initiatives'
  return (
    <>
      <SectionHead item={item} titleActive={titleActive} open={open} onToggle={toggle} controls={listId} />
      {open ? (
        <ul id={listId} className="mt-0.5 mb-1 ml-[18px] space-y-px border-l border-line-soft pl-1.5">
          {initiatives.length === 0 ? (
            <li className="px-2.5 py-1 text-t11 text-ink-muted">진행 중인 이니셔티브가 없습니다.</li>
          ) : (
            initiatives.map((i) => {
              const active = i.initiative_id === activeId
              return (
                <li key={i.initiative_id}>
                  <Link
                    href={`/initiatives/${i.initiative_id}`}
                    aria-current={active ? 'page' : undefined}
                    className={`${CHILD} ${active ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    <span className="truncate">{i.title}</span>
                  </Link>
                </li>
              )
            })
          )}
          <li>
            <Link href="/initiatives" className={`${CHILD} text-t11h text-ink-muted hover:bg-raised hover:text-ink`}>
              전체 보기
              <Icon name="chevron-right" className="size-3 shrink-0" />
            </Link>
          </li>
        </ul>
      ) : null}
    </>
  )
}
