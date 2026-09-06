'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { draftDecision } from '@/app/actions/draft-decision'
import { Icon } from '@/components/ui/icon'
import {
  WORK_PRIORITY,
  WORK_PRIORITY_LABEL_KO,
  type Business,
  type WorkPriority,
} from '@/types'

/**
 * CH-041 기안 폼 (DEFERRED D-10 선택지 A).
 *
 * 이 화면의 주인공은 결재를 '처리하는' 목록이라 폼은 접어 둔다 — CH-042 링크 등록과 같은 모양이다.
 * 결재를 보러 온 사람이 매번 기안 폼을 지나쳐 스크롤하게 만들지 않는다.
 *
 * 파일 입력이 없다. 사내 스토리지 링크 한 줄만 받는다(CLAUDE.md 데이터 원칙 / 0006).
 * 드래그&드롭 자리를 만들어 두면 언젠가 누가 Vault 계약서를 이 DB로 끌어다 놓는다.
 *
 * 선택안을 여러 줄 상자로 받는 이유
 *   02_데이터필드에서 options는 필수고 배열이다. 'A / B / C'를 한 줄에 쓰게 하면
 *   슬래시가 들어간 선택안('가격 인상 / 물량 조정 동시')을 쓸 수 없다. 줄바꿈이 더 안전하다.
 */

/** 결재를 올릴 때 기본으로 잡는 마감. 오늘 올린 결재를 오늘까지로 두면 아무도 못 본다. */
const DEFAULT_DEADLINE_DAYS = 7

function defaultDeadline(): string {
  const d = new Date()
  d.setDate(d.getDate() + DEFAULT_DEADLINE_DAYS)
  return d.toISOString().slice(0, 10)
}

export function DraftDecision({ businesses }: { businesses: Business[] }) {
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [businessId, setBusinessId] = useState(businesses[0]?.business_id ?? '')
  const [options, setOptions] = useState('')
  const [impact, setImpact] = useState<WorkPriority>('Medium')
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave =
    title.trim().length > 0 &&
    businessId.length > 0 &&
    options.trim().length > 0 &&
    deadline.length > 0 &&
    !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return

    setBusy(true)
    setError(null)
    const result = await draftDecision({
      title,
      businessId,
      options,
      impact,
      deadline,
      attachmentUrl,
    })
    setBusy(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setTitle('')
    setOptions('')
    setAttachmentUrl('')
    setImpact('Medium')
    setDeadline(defaultDeadline())
    setOpen(false)

    // 방금 올린 결재를 열어 준다. 목록만 새로 그리면 스무 건 중 어느 것이 내 것인지 못 찾는다.
    if (result.decision) {
      router.push(`/approvals?tab=open&id=${encodeURIComponent(result.decision.decision_id)}`)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
      >
        <Icon name="plus" className="size-3.5" />
        결재 올리기
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      aria-label="결재 기안"
      className="w-full rounded-xl border border-line bg-panel p-4"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">결재 올리기</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-ink-muted transition-colors hover:text-ink"
        >
          닫기
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">
        올린 결재는 대기 상태로 들어가고, 올린 사실이 감사 기록에 한 줄 남습니다(CH-051).
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="text-[11px] text-ink-dim">제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: Hot-melt 판매가 조정 — 원료 단가 +12% 반영 시점"
            maxLength={200}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-ink-dim">회사</span>
          <select
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {/* 그룹 공통 선택지가 없다. 0001의 decisions.business_id는 not null이다 —
                결재는 언제나 어느 회사의 일이고, 그게 권한 범위를 정한다. */}
            {businesses.map((b) => (
              <option key={b.business_id} value={b.business_id} className="bg-panel">
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] text-ink-dim">마감일</span>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="text-[11px] text-ink-dim">내용 — 선택안</span>
          <textarea
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder={'한 줄에 하나씩 적습니다.\n예: 10월부터 8% 인상\n예: 12월까지 동결 후 재협상\n예: 물량 계약으로 전환'}
            rows={4}
            maxLength={1000}
            disabled={busy}
            className="mt-1 w-full resize-y rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
          {/* 왜 자유 서술이 아닌지 적어 둔다. 02_데이터필드에서 options는 필수 배열이다. */}
          <span className="mt-1 block text-[10.5px] text-ink-muted">
            줄마다 선택안 하나로 저장됩니다. 고를 것이 없으면 결재가 아니라 보고입니다.
          </span>
        </label>

        <label className="block md:col-span-2">
          <span className="text-[11px] text-ink-dim">첨부 — 사내 스토리지 링크 (선택)</span>
          <input
            value={attachmentUrl}
            onChange={(e) => setAttachmentUrl(e.target.value)}
            placeholder="https://storage.example.co.kr/decisions/2026/..."
            inputMode="url"
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
          <span className="mt-1 block text-[10.5px] text-ink-muted">
            파일은 올리지 않습니다. Chairman OS는 문서의 주소만 보관합니다.
          </span>
        </label>

        <fieldset className="md:col-span-2">
          <legend className="text-[11px] text-ink-dim">긴급도</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WORK_PRIORITY.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setImpact(p)}
                disabled={busy}
                aria-pressed={impact === p}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  impact === p
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line text-ink-muted hover:text-ink-dim'
                }`}
              >
                {WORK_PRIORITY_LABEL_KO[p]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={!canSave}
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink transition-opacity disabled:opacity-40"
        >
          <Icon name="stamp" className="size-3.5" />
          {busy ? '올리는 중…' : '결재 올리기'}
        </button>
      </div>
    </form>
  )
}
