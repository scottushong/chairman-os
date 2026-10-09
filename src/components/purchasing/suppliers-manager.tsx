'use client'

import { useState } from 'react'

import { saveSupplierAction } from '@/app/actions/purchasing'
import { Icon } from '@/components/ui/icon'
import type { CostSupplier } from '@/types'

import { Alert, BTN, BTN_PRIMARY, CURRENCIES, FIELD, LABEL, LINK_BTN, Notice } from './shared'

/**
 * 공급처 — 이름 · 나라 · 기본 통화 · 연락처 · 조건 · 사용 · 메모(0061 cost_suppliers). 연락처 · 조건은 [제한]: 구매 · 원가 관리 · 대표만 이 표를 읽는다.
 */

interface Draft {
  id?: string
  name: string
  country: string
  currency_default: string
  contact: string
  terms: string
  active: boolean
  note: string
}

const EMPTY: Draft = { name: '', country: '대한민국', currency_default: 'KRW', contact: '', terms: '', active: true, note: '' }

export function SuppliersManager({
  businessId,
  suppliers,
  canEdit,
}: {
  businessId: string
  suppliers: CostSupplier[]
  canEdit: boolean
}) {
  const [list, setList] = useState(suppliers)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function save() {
    if (!draft || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const r = await saveSupplierAction({ businessId, supplierId: draft.id, ...draft })
    setBusy(false)
    if (r.error || !r.supplier) {
      setError(r.error ?? '저장하지 못했습니다.')
      return
    }
    const saved = r.supplier
    setList((l) => [...l.filter((s) => s.supplier_id !== saved.supplier_id), saved].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    setNotice(`${saved.name} — 저장했습니다.`)
    setDraft(null)
  }

  const currencies: readonly string[] = draft && !CURRENCIES.includes(draft.currency_default as never) ? [...CURRENCIES, draft.currency_default] : CURRENCIES

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-t11h text-ink-dim">
          <span className="tnum">{list.filter((s) => s.active).length}</span>곳 사용 중 · 연락처 · 조건은 구매 · 원가 관리만 봅니다
        </p>
        {canEdit && !draft ? (
          <button type="button" className={BTN} onClick={() => setDraft(EMPTY)}>
            <Icon name="plus" className="size-3" />
            공급처 추가
          </button>
        ) : null}
      </div>

      <Alert text={error} />
      <Notice text={notice} />

      {draft ? (
        <section className="rounded-xl border border-line-soft bg-panel p-3">
          <h2 className="text-t12h font-semibold">{draft.id ? '공급처 고치기' : '새 공급처'}</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <label className={LABEL}>
              이름
              <input className={`${FIELD} mt-0.5`} value={draft.name} maxLength={120} disabled={busy} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className={LABEL}>
              나라
              <input className={`${FIELD} mt-0.5`} value={draft.country} maxLength={60} disabled={busy} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
            </label>
            <label className={LABEL}>
              기본 통화
              <select
                className={`${FIELD} mt-0.5`}
                value={draft.currency_default}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, currency_default: e.target.value })}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-1.5 self-end text-t12 lg:min-h-0 lg:pb-1">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={draft.active}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              사용
            </label>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <label className={LABEL}>
              연락처
              <textarea className={`${FIELD} mt-0.5 min-h-14`} value={draft.contact} maxLength={500} disabled={busy} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} />
            </label>
            <label className={LABEL}>
              조건(결제 · 인도)
              <textarea className={`${FIELD} mt-0.5 min-h-14`} value={draft.terms} maxLength={500} disabled={busy} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} />
            </label>
            <label className={LABEL}>
              메모
              <textarea className={`${FIELD} mt-0.5 min-h-14`} value={draft.note} maxLength={500} disabled={busy} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={save}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" className={LINK_BTN} disabled={busy} onClick={() => setDraft(null)}>
              취소
            </button>
          </div>
        </section>
      ) : null}

      {list.length === 0 ? (
        <section className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center">
          <p className="text-t13 text-ink-dim">공급처가 아직 없습니다.</p>
        </section>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent">
          <table className="m-cards w-full text-t12 sm:min-w-[820px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                <th className="px-3 py-2 font-normal">이름</th>
                <th className="px-3 py-2 font-normal">나라</th>
                <th className="px-3 py-2 font-normal">통화</th>
                <th className="px-3 py-2 font-normal">연락처</th>
                <th className="px-3 py-2 font-normal">조건</th>
                <th className="px-3 py-2 text-right font-normal">{canEdit ? '관리' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.supplier_id} className={`border-t border-line-soft ${s.active ? '' : 'text-ink-muted'}`}>
                  <td className="px-3 py-1.5 max-sm:font-semibold">
                    <span>
                      {s.name}
                      {!s.active ? <span className="ml-1.5 rounded border border-line px-1 text-t9h">사용 안 함</span> : null}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-dim" data-label="나라">
                    {s.country || '—'}
                  </td>
                  <td className="px-3 py-1.5 tnum text-ink-dim" data-label="통화">
                    {s.currency_default}
                  </td>
                  <td className="px-3 py-1.5 text-t11 text-ink-dim whitespace-pre-line" data-label="연락처">
                    {s.contact || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-t11 text-ink-dim whitespace-pre-line" data-label="조건">
                    {s.terms || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right" data-label={canEdit ? '관리' : undefined}>
                    {canEdit ? (
                      <button
                        type="button"
                        className={LINK_BTN}
                        disabled={busy}
                        onClick={() => {
                          setError(null)
                          setDraft({
                            id: s.supplier_id,
                            name: s.name,
                            country: s.country,
                            currency_default: s.currency_default,
                            contact: s.contact,
                            terms: s.terms,
                            active: s.active,
                            note: s.note,
                          })
                        }}
                      >
                        고치기
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
