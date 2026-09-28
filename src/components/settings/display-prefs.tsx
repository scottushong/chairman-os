'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveCityMotion, saveNotifySwitch, saveTheme } from '@/app/actions/ui-prefs'
import { THEME_CHOICE, THEME_LABEL_KO, type ThemeChoice } from '@/lib/ui-prefs'
import {
  NOTIFICATION_KIND,
  NOTIFICATION_KIND_HINT_KO,
  NOTIFICATION_KIND_LABEL_KO,
  type NotificationKind,
  type NotificationSwitches,
} from '@/types'

/**
 * '화면'과 '알림'이 손대는 두 스위치 묶음 (Phase 5-E 4절).
 *
 * 고르는 즉시 저장한다(BriefTimezone과 같은 규칙 — 저장 버튼을 따로 두면 고르고 안 누른 채
 * 나가는 날이 온다). 못 저장하면 화면도 되돌린다.
 */

export function ThemePicker({ value }: { value: ThemeChoice }) {
  const router = useRouter()
  const [theme, setTheme] = useState<ThemeChoice>(value)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const choose = (next: ThemeChoice) => {
    const previous = theme
    setTheme(next)
    setError(null)
    start(async () => {
      const result = await saveTheme(next)
      if (result.error) {
        setTheme(previous)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        {THEME_CHOICE.map((t) => (
          <button
            key={t}
            type="button"
            disabled={pending}
            onClick={() => choose(t)}
            aria-pressed={theme === t}
            className={[
              'rounded-md border px-2.5 py-1.5 text-t11h transition-colors disabled:opacity-50',
              theme === t
                ? 'border-accent bg-accent-soft font-semibold text-ink'
                : 'border-line bg-raised text-ink-dim hover:border-accent hover:text-ink',
            ].join(' ')}
          >
            {THEME_LABEL_KO[t]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-t10h text-ink-muted">
        아침 루틴(<code>/ai</code>)은 이 설정과 무관하게 언제나 다크입니다 — 그 화면은 어두운
        방에서 읽는 것을 전제로 짜여 있습니다. 로그인 화면도 늘 라이트입니다.
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-t11 text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function NotifySwitches({ value }: { value: NotificationSwitches }) {
  const router = useRouter()
  const [on, setOn] = useState<NotificationSwitches>(value)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const toggle = (kind: NotificationKind) => {
    const next = !on[kind]
    setOn((s) => ({ ...s, [kind]: next }))
    setError(null)
    start(async () => {
      const result = await saveNotifySwitch(kind, next)
      if (result.error) {
        setOn((s) => ({ ...s, [kind]: !next }))
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="mt-2 space-y-0.5">
      {NOTIFICATION_KIND.map((kind) => (
        <label
          key={kind}
          className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-raised"
        >
          <input
            type="checkbox"
            checked={on[kind]}
            disabled={pending}
            onChange={() => toggle(kind)}
            className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-t12 text-ink">{NOTIFICATION_KIND_LABEL_KO[kind]}</span>
            <span className="mt-0.5 block text-t10 text-ink-muted">
              {NOTIFICATION_KIND_HINT_KO[kind]}
            </span>
          </span>
        </label>
      ))}
      <p className="pt-1 text-t10h text-ink-muted">
        꺼 둔 종류는 헤더의 종에서 건수와 목록 모두 빠집니다. 저장만 되고 아무 데서도
        쓰이지 않는 스위치를 두지 않습니다.
      </p>
      {error ? (
        <p role="alert" className="text-t11 text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** 그룹 시티의 강물 · 구름 흐름(Phase 8 G-2b). 고르는 즉시 저장하고, 못 저장하면 되돌린다. */
export function CityMotionSwitch({ value }: { value: boolean }) {
  const router = useRouter()
  const [on, setOn] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const toggle = () => {
    const next = !on
    setOn(next)
    setError(null)
    start(async () => {
      const result = await saveCityMotion(next)
      if (result.error) {
        setOn(!next)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="mt-2">
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-raised">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={toggle}
          className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          <span className="block text-t12 text-ink">그룹 시티 강물 · 구름 흐름</span>
          <span className="mt-0.5 block text-t10 text-ink-muted">
            끄면 배경만 멈춥니다. 사람 · 서류 · 차량은 실제 데이터라 그대로 움직입니다. 기기의 «동작 줄이기»가
            켜져 있으면 이 설정과 무관하게 멈춥니다.
          </span>
        </span>
      </label>
      {error ? (
        <p role="alert" className="mt-1 text-t11 text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}
