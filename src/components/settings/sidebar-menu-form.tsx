'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveHiddenNavItems } from '@/app/actions/ui-prefs'
import { Icon, type IconName } from '@/components/ui/icon'

/**
 * /settings/sidebar — 사이드바에 무엇을 둘지 고른다 (Phase 5-E 3절).
 *
 * ■ 이 화면은 항목의 **키**만 다룬다 ■
 * 서버로 보내는 것은 `known`(이 화면이 실제로 보여 준 키 전부)과 `checked`(그중 숨길 키)다.
 * 서버는 `(기존 − known) ∪ checked`로 합친다 — **화면에 없던 키는 건드리지 않는다.**
 *
 * 왜 그런가. 곧 올 Phase 7 블록 E가 사이드바를 10개 항목으로 갈아 끼운다. 그때 이 화면이
 * 보여 주는 목록도 같이 바뀌는데, 저장이 "지금 안 보이는 키는 지운다"로 동작하면
 * 회장이 예전에 숨겨 둔 항목의 설정이 그 한 번의 저장으로 영영 사라진다.
 * 목록이 되돌아오는 날(되돌리기·부분 롤아웃) 설정도 같이 돌아와야 한다.
 *
 * 항목은 서버가 준 그대로 그린다. NAV를 여기서 다시 import 하면 화면과 판정이 두 벌이 된다.
 */

export interface MenuRow {
  key: string
  label: string
  icon: IconName
  ready: boolean
  /** 그룹 제목. 없는 그룹(맨 위·맨 아래)은 빈 문자열이다. */
  group: string
}

export function SidebarMenuForm({
  rows,
  hidden,
  hideNotReady,
}: {
  rows: MenuRow[]
  hidden: string[]
  hideNotReady: boolean
}) {
  const router = useRouter()
  const [checked, setChecked] = useState<string[]>(hidden)
  const [notReady, setNotReady] = useState(hideNotReady)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const known = rows.map((r) => r.key)

  const persist = (nextChecked: string[], nextNotReady: boolean) => {
    setError(null)
    startTransition(async () => {
      const result = await saveHiddenNavItems(known, nextChecked, nextNotReady)
      if (result.error) {
        // 못 저장했으면 화면도 되돌린다. 체크된 대로 보이는데 저장이 안 된 상태가 제일 나쁘다.
        setChecked(checked)
        setNotReady(notReady)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  const toggle = (key: string) => {
    const next = checked.includes(key) ? checked.filter((k) => k !== key) : [...checked, key]
    setChecked(next)
    persist(next, notReady)
  }

  const toggleNotReady = () => {
    const next = !notReady
    setNotReady(next)
    persist(checked, next)
  }

  // 그룹 제목으로 묶어 그린다. 사이드바에서 보이는 순서 그대로여야 '어느 것을 끄는지'가 맞는다.
  const groups: { title: string; rows: MenuRow[] }[] = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (last && last.title === row.group) last.rows.push(row)
    else groups.push({ title: row.group, rows: [row] })
  }

  return (
    <div className="mt-2.5">
      <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-raised px-3 py-2.5">
        <input
          type="checkbox"
          checked={notReady}
          onChange={toggleNotReady}
          disabled={pending}
          className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          <span className="block text-[12px] font-semibold text-ink">
            준비 중 항목을 기본으로 숨기기
          </span>
          <span className="mt-0.5 block text-[10.5px] text-ink-muted">
            아직 화면이 없는 메뉴를 한 번에 감춥니다. 아래에서 개별로 체크해 둔 항목이 있으면
            그쪽이 먼저입니다 — 직접 고른 설정을 이 스위치가 덮지 않습니다.
          </span>
        </span>
      </label>

      <div className="mt-3 space-y-3">
        {groups.map((g, i) => (
          <div key={g.title || `g${i}`}>
            {g.title ? (
              <p className="mb-1 px-1 text-[10px] font-semibold tracking-[0.12em] text-ink-muted">
                {g.title.toUpperCase()}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {g.rows.map((row) => {
                const off = checked.includes(row.key) || (notReady && !row.ready)
                return (
                  <li key={row.key}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-raised">
                      <input
                        type="checkbox"
                        // 체크 = 보인다. '숨김'을 체크로 표현하면 목록 전체가 뒤집혀 읽힌다.
                        checked={!off}
                        onChange={() => toggle(row.key)}
                        disabled={pending || (notReady && !row.ready && !checked.includes(row.key))}
                        className="size-3.5 shrink-0 accent-[var(--color-accent)]"
                      />
                      <Icon name={row.icon} className="size-4 shrink-0 text-ink-muted" />
                      <span className={`text-[12.5px] ${off ? 'text-ink-muted' : 'text-ink'}`}>
                        {row.label}
                      </span>
                      {!row.ready ? (
                        <span className="ml-auto rounded bg-raised px-1.5 py-0.5 text-[9.5px] text-ink-muted">
                          준비 중
                        </span>
                      ) : null}
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10.5px] text-ink-muted">
        지금 보고 있는 화면의 메뉴는 숨겨 두어도 사이드바에 남습니다 — 길을 잃지 않게 하기
        위해서입니다. 저장은 고르는 즉시 됩니다.
      </p>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}
