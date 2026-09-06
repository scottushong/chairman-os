'use client'

import { useState } from 'react'

import { createDocument } from '@/app/actions/documents'
import { Icon } from '@/components/ui/icon'
import {
  SECURITY_CLASS,
  SECURITY_CLASS_LABEL_KO,
  type Business,
  type SecurityClass,
} from '@/types'

/**
 * CH-042 문서 등록 폼.
 *
 * 파일 입력이 없다. 일부러 없다 — 사내 스토리지에 있는 문서의 '주소'만 여기 둔다
 * (CLAUDE.md 데이터 원칙 / vault_columns.md 선택지 B). 드래그&드롭 자리를 만들어 두면
 * 언젠가 누가 Vault 계약서를 이 DB로 끌어다 놓는다.
 *
 * 접었다 펴는 이유는 이 화면의 주인공이 목록이기 때문이다. 문서를 찾으러 온 사람이
 * 매번 등록 폼을 지나쳐 스크롤하게 만들지 않는다.
 */

const GROUP = 'group'

export function RegisterDocument({ businesses }: { businesses: Business[] }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [businessId, setBusinessId] = useState<string>(GROUP)
  const [docType, setDocType] = useState('')
  const [securityClass, setSecurityClass] = useState<SecurityClass>('Normal')
  const [storageUrl, setStorageUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = title.trim().length > 0 && storageUrl.trim().length > 0 && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return

    setBusy(true)
    setError(null)
    const result = await createDocument({
      title,
      businessId,
      docType,
      securityClass,
      storageUrl,
    })
    setBusy(false)

    if (result.error) {
      setError(result.error)
      return
    }

    // 목록은 서버가 다시 그린다(revalidatePath). 여기서는 폼만 비우고 접는다.
    setTitle('')
    setDocType('')
    setStorageUrl('')
    setSecurityClass('Normal')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
      >
        <Icon name="plus" className="size-3.5" />
        링크 등록
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      aria-label="문서 링크 등록"
      className="w-full rounded-xl border border-line bg-panel p-4"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">사내 스토리지 링크 등록</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-ink-muted transition-colors hover:text-ink"
        >
          닫기
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">
        파일은 올리지 않습니다. Chairman OS는 문서의 주소만 보관합니다.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="text-[11px] text-ink-dim">문서명</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 2026 Sticky Alliance 공급계약서"
            maxLength={120}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-ink-dim">소속</span>
          <select
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {/* DB에서는 NULL이 그룹 공통이다. 화면에서는 'group'으로 부른다(어댑터가 옮긴다). */}
            <option value={GROUP} className="bg-panel">
              그룹 공통
            </option>
            {businesses.map((b) => (
              <option key={b.business_id} value={b.business_id} className="bg-panel">
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] text-ink-dim">문서 유형</span>
          <input
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            placeholder="예: Contract / IR / TDS / Meeting"
            maxLength={40}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="text-[11px] text-ink-dim">사내 스토리지 링크</span>
          <input
            value={storageUrl}
            onChange={(e) => setStorageUrl(e.target.value)}
            placeholder="https://storage.example.co.kr/contracts/2026/..."
            inputMode="url"
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
          />
        </label>

        <fieldset className="md:col-span-2">
          <legend className="text-[11px] text-ink-dim">보안등급</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SECURITY_CLASS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSecurityClass(c)}
                disabled={busy}
                aria-pressed={securityClass === c}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  securityClass === c
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line text-ink-muted hover:text-ink-dim'
                }`}
              >
                {SECURITY_CLASS_LABEL_KO[c]}
              </button>
            ))}
          </div>
          {/* 등급을 올리면 자기도 못 보게 될 수 있다. 저장 전에 말해 준다. */}
          <p className="mt-1.5 text-[10.5px] text-ink-muted">
            등급이 자기 열람 등급보다 높으면 등록한 본인에게도 목록에 뜨지 않습니다(0002
            documents_read).
          </p>
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
          <Icon name="plus" className="size-3.5" />
          {busy ? '등록하는 중…' : '등록'}
        </button>
      </div>
    </form>
  )
}
