'use client'

import { useId, useState } from 'react'

/**
 * 폰(640px 미만)에서 입력 양식을 한 화면에 한 칸씩 넘기게 한다(회장 지시 2026-09-28 «입력은 한 화면 한 칸»).
 * 전표 · 결재 · 이니셔티브 양식이 같이 쓴다.
 *
 * **순전히 보이는 것만 바꾼다.** 지금 단계가 아닌 칸은 max-sm:hidden(display:none)으로 숨길 뿐
 * 언마운트하지 않는다 — 값 · 상태가 그대로 남아 저장할 때 모든 칸이 서버로 간다.
 * 검증 · 저장 로직은 각 양식의 것 그대로다. 640px 이상은 단계가 없다(모든 칸이 한 번에 보인다).
 */
export function useMobileSteps(count: number) {
  const [step, setStep] = useState(0)
  // 머리(StepHeader)를 id로 찾는다. ref를 돌려주면 React 컴파일러가 이 묶음 전체를 ref로 보고 렌더 중 읽기를 막는다.
  const anchorId = useId()

  function go(next: number) {
    setStep(Math.max(0, Math.min(count - 1, next)))
    // 긴 칸에서 «다음»을 누르면 다음 칸의 중간부터 보인다 — 양식 머리로 올린다.
    document.getElementById(anchorId)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  /** i번째 칸에 붙일 클래스. 폰에서 지금 단계가 아니면 숨는다. */
  function only(i: number) {
    return i === step ? '' : 'max-sm:hidden'
  }

  return { step, count, go, only, anchorId }
}

type Steps = ReturnType<typeof useMobileSteps>

/** 폰에서만 보이는 «2 / 3 · 라인» 머리. 양식 맨 위에 둔다(«다음»이 여기로 스크롤한다). */
export function StepHeader({ steps, labels, className = '' }: { steps: Steps; labels: string[]; className?: string }) {
  return (
    <div id={steps.anchorId} className={`scroll-mt-4 sm:hidden ${className}`}>
      <p className="flex items-center gap-2 text-t12 text-ink-dim" aria-live="polite">
        <span className="font-semibold text-ink tnum">
          {steps.step + 1} / {steps.count}
        </span>
        <span>{labels[steps.step]}</span>
      </p>
      <div className="mt-1.5 flex gap-1" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={l} className={`h-1 flex-1 rounded-full ${i <= steps.step ? 'bg-accent' : 'bg-line'}`} />
        ))}
      </div>
    </div>
  )
}

/**
 * 폰에서만 보이는 «이전 · 다음». 마지막 단계에는 «다음»이 없다 — 그 칸에 양식 원래의 저장 버튼이 있다.
 * 이 버튼들은 type="button"이라 어떤 form도 제출하지 않는다.
 */
export function StepNav({
  steps,
  prevLabel = '이전',
  nextLabel = '다음',
  className = '',
}: {
  steps: Steps
  prevLabel?: string
  nextLabel?: string
  className?: string
}) {
  const last = steps.step === steps.count - 1
  return (
    <div className={`flex gap-3 sm:hidden ${className}`}>
      {steps.step > 0 ? (
        <button
          type="button"
          onClick={() => steps.go(steps.step - 1)}
          className="flex-1 rounded-lg border border-line bg-raised px-3 py-2.5 text-t13 font-semibold text-ink-dim"
        >
          {prevLabel}
        </button>
      ) : null}
      {last ? null : (
        <button
          type="button"
          onClick={() => steps.go(steps.step + 1)}
          className="flex-1 rounded-lg bg-accent px-3 py-2.5 text-t13 font-semibold text-white"
        >
          {nextLabel}
        </button>
      )}
    </div>
  )
}
