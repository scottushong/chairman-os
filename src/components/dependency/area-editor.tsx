'use client'

import { useState } from 'react'

import { saveDependencyArea } from '@/app/actions/dependency'
import { LevelChip, TransferChip } from '@/components/dependency/pieces'
import {
  DEPENDENCY_LEVEL,
  DEPENDENCY_LEVEL_EMPTY_KO,
  DEPENDENCY_LEVEL_LABEL_KO,
  TRANSFER_STATUS,
  TRANSFER_STATUS_EMPTY_KO,
  TRANSFER_STATUS_LABEL_KO,
  type DependencyArea,
} from '@/types'

/**
 * §7+§11 의존 영역 표 (편집). /dependency/[id].
 *
 * ■ 빈 칸이 이 표의 요점이다 ■ 두 선택 모두 '— 아직 평가하지 않음' / '— 이양 계획 없음'이
 * **기본값이고 저장 가능한 값**이다. 드롭다운의 첫 항목을 'LOW'나 'not_started'로 두면
 * 새 영역을 만들 때마다 평가하지 않은 값이 하나씩 생긴다 — 그 값들은 그럴듯해서
 * 아무도 의심하지 않는다.
 *
 * 권한은 서버가 본다(0033 can_write_succession). 쓰지 못하는 사람에게는 이 컴포넌트가
 * 아예 렌더되지 않는다(부모가 readOnly로 표만 그린다) — 눌러도 거부당하는 버튼을 두지 않는다.
 */
export function AreaEditor({
  businessId,
  areas,
  canWrite,
}: {
  businessId: string
  areas: DependencyArea[]
  canWrite: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-t11h">
        <thead>
          <tr className="border-b border-line-soft text-left text-t10h text-ink-dim">
            <th className="py-1.5 pr-3 font-normal">영역</th>
            <th className="py-1.5 pr-3 font-normal">회장 의존도</th>
            <th className="py-1.5 pr-3 font-normal">이양</th>
            <th className="py-1.5 pr-3 font-normal">목표일</th>
            <th className="py-1.5 font-normal">메모</th>
          </tr>
        </thead>
        <tbody>
          {areas.map((a) =>
            editing === a.area ? (
              <tr key={a.area} className="border-b border-line-soft last:border-0">
                <td colSpan={5} className="py-2">
                  <AreaForm
                    businessId={businessId}
                    area={a}
                    onDone={() => setEditing(null)}
                    onCancel={() => setEditing(null)}
                  />
                </td>
              </tr>
            ) : (
              <tr key={a.area} className="border-b border-line-soft last:border-0 align-top">
                <td className="py-2 pr-3">
                  <span className="font-semibold text-ink">{a.area}</span>
                  {a.area_en ? (
                    <span className="ml-1.5 text-t10 text-ink-muted">{a.area_en}</span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  {a.level === null ? (
                    <span className="text-t10h text-ink-muted">{DEPENDENCY_LEVEL_EMPTY_KO}</span>
                  ) : (
                    <LevelChip level={a.level} />
                  )}
                </td>
                <td className="py-2 pr-3">
                  {a.transfer_status === null ? (
                    <span className="text-t10h text-ink-muted">{TRANSFER_STATUS_EMPTY_KO}</span>
                  ) : (
                    <TransferChip status={a.transfer_status} />
                  )}
                </td>
                <td className="py-2 pr-3 tnum text-ink-dim">{a.target_date ?? '—'}</td>
                <td className="py-2 text-t10h leading-relaxed text-ink-muted">
                  {a.note ?? '—'}
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => setEditing(a.area)}
                      className="ml-2 rounded border border-line px-1.5 py-0.5 text-t10 text-ink-dim hover:border-accent hover:text-ink"
                    >
                      고치기
                    </button>
                  ) : null}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      {canWrite ? (
        adding ? (
          <div className="mt-2 rounded-lg bg-raised p-2.5">
            <AreaForm businessId={businessId} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 rounded-md border border-line px-2.5 py-1 text-t11 text-ink-dim hover:border-accent hover:text-ink"
          >
            영역 추가
          </button>
        )
      ) : null}
    </div>
  )
}

function AreaForm({
  businessId,
  area,
  onDone,
  onCancel,
}: {
  businessId: string
  area?: DependencyArea
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(area?.area ?? '')
  const [level, setLevel] = useState<string>(area?.level ?? '')
  const [transfer, setTransfer] = useState<string>(area?.transfer_status ?? '')
  const [target, setTarget] = useState(area?.target_date ?? '')
  const [note, setNote] = useState(area?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await saveDependencyArea({
      businessId,
      area: name,
      level,
      transferStatus: transfer,
      targetDate: target,
      note,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="의존 영역">
      <label className="text-t10h text-ink-dim">
        영역
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={Boolean(area)}
          className="mt-0.5 block w-[140px] rounded-md border border-line bg-panel px-2 py-1 text-t11h text-ink outline-none focus:border-accent read-only:text-ink-dim"
        />
      </label>
      <label className="text-t10h text-ink-dim">
        회장 의존도
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="mt-0.5 block rounded-md border border-line bg-panel px-2 py-1 text-t11h text-ink outline-none focus:border-accent"
        >
          {/* 첫 항목이 '아직 평가하지 않음'이다. 값이 아니라 사실이라 저장된다. */}
          <option value="">— {DEPENDENCY_LEVEL_EMPTY_KO}</option>
          {DEPENDENCY_LEVEL.map((l) => (
            <option key={l} value={l}>
              {DEPENDENCY_LEVEL_LABEL_KO[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-t10h text-ink-dim">
        이양
        <select
          value={transfer}
          onChange={(e) => setTransfer(e.target.value)}
          className="mt-0.5 block rounded-md border border-line bg-panel px-2 py-1 text-t11h text-ink outline-none focus:border-accent"
        >
          <option value="">— {TRANSFER_STATUS_EMPTY_KO}</option>
          {TRANSFER_STATUS.map((t) => (
            <option key={t} value={t}>
              {TRANSFER_STATUS_LABEL_KO[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-t10h text-ink-dim">
        목표일
        <input
          type="date"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mt-0.5 block rounded-md border border-line bg-panel px-2 py-1 text-t11h text-ink outline-none focus:border-accent"
        />
      </label>
      <label className="min-w-[180px] flex-1 text-t10h text-ink-dim">
        메모 (근거)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1 text-t11h text-ink outline-none focus:border-accent"
        />
      </label>
      {error ? (
        <span role="alert" className="text-t11 text-critical">
          {error}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1.5 text-t11h font-semibold text-app disabled:opacity-40"
      >
        {busy ? '저장 중…' : '저장'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-line px-2.5 py-1.5 text-t11h text-ink-dim hover:text-ink"
      >
        취소
      </button>
    </form>
  )
}
