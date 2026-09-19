'use client'

import { useState } from 'react'

import { saveCheckin } from '@/app/actions/checkin'
import { GlassCard } from '@/components/ui/glass-card'
import type { ChairmanCheckin, ChairmanCondition, IsoDate } from '@/types'

/**
 * 상단 3칸 중 셋째 칸 — 오늘 체크인(컨디션·수면·체중·식사 메모, 0019).
 *
 * **이 칸은 Chairman에게만 그려진다.** 판정은 부르는 쪽(page.tsx)의 isChairman 분기고,
 * 값으로 나누지 않는다 — 값으로 나누면 GroupCFO에게 '빈 체크인 칸'이 보이고, 그건
 * "회장이 매일 컨디션을 적는다"는 사실 자체를 흘리는 것이다(0017 회장 메모와 같은 판단).
 * 실제 문은 여전히 RLS다(0019 chairman_checkins_all).
 *
 * 컨디션에는 색을 쓰지 않는다. 1이 빨강이면 그건 상태색이고, 이 앱에서 색은
 * 위험과 승인대기에만 오른다. 고른 칸은 골드 필(강조)로만 표시한다.
 *
 * 컨디션 5칸은 네이티브 라디오다(보이지 않게 두고 라벨을 칠한다). 버튼 다섯 개로 만들면
 * 좌우 화살표 이동과 '하나만 고른다'는 성질을 직접 구현해야 하는데, 라디오는 그게 기본이다.
 */
const CONDITIONS: ChairmanCondition[] = [1, 2, 3, 4, 5]

export function CheckinPanel({ date, initial }: { date: IsoDate; initial: ChairmanCheckin | null }) {
  const [condition, setCondition] = useState<ChairmanCondition | null>(initial?.condition ?? null)
  // 숫자 칸은 문자열로 들고 있는다 — 빈 칸("기록 없음")과 0을 구분해야 하고, 입력 중간
  // 상태('7.'처럼 아직 숫자가 아닌 값)를 숫자로 바꾸면 커서가 튄다.
  const [sleep, setSleep] = useState(initial?.sleep_hours?.toString() ?? '')
  const [weight, setWeight] = useState(initial?.weight_kg?.toString() ?? '')
  const [meal, setMeal] = useState(initial?.meal_note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (condition === null) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const result = await saveCheckin({
        checkinDate: date,
        condition,
        sleepHours: sleep,
        weightKg: weight,
        mealNote: meal,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setDone(true)
    } catch {
      // Server Action이 던지는 경우(전송 실패 등)를 받는다. 안 받으면 아래 finally가 돌지 않아
      // fieldset이 disabled인 채로 남고, 회장이 아무 칸도 못 고치는 화면이 된다.
      setError('저장하지 못했습니다. 연결을 확인하고 다시 시도하세요.')
    } finally {
      setBusy(false)
    }
  }

  function touched() {
    setDone(false)
  }

  const field =
    'w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50'

  return (
    <GlassCard as="section" aria-label="오늘 체크인">
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend className="text-[13px] font-semibold text-ink">오늘 체크인</legend>

          <div role="radiogroup" aria-label="컨디션" className="mt-2.5 flex gap-1.5">
            {CONDITIONS.map((c) => (
              <label
                key={c}
                className={[
                  'flex h-9 flex-1 cursor-pointer items-center justify-center rounded-md border text-[14px] font-semibold tnum transition-colors',
                  // 고른 칸은 골드 필이다. bg-accent 위의 글자색은 globals.css가 다크에서
                  // #161412로 내려 준다(황동 위 흰 글자는 2.23:1이라 못 읽는다).
                  condition === c
                    ? 'border-accent bg-accent text-ink'
                    : 'border-line bg-raised text-ink-dim hover:text-ink',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="condition"
                  value={c}
                  checked={condition === c}
                  onChange={() => {
                    setCondition(c)
                    touched()
                  }}
                  className="sr-only"
                />
                {c}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-ink-muted">1 나쁨 · 5 좋음</p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-ink-muted">수면(시간)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                max="24"
                value={sleep}
                onChange={(e) => {
                  setSleep(e.target.value)
                  touched()
                }}
                placeholder="—"
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink-muted">체중(kg)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="300"
                value={weight}
                onChange={(e) => {
                  setWeight(e.target.value)
                  touched()
                }}
                placeholder="—"
                className={`mt-1 ${field}`}
              />
            </label>
          </div>

          <label className="mt-2.5 block">
            <span className="block text-[11px] text-ink-muted">식사 메모</span>
            <input
              type="text"
              value={meal}
              onChange={(e) => {
                setMeal(e.target.value)
                touched()
              }}
              placeholder="아침에 무엇을 드셨는지"
              className={`mt-1 ${field}`}
            />
          </label>

          <div className="mt-3 flex items-center justify-end gap-2.5">
            {error ? (
              <span role="alert" className="text-[11px] text-critical">
                {error}
              </span>
            ) : done ? (
              <span className="text-[11px] text-ok">기록했습니다.</span>
            ) : null}
            <button
              type="submit"
              disabled={condition === null}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink transition-opacity disabled:opacity-40"
            >
              {busy ? '저장 중…' : initial ? '다시 기록' : '기록'}
            </button>
          </div>
        </fieldset>
      </form>
    </GlassCard>
  )
}
