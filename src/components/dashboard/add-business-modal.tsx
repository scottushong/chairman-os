'use client'

import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { BUSINESS_ID_PREFIX, draftSlug, isValidSlug, SLUG_RULE_KO } from '@/lib/business-id'
import { STATUS_LABEL_KO, BUSINESS_STATUS, type BusinessStatus } from '@/types'

/**
 * CH-002 Business 추가.
 * Acceptance가 '생성 즉시 Dashboard에 카드 생성'이라, 저장이 끝나면 화면이 바로 바뀐다.
 * 브라우저 기본 dialog/alert는 쓰지 않는다 — 관제 화면의 다른 패널이 같이 멈춘다.
 *
 * 저장은 Server Action이 한다(DEFERRED D-08 결정 A). 그래서 이 모달은 '저장 중'과 실패를
 * 화면에 띄울 수 있어야 한다. 예전처럼 즉시 성공으로 치고 닫으면, 권한이 없어 거부당한 경우
 * 회사가 만들어진 줄 알고 넘어간다.
 */

export interface AddBusinessInput {
  name: string
  slug: string
  industry: string
  status: BusinessStatus
}

interface AddBusinessModalProps {
  onClose: () => void
  /** 성공하면 아무것도, 실패하면 사람이 읽을 문장을 돌려준다. */
  onCreate: (input: AddBusinessInput) => Promise<string | null>
}

export function AddBusinessModal({ onClose, onCreate }: AddBusinessModalProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  /** 사용자가 ID 칸을 한 번이라도 건드렸는가. 건드리기 전까지만 회사명에서 따라온다. */
  const [slugTouched, setSlugTouched] = useState(false)
  const [industry, setIndustry] = useState('')
  const [status, setStatus] = useState<BusinessStatus>('Incubating')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSave = name.trim().length > 0 && isValidSlug(slug) && !busy

  function onName(value: string) {
    setName(value)
    // 한글 이름이면 초안이 빈 문자열이다. 그때는 사용자가 직접 적어야 한다(lib/business-id.ts).
    if (!slugTouched) setSlug(draftSlug(value))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return

    setBusy(true)
    setError(null)
    const message = await onCreate({ name, slug, industry, status })
    setBusy(false)

    if (message) {
      setError(message)
      return
    }
    onClose()
  }

  const slugBad = slug.length > 0 && !isValidSlug(slug)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-app/80 p-4"
      onMouseDown={(e) => {
        // 바깥을 눌렀을 때만 닫는다. 입력 중 드래그가 밖에서 끝나도 닫히면 안 된다.
        if (e.target === e.currentTarget && !busy) onClose()
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
          모든 사람에게 보이는 조직 데이터가 만들어집니다. 생성 기록은 감사 로그에 남습니다.
        </p>

        <label className="mt-4 block">
          <span className="text-[11px] text-ink-dim">회사명</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="예: Newco Materials"
            maxLength={40}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        {/* 발급 규칙을 화면에 그대로 보여 준다. 한번 만들면 바꿀 수 없는 값이라 저장 전에 봐야 한다. */}
        <label className="mt-3 block">
          <span className="text-[11px] text-ink-dim">기업 ID</span>
          <span className="mt-1 flex items-center rounded-lg border border-line bg-raised focus-within:border-accent">
            <span className="pl-3 text-[13px] text-ink-muted tnum">{BUSINESS_ID_PREFIX}</span>
            <input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase())
              }}
              placeholder="newco_materials"
              maxLength={30}
              disabled={busy}
              aria-invalid={slugBad}
              className="w-full bg-transparent py-2 pr-3 pl-0.5 text-[13px] text-ink outline-none placeholder:text-ink-muted disabled:opacity-50"
            />
          </span>
          <span
            className={`mt-1 block text-[10px] leading-snug ${slugBad ? 'text-critical' : 'text-ink-muted'}`}
          >
            {SLUG_RULE_KO} 나중에 바꿀 수 없습니다.
          </span>
        </label>

        <label className="mt-3 block">
          <span className="text-[11px] text-ink-dim">업종</span>
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="예: 제조 / 화학"
            maxLength={40}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
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
                disabled={busy}
                aria-pressed={status === s}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
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

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-critical/40 bg-critical/10 px-2 py-1.5 text-[11px] leading-snug text-critical"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:text-ink disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink transition-opacity disabled:opacity-40"
          >
            <Icon name="plus" className="size-3.5" />
            {busy ? '추가하는 중…' : '추가'}
          </button>
        </div>
      </form>
    </div>
  )
}
