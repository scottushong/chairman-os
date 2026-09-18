'use client'

import { useState } from 'react'

import {
  removeInitiativeKeymanAction,
  removeKeyman,
  saveInitiativeKeymanAction,
  saveKeyman,
} from '@/app/actions/keymen'
import { Icon } from '@/components/ui/icon'
import { dDay } from '@/lib/format'
import {
  KEYMAN_CHANNEL,
  KEYMAN_CHANNEL_LABEL_KO,
  type BusinessKeyman,
  type InitiativeKeyman,
  type KeymanChannel,
} from '@/types'

/**
 * CH-024 확장 — 키맨 (0015 business_keymen / 0017 initiative_keymen).
 *
 * 이 회사(또는 이 건)를 움직이는 사람과, 마지막으로 언제 닿았나. 최근 접촉이 오래된 사람이
 * 위로 온다 — 회장이 이 패널을 여는 이유는 '누구에게 연락할 때가 됐나'다.
 *
 * 90일을 넘긴 접촉만 색을 준다(색은 위험에만). 기록이 없는 사람은 색 없이 '기록 없음'이다 —
 * 오래 연락 안 한 것과 기록을 안 한 것은 다르고, 둘을 같은 빨강으로 칠하면 기록하지 않는 편이 조용해진다.
 *
 * 회사 키맨과 이니셔티브 키맨은 같은 모양이라 패널이 두 벌일 이유가 없다(Phase 4-A Task 7).
 * 두 액션 쌍(saveKeyman/removeKeyman, saveInitiativeKeymanAction/removeInitiativeKeymanAction)을
 * 이 컴포넌트가 직접 import해서 `scope.kind`로 분기한다 — 함수를 prop으로 넘기면 호출부마다
 * 어댑터를 한 겹씩 더 쓰게 된다. 채널(연락 수단) 칸은 이니셔티브 키맨에만 있다 —
 * business_keymen에는 그 칸이 없다. 회사 키맨 쪽에 채널을 추가하지 않는다.
 *
 * canEdit은 안내지 판정이 아니다. 0015의 business_keymen_write / 0017의
 * initiative_keymen_write가 실제 문이다.
 */

const STALE_DAYS = 90

export type KeymenScope =
  | { kind: 'business'; businessId: string }
  | { kind: 'initiative'; initiativeId: string }

type KeymanRow = BusinessKeyman | InitiativeKeyman

interface Draft {
  keymanId?: string
  name: string
  relation: string
  channel: KeymanChannel
  lastContactOn: string
  note: string
}

const EMPTY: Draft = { name: '', relation: '', channel: 'Other', lastContactOn: '', note: '' }

export function KeymenPanel({
  scope,
  keymen,
  canEdit,
}: {
  scope: KeymenScope
  keymen: KeymanRow[]
  canEdit: boolean
}) {
  const [list, setList] = useState<KeymanRow[]>(keymen)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...list].sort((a, b) => {
    // 기록 없음은 맨 아래, 나머지는 오래된 접촉부터
    if (a.last_contact_on === b.last_contact_on) return a.name.localeCompare(b.name)
    if (a.last_contact_on === null) return 1
    if (b.last_contact_on === null) return -1
    return a.last_contact_on.localeCompare(b.last_contact_on)
  })

  const roleHint = scope.kind === 'business' ? 'Chairman / Business CEO' : '회장 / 그룹 CFO'

  async function submit() {
    if (!draft || busy) return
    setBusy(true)
    setError(null)
    const result =
      scope.kind === 'business'
        ? await saveKeyman({
            keymanId: draft.keymanId,
            businessId: scope.businessId,
            name: draft.name,
            relation: draft.relation,
            lastContactOn: draft.lastContactOn,
            note: draft.note,
          })
        : await saveInitiativeKeymanAction({
            keymanId: draft.keymanId,
            initiativeId: scope.initiativeId,
            name: draft.name,
            relation: draft.relation,
            channel: draft.channel,
            lastContactOn: draft.lastContactOn,
            note: draft.note,
          })
    setBusy(false)
    if (result.error || !result.keyman) {
      setError(result.error ?? '저장하지 못했습니다.')
      return
    }
    const saved = result.keyman
    setList((l) => [...l.filter((k) => k.keyman_id !== saved.keyman_id), saved])
    setDraft(null)
  }

  async function remove(k: KeymanRow) {
    if (busy) return
    setBusy(true)
    setError(null)
    const result =
      scope.kind === 'business'
        ? await removeKeyman(k.keyman_id, scope.businessId)
        : await removeInitiativeKeymanAction(k.keyman_id, scope.initiativeId)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setList((l) => l.filter((x) => x.keyman_id !== k.keyman_id))
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="users" className="size-4 text-ink-dim" />
          키맨
          <span className="text-[11px] font-normal text-ink-muted tnum">{list.length}명</span>
        </h2>
        <span className="flex items-center gap-2">
          {canEdit && !draft ? (
            <button
              type="button"
              onClick={() => {
                setError(null)
                setDraft(EMPTY)
              }}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
            >
              <Icon name="plus" className="size-3" />
              추가
            </button>
          ) : null}
          {scope.kind === 'business' ? (
            <span className="text-[9px] text-ink-muted tnum">CH-024</span>
          ) : null}
        </span>
      </div>

      {error ? (
        <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}

      {draft ? (
        <div
          className={`mt-2.5 grid gap-2 rounded-lg bg-raised/60 p-2.5 md:grid-cols-4 ${
            scope.kind === 'initiative' ? 'xl:grid-cols-5' : ''
          }`}
        >
          <Field label="이름" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={60} />
          <Field
            label="관계"
            value={draft.relation}
            placeholder="예: 주거래처 구매팀장"
            onChange={(relation) => setDraft({ ...draft, relation })}
            maxLength={300}
          />
          {scope.kind === 'initiative' ? (
            <label className="block text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
              채널
              <select
                value={draft.channel}
                onChange={(e) => setDraft({ ...draft, channel: e.target.value as KeymanChannel })}
                className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-normal text-ink outline-none focus:border-accent"
              >
                {KEYMAN_CHANNEL.map((c) => (
                  <option key={c} value={c}>
                    {KEYMAN_CHANNEL_LABEL_KO[c]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Field
            label="최근 접촉일"
            type="date"
            value={draft.lastContactOn}
            onChange={(lastContactOn) => setDraft({ ...draft, lastContactOn })}
          />
          <Field label="메모" value={draft.note} onChange={(note) => setDraft({ ...draft, note })} maxLength={300} />
          <div className="flex items-center gap-1.5 md:col-span-4 xl:col-span-5">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={busy}
              className="rounded px-2 py-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}

      {sorted.length === 0 && !draft ? (
        <p className="py-5 text-center text-[12px] text-ink-muted">
          등록된 키맨이 없습니다.
          {canEdit ? '' : ` 등록은 ${roleHint}만 할 수 있습니다.`}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line-soft">
          {sorted.map((k) => {
            const days = k.last_contact_on ? -dDay(k.last_contact_on) : null
            return (
              <li key={k.keyman_id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold">
                    {k.name}
                    <span className="ml-1.5 text-[11px] font-normal text-ink-muted">{k.relation}</span>
                  </p>
                  {k.note ? <p className="truncate text-[11px] text-ink-muted">{k.note}</p> : null}
                </div>
                {scope.kind === 'initiative' ? (
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    {KEYMAN_CHANNEL_LABEL_KO[(k as InitiativeKeyman).channel]}
                  </span>
                ) : null}
                <span
                  className={`shrink-0 text-[11px] tnum ${
                    days !== null && days > STALE_DAYS ? 'font-semibold text-critical' : 'text-ink-dim'
                  }`}
                  title={k.last_contact_on ?? '기록 없음'}
                >
                  {days === null ? '접촉 기록 없음' : days === 0 ? '오늘 접촉' : `${days}일 전 접촉`}
                </span>
                {canEdit ? (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`${k.name} 고치기`}
                      onClick={() => {
                        setError(null)
                        setDraft({
                          keymanId: k.keyman_id,
                          name: k.name,
                          relation: k.relation,
                          channel: scope.kind === 'initiative' ? (k as InitiativeKeyman).channel : 'Other',
                          lastContactOn: k.last_contact_on ?? '',
                          note: k.note,
                        })
                      }}
                      className="rounded p-1 text-ink-muted hover:text-accent"
                    >
                      <Icon name="pencil" className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${k.name} 지우기`}
                      onClick={() => remove(k)}
                      disabled={busy}
                      className="rounded px-1 text-[11px] text-ink-muted hover:text-critical disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'date'
  placeholder?: string
  maxLength?: number
}) {
  return (
    <label className="block text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-normal text-ink outline-none placeholder:text-ink-muted focus:border-accent"
      />
    </label>
  )
}
