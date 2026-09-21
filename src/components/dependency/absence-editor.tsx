'use client'

import Link from 'next/link'
import { useState } from 'react'

import { saveAbsenceTest, saveAutonomyAssessment } from '@/app/actions/dependency'
import {
  ABSENCE_DAYS,
  ABSENCE_RESULT,
  ABSENCE_RESULT_LABEL_KO,
  AUTONOMY_CRITERIA_KO,
  AUTONOMY_LEVEL,
  type AbsenceTest,
} from '@/types'

/**
 * §12 부재 테스트 · §9 분기 자율성 평가 (편집). /dependency/[id].
 *
 * ■ 결과의 기본값이 '예정'이다 ■ 테스트를 등록할 때 pass/fail을 고르게 두면 치르기 전에
 * 결과가 적힌다. §12는 "치를 수 있는가"를 재는 것이고, 미리 적은 결과는 그 질문을 지운다.
 *
 * ■ 자율성 평가에는 근거 칸이 붙어 있다 ■ 등급은 판단이고, 판단에는 누가 언제 왜가 따라야
 * 한다. 근거 없는 'L4'는 어느 날 갑자기 화면에 있는 숫자가 된다.
 */
export function AbsenceEditor({
  businessId,
  tests,
  canWrite,
}: {
  businessId: string
  tests: AbsenceTest[]
  canWrite: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<number>(30)
  const [on, setOn] = useState('')
  const [note, setNote] = useState('')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // 새 테스트는 언제나 '예정'이다. 결과는 치른 뒤에 이 표에서 바꾼다.
    const r = await saveAbsenceTest({ businessId, days, scheduledOn: on, result: 'pending', note })
    setBusy(false)
    if (r.error) setError(r.error)
    else {
      setOn('')
      setNote('')
    }
  }

  async function setResult(t: AbsenceTest, result: string) {
    setBusy(true)
    setError(null)
    const r = await saveAbsenceTest({
      businessId,
      days: t.days,
      scheduledOn: t.scheduled_on,
      result,
      note: t.note ?? '',
    })
    setBusy(false)
    if (r.error) setError(r.error)
  }

  return (
    <div>
      {tests.length === 0 ? (
        <p className="rounded-lg bg-raised px-3 py-2.5 text-[11px] text-ink-muted">
          아직 부재 테스트를 치르거나 예정한 적이 없습니다. §12는 7 · 30 · 90 · 365일 넷을 봅니다.
        </p>
      ) : (
        <ul className="space-y-1">
          {tests.map((t) => (
            <li
              key={`${t.days}-${t.scheduled_on}`}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-raised px-3 py-2 text-[11.5px]"
            >
              <b className="font-semibold text-ink tnum">{t.days}일</b>
              <span className="text-ink-dim tnum">{t.scheduled_on}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  // 색은 예외를 가리킨다(§32). 실패만 색이 붙는다 — 통과는 정상이다.
                  t.result === 'fail' ? 'bg-critical/15 text-critical' : 'bg-panel text-ink-dim'
                }`}
              >
                {ABSENCE_RESULT_LABEL_KO[t.result]}
              </span>
              {t.note ? <span className="text-[10.5px] text-ink-muted">{t.note}</span> : null}
              {canWrite ? (
                <select
                  value={t.result}
                  disabled={busy}
                  onChange={(e) => setResult(t, e.target.value)}
                  aria-label={`${t.days}일 테스트 결과`}
                  className="ml-auto rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10.5px] text-ink outline-none focus:border-accent"
                >
                  {ABSENCE_RESULT.map((r) => (
                    <option key={r} value={r}>
                      {ABSENCE_RESULT_LABEL_KO[r]}
                    </option>
                  ))}
                </select>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <form onSubmit={add} className="mt-2 flex flex-wrap items-end gap-2" aria-label="부재 테스트 예정">
          <label className="text-[10.5px] text-ink-dim">
            기간
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="mt-0.5 block rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
            >
              {ABSENCE_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}일
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10.5px] text-ink-dim">
            시작 예정일
            <input
              type="date"
              value={on}
              onChange={(e) => setOn(e.target.value)}
              className="mt-0.5 block rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="min-w-[180px] flex-1 text-[10.5px] text-ink-dim">
            메모
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
            />
          </label>
          {error ? (
            <span role="alert" className="text-[11px] text-critical">
              {error}
            </span>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-app disabled:opacity-40"
          >
            예정 등록
          </button>
        </form>
      ) : null}
    </div>
  )
}

/** §9 분기 평가 입력. 등급만 고르고 끝내지 않는다 — 근거 칸이 같이 있다. */
export function AutonomyEditor({
  businessId,
  quarter,
  current,
}: {
  businessId: string
  /** 이번 분기(YYYY-Qn). 화면이 KST 기준으로 계산해 내려 준다. */
  quarter: string
  current: string | null
}) {
  const [level, setLevel] = useState(current ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setDone(false)
    const r = await saveAutonomyAssessment({ businessId, quarter, level, note })
    setBusy(false)
    if (r.error) setError(r.error)
    else setDone(true)
  }

  return (
    <form onSubmit={submit} className="mt-2 rounded-lg bg-raised p-2.5" aria-label="분기 자율성 평가">
      <p className="text-[10.5px] text-ink-dim">
        {quarter} 평가 — 등급 기준은{' '}
        <Link href="/dependency/settings" className="underline underline-offset-2">
          세는 규칙
        </Link>
        에 §9 원문 그대로 있습니다.
      </p>
      <div className="mt-1.5 flex flex-wrap items-end gap-2">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          aria-label="자율성 등급"
          className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
        >
          <option value="">— 고르세요</option>
          {AUTONOMY_LEVEL.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="이 등급으로 본 근거"
          className="min-w-[200px] flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || level === ''}
          className="rounded-md bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-app disabled:opacity-40"
        >
          {busy ? '저장 중…' : '평가 저장'}
        </button>
      </div>
      {level ? (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-muted">
          {AUTONOMY_CRITERIA_KO[level as keyof typeof AUTONOMY_CRITERIA_KO]}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-critical">
          {error}
        </p>
      ) : done ? (
        <p className="mt-1 text-[11px] text-ok">저장했습니다. 감사 기록에 남았습니다.</p>
      ) : null}
    </form>
  )
}
