'use client'

import { useState } from 'react'

import { triageException } from '@/app/actions/attention'
import {
  EXCEPTION_TRIAGE,
  EXCEPTION_TRIAGE_EFFECT_KO,
  EXCEPTION_TRIAGE_LABEL_KO,
  type ExceptionTriage,
} from '@/types'

/**
 * §18 회장 액션 버튼 셋 — **승인 · 관찰 14일 · CEO에게 위임**(원문 그대로).
 *
 * ■ 권한은 DB가 판정한다 ■ 이 컴포넌트는 역할을 보지 않는다. 부모가 `canTriage`로 렌더 여부만
 * 가르고(«눌러도 거부당하는 버튼을 두지 않는다» — 블록 A의 `AreaEditor`와 같은 모양),
 * 실제 판정은 0035의 `exceptions_triage`다. 두 겹이 어긋나면 **DB가 이긴다** — 그래서 거부는
 * 화면에 문장으로 그대로 뜬다.
 *
 * ■ 버튼이 무엇을 바꾸는지 말한다 ■ 세 버튼이 `status`를 각각 다르게 다룬다(승인은 종료,
 * 관찰은 기한과 함께 관찰 중, **위임은 상태를 바꾸지 않는다**). 이름만으로는 알 수 없어서
 * `title`에 그 문장을 싣는다(`EXCEPTION_TRIAGE_EFFECT_KO`). 누르면 무슨 일이 일어나는지
 * 모르는 버튼은 한 번 눌러 본 뒤로 안 눌린다.
 *
 * ■ 되돌리는 버튼은 두지 않는다 ■ `audit_log`는 append only이고 «취소»는 또 하나의 기록이다.
 * 잘못 눌렀으면 다른 액션을 눌러 그 사실을 남기는 것이 이 저장소의 모양이다.
 */
export function TriageButtons({
  exceptionId,
  businessId,
}: {
  exceptionId: number
  businessId: string
}) {
  const [busy, setBusy] = useState<ExceptionTriage | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: ExceptionTriage) {
    setBusy(action)
    setError(null)
    const result = await triageException({ exceptionId, businessId, action })
    setBusy(null)
    if (result.error) setError(result.error)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {EXCEPTION_TRIAGE.map((action) => (
        <button
          key={action}
          type="button"
          disabled={busy !== null}
          title={EXCEPTION_TRIAGE_EFFECT_KO[action]}
          onClick={() => run(action)}
          className="rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
        >
          {busy === action ? '기록 중…' : EXCEPTION_TRIAGE_LABEL_KO[action]}
        </button>
      ))}
      {error ? (
        <span role="alert" className="text-[10.5px] leading-relaxed text-critical">
          {error}
        </span>
      ) : null}
    </div>
  )
}
