'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveWorldCities } from '@/app/actions/ui-prefs'
import { Icon } from '@/components/ui/icon'
import {
  DEFAULT_WORLD_CITY_IDS,
  HOME_CITY_ID,
  WORLD_CITIES,
  WORLD_CITIES_MAX,
  worldCitiesOf,
} from '@/lib/world-cities'

/**
 * 관심 도시 편집 — 세계시간(대시보드 카드 · 아침 루틴)과 관심 도시 날씨가 같이 쓰는 목록.
 *
 * 고치는 즉시 저장한다(ThemePicker와 같은 규칙). 못 저장하면 화면도 되돌린다.
 * 서울은 첫 자리에 고정이다 — 빼기 · 옮기기 버튼을 두지 않는다(lib/world-cities.ts HOME_CITY_ID).
 * 더할 수 있는 도시는 lib/world-cities.ts의 표에 있는 것뿐이다 — 날씨에 좌표가, 시계에 시간대가
 * 있어야 해서 이름만 받아 적을 수는 없다.
 */
/** `chairman` — 아침 루틴은 회장 전용이라 그 언급도 회장에게만(직원 화면 용어 원칙, CLAUDE.md). */
export function WorldCitiesEditor({ value, chairman }: { value: string[]; chairman: boolean }) {
  const router = useRouter()
  const [ids, setIds] = useState<string[]>(value)
  const [adding, setAdding] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const commit = (next: string[]) => {
    const previous = ids
    setIds(next)
    setError(null)
    start(async () => {
      const result = await saveWorldCities(next)
      if (result.error) {
        setIds(previous)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    // 0번(서울)과 자리를 바꾸지 않는다.
    if (j < 1 || j >= ids.length) return
    const next = [...ids]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  const cities = worldCitiesOf(ids)
  const addable = WORLD_CITIES.filter((c) => !ids.includes(c.id))
  const full = ids.length >= WORLD_CITIES_MAX
  const isDefault =
    ids.length === DEFAULT_WORLD_CITY_IDS.length && ids.every((id, i) => id === DEFAULT_WORLD_CITY_IDS[i])

  const btn =
    'grid size-7 place-items-center rounded-md border border-line bg-raised text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-30'
  const pill =
    'rounded-md border border-line bg-raised px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-50'

  return (
    <div className="mt-2">
      <ol className="divide-y divide-line-soft rounded-md border border-line">
        {cities.map((c, i) => {
          const home = c.id === HOME_CITY_ID
          return (
            <li key={c.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-5 text-right text-t10 text-ink-muted tnum">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={`text-t12 text-ink ${home ? 'font-semibold' : ''}`}>{c.nameKo}</span>
                <span className="ml-1.5 text-t10 text-ink-muted">{c.tz}</span>
              </span>
              {home ? (
                <span className="text-t10 text-ink-muted">첫 자리 고정</span>
              ) : (
                <span className="flex gap-1">
                  <button
                    type="button"
                    className={btn}
                    disabled={pending || i <= 1}
                    onClick={() => move(i, -1)}
                    aria-label={`${c.nameKo} 위로`}
                  >
                    <Icon name="arrow-up" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={pending || i >= ids.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`${c.nameKo} 아래로`}
                  >
                    <Icon name="arrow-up" className="size-3.5 rotate-180" />
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={pending}
                    onClick={() => commit(ids.filter((x) => x !== c.id))}
                    aria-label={`${c.nameKo} 빼기`}
                  >
                    <Icon name="x" className="size-3.5" />
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          disabled={pending || full || addable.length === 0}
          aria-label="더할 도시"
          className="rounded-md border border-line bg-raised px-2 py-1.5 text-t11h text-ink disabled:opacity-50"
        >
          <option value="">{full ? `최대 ${WORLD_CITIES_MAX}곳입니다` : '도시 고르기'}</option>
          {addable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameKo} · {c.tz}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || full || adding === ''}
          onClick={() => {
            commit([...ids, adding])
            setAdding('')
          }}
          className={`flex items-center gap-1 ${pill}`}
        >
          <Icon name="plus" className="size-3.5" />
          추가
        </button>
        <button
          type="button"
          disabled={pending || isDefault}
          onClick={() => commit([...DEFAULT_WORLD_CITY_IDS])}
          className={pill}
        >
          기본값으로
        </button>
      </div>
      <p className="mt-1.5 text-t10h text-ink-muted">
        {chairman
          ? '대시보드 «날씨와 세계시간» 카드와 아침 루틴의 시계 · 관심 도시 날씨가'
          : '대시보드 «날씨와 세계시간» 카드가'}{' '}
        이 목록을 이 순서로 씁니다.
        도시 옆 «+8h»는 지금 보고 있는 기기 시각과의 차이입니다.
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-t11 text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}
