'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveCityMotion, saveNotifySwitch, saveTheme, saveUiTheme } from '@/app/actions/ui-prefs'
import { THEME_CHOICE, THEME_LABEL_KO, UI_THEME, UI_THEME_LABEL_KO, type ThemeChoice, type UiTheme } from '@/lib/ui-prefs'
import {
  NOTIFICATION_KIND,
  NOTIFICATION_KIND_LABEL_KO,
  notificationKindHint,
  type NotificationKind,
  type NotificationSwitches,
} from '@/types'

/**
 * '화면'과 '알림'이 손대는 두 스위치 묶음 (Phase 5-E 4절).
 *
 * 고르는 즉시 저장한다(BriefTimezone과 같은 규칙 — 저장 버튼을 따로 두면 고르고 안 누른 채
 * 나가는 날이 온다). 못 저장하면 화면도 되돌린다.
 */

/**
 * 0098 화면 모양 — 새 모양(기본) · 예전 모양. 고르는 즉시 저장하고 셸이 다시 그려진다(못 저장하면 되돌린다).
 * 기능 · 메뉴 · 주소는 같고 색 · 글꼴 · 카드 모양만 바뀐다.
 */
export function UiThemePicker({ value }: { value: UiTheme }) {
  const router = useRouter()
  const [ui, setUi] = useState<UiTheme>(value)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const choose = (next: UiTheme) => {
    if (next === ui) return
    const previous = ui
    setUi(next)
    setError(null)
    start(async () => {
      const result = await saveUiTheme(next)
      if (result.error) {
        setUi(previous)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="mt-2">
      <div role="radiogroup" aria-label="화면 모양" className="flex flex-wrap gap-1.5">
        {UI_THEME.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={ui === t}
            data-testid={`ui-theme-${t}`}
            disabled={pending}
            onClick={() => choose(t)}
            className={[
              'rounded-md border px-2.5 py-1.5 text-t11h transition-colors disabled:opacity-50',
              ui === t
                ? 'border-accent bg-accent-soft font-semibold text-ink'
                : 'border-line bg-raised text-ink-dim hover:border-accent hover:text-ink',
            ].join(' ')}
          >
            {UI_THEME_LABEL_KO[t]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-t10h text-ink-muted">
        메뉴 · 기능 · 주소는 그대로이고 색 · 글꼴 · 카드 모양만 바뀝니다. 사람마다 따로 저장됩니다.
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-t11 text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * `chairman` — 아침 루틴(/ai)은 회장 전용 화면이라 그 안내도 회장에게만 그린다
 * (직원 화면 용어 원칙(CLAUDE.md): 회장 전용 기능은 존재 자체를 꺼내지 않는다).
 */
export function ThemePicker({ value, chairman }: { value: ThemeChoice; chairman: boolean }) {
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
        {chairman ? (
          <>
            아침 루틴(<code>/ai</code>)은 이 설정과 무관하게 언제나 다크입니다 — 그 화면은 어두운
            방에서 읽는 것을 전제로 짜여 있습니다.{' '}
          </>
        ) : null}
        로그인 화면은 이 설정과 무관하게 늘 라이트입니다.
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-t11 text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** `bossName` — 보는 사람에 맞는 호칭(lib/boss.ts boss()). 직원 화면 용어 원칙(CLAUDE.md). */
export function NotifySwitches({ value, bossName }: { value: NotificationSwitches; bossName: string }) {
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
              {notificationKindHint(kind, bossName)}
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
