'use client'

import { useState } from 'react'

import { saveChairmanManifesto } from '@/app/actions/chairman'

/**
 * 선언문 textarea. 저장하면 audit_log(update)에 before/after 전문이 남는다 — 그게 곧 개정 이력이다.
 * 붙여 넣은 줄바꿈·빈 줄은 그대로 저장된다(/ai가 whitespace-pre-wrap으로 그린다).
 */
export function ManifestoEditor({ initial }: { initial: string }) {
  const [body, setBody] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const dirty = body.trim() !== saved.trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setDone(false)
    const result = await saveChairmanManifesto(body)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSaved(body)
    setDone(true)
  }

  return (
    <form onSubmit={submit} aria-label="선언문">
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          setDone(false)
        }}
        rows={24}
        disabled={busy}
        placeholder="선언문 전문을 붙여 넣으세요. 줄바꿈과 문단이 그대로 /ai에 표시됩니다."
        className="w-full rounded-lg border border-line bg-raised px-4 py-3 text-[14px] leading-[1.9] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50"
      />
      <div className="mt-2 flex items-center justify-end gap-3">
        {error ? (
          <span role="alert" className="text-[11.5px] text-critical">
            {error}
          </span>
        ) : done ? (
          <span className="text-[11.5px] text-ok">저장했습니다. 감사 기록에 남았습니다.</span>
        ) : null}
        <span className="text-[11px] text-ink-muted tnum">{body.trim().length.toLocaleString()}자</span>
        <button
          type="submit"
          disabled={busy || !dirty}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-app transition-opacity disabled:opacity-40"
        >
          {busy ? '저장 중…' : '선언문 저장'}
        </button>
      </div>
    </form>
  )
}
