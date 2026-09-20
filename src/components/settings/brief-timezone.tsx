'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveBriefTimezone } from '@/app/actions/chairman'
import { BRIEF_TIMEZONE_OPTIONS, TIMEZONE_SOURCE_LABEL_KO, type TimezoneSource } from '@/lib/chairman-timezone'

/**
 * 아침 알림의 ③ 수동 시간대와, **지금 어느 시간대로 판정되고 있는지** 한 줄 (Phase 3-C 현지 시간).
 *
 * 그 한 줄이 이 화면에서 제일 중요하다. 알림이 '회장 현지 06:00'으로 옮겨 간 뒤로
 * "왜 이 시각에 왔지"는 회장이 실제로 묻게 될 질문이고, 근거(①②③)를 안 보여 주면
 * 화면 어디에도 답할 자리가 없다 — 회장은 설정을 의심하는 대신 시스템을 의심하게 된다.
 *
 * '자동'이 기본값이고 빈 문자열로 표현한다. 고르는 순간 저장된다 — 저장 버튼을 따로 두면
 * 고르고 안 누른 채 나가는 날이 온다.
 */
export function BriefTimezone({
  value,
  decided,
  source,
  tripTitle,
}: {
  /** user_settings.brief_tz. null이면 자동이다. */
  value: string | null
  /** 지금 판정된 IANA 시간대. */
  decided: string
  source: TimezoneSource
  /** source === 'trip'일 때 어느 출장인지. */
  tripTitle: string | null
}) {
  const router = useRouter()
  const [selected, setSelected] = useState(value ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function choose(next: string) {
    const previous = selected
    setSelected(next)
    setBusy(true)
    setError(null)
    const result = await saveBriefTimezone(next)
    setBusy(false)
    if (result.error) {
      // 못 저장했으면 화면도 되돌린다. 고른 대로 보이는데 저장이 안 된 상태가 제일 나쁘다.
      setSelected(previous)
      setError(result.error)
      return
    }
    startTransition(() => router.refresh())
  }

  // 목록에 없는 시간대가 저장돼 있을 수 있다(③은 목록 바깥도 받는다 — actions/chairman.ts).
  // 그때 드롭다운이 그 값을 잃고 '자동'으로 보이면, 고치지도 않았는데 설정이 바뀐 것처럼 읽힌다.
  const options = BRIEF_TIMEZONE_OPTIONS.some((t) => t.id === selected)
    ? BRIEF_TIMEZONE_OPTIONS
    : [...BRIEF_TIMEZONE_OPTIONS, { id: selected, label: selected }]

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11.5px] text-ink-dim">
          시간대
          <select
            value={selected}
            disabled={busy}
            onChange={(e) => void choose(e.target.value)}
            className="ml-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none focus:border-accent disabled:cursor-wait disabled:opacity-60"
          >
            <option value="">자동</option>
            {options
              .filter((t) => t.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
          </select>
        </label>

        <span className="text-[11px] text-ink-muted">
          지금 판정: <span className="text-ink-dim tnum">{decided}</span> ({TIMEZONE_SOURCE_LABEL_KO[source]}
          {source === 'trip' && tripTitle ? ` · ${tripTitle}` : ''})
        </span>

        {error ? (
          <span role="status" className="text-[11.5px] text-critical">
            {error}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-[10.5px] text-ink-muted">
        자동일 때는 출장 일정의 현지 시간대를 먼저 보고, 없으면 마지막으로 앱을 연 기기의 시간대를 씁니다.
        둘 다 없으면 서울입니다.
      </p>
    </div>
  )
}
