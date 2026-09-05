'use client'

import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { STATUS_LABEL_KO, BUSINESS_STATUS, type BusinessStatus } from '@/types'

/**
 * CH-002 Business 추가.
 * Acceptance가 '생성 즉시 Dashboard에 카드 생성'이라, 저장은 화면 상태를 바로 바꾼다.
 * 브라우저 기본 dialog/alert는 쓰지 않는다 — 관제 화면의 다른 패널이 같이 멈춘다.
 */

interface AddBusinessModalProps {
  onClose: () => void
  onCreate: (input: { name: string; industry: string; status: BusinessStatus }) => void
}

export function AddBusinessModal({ onClose, onCreate }: AddBusinessModalProps) {
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [status, setStatus] = useState<BusinessStatus>('Incubating')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSave = name.trim().length > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    onCreate({ name, industry: industry.trim() || '미분류', status })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-app/80 p-4"
      onMouseDown={(e) => {
        // 바깥을 눌렀을 때만 닫는다. 입력 중 드래그가 밖에서 끝나도 닫히면 안 된다.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="기업 추가"
        onSubmit={submit}
        className="w-full max-w-[400px] rounded-xl border border-line bg-panel p-5 shadow-2xl"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">기업 추가</h2>
          <span className="text-[9px] text-ink-muted tnum">CH-002</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-muted">
          추가한 기업은 이 브라우저에만 저장됩니다. 시드 데이터는 바뀌지 않습니다.
        </p>

        <label className="mt-4 block">
          <span className="text-[11px] text-ink-dim">회사명</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: Newco Materials"
            maxLength={40}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-[11px] text-ink-dim">업종</span>
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="예: 제조 / 화학"
            maxLength={40}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent"
          />
        </label>

        <fieldset className="mt-3">
          <legend className="text-[11px] text-ink-dim">상태</legend>
          {/* 06_상태코드의 BusinessStatus만 쓴다. 임의 상태명을 만들지 않는다. */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {BUSINESS_STATUS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                  status === s
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line text-ink-muted hover:text-ink-dim'
                }`}
              >
                {STATUS_LABEL_KO[s]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:text-ink"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink transition-opacity disabled:opacity-40"
          >
            <Icon name="plus" className="size-3.5" />
            추가
          </button>
        </div>
      </form>
    </div>
  )
}
