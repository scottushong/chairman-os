'use client'

import { useState, useTransition } from 'react'

import { createDocFolder } from '@/app/actions/documents'
import type { DocFolder } from '@/types'

/**
 * 폴더 하나 만들기 (Phase 9 블록 3). 회사 → (팀) → (부모 폴더) → 이름.
 * 부모를 고르면 팀은 부모를 따른다 — 다른 팀 폴더 밑에 다른 팀 폴더가 서지 않게.
 */
export function FolderCreate({
  businesses,
  teams,
  folders,
  paths,
}: {
  businesses: { id: string; name: string }[]
  teams: { id: string; business_id: string; name: string }[]
  folders: DocFolder[]
  paths: Record<number, string>
}) {
  const [open, setOpen] = useState(false)
  const [business, setBusiness] = useState(businesses[0]?.id ?? '')
  const [team, setTeam] = useState('')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] text-ink-dim hover:text-ink hover:underline">
        + 폴더
      </button>
    )
  }

  const parentFolder = folders.find((f) => String(f.folder_id) === parent)
  const input = 'w-full rounded-md border border-line bg-panel px-2 py-1 text-[11.5px]'

  function submit() {
    setError(null)
    start(async () => {
      const result = await createDocFolder({
        businessId: business,
        teamId: parentFolder ? (parentFolder.team_id ?? '') : team,
        parentId: parent,
        name,
      })
      if (result.error) setError(result.error)
      else {
        setName('')
        setOpen(false)
      }
    })
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-line-soft bg-raised p-2">
      <select
        value={business}
        onChange={(e) => {
          setBusiness(e.target.value)
          setTeam('')
          setParent('')
        }}
        className={input}
      >
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <select value={parent} onChange={(e) => setParent(e.target.value)} className={input}>
        <option value="">(최상위 폴더)</option>
        {folders
          .filter((f) => f.business_id === business)
          .map((f) => (
            <option key={f.folder_id} value={f.folder_id}>
              {paths[f.folder_id] ?? f.name}
            </option>
          ))}
      </select>
      {parent ? null : (
        <select value={team} onChange={(e) => setTeam(e.target.value)} className={input}>
          <option value="">(팀 없음 — 회사 바로 밑)</option>
          {teams
            .filter((t) => t.business_id === business)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="폴더 이름" className={input} />
      {error ? (
        <p role="alert" className="text-[11px] text-critical">
          {error}
        </p>
      ) : null}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
        >
          만들기
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim">
          취소
        </button>
      </div>
    </div>
  )
}
