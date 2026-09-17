'use client'

import { useState } from 'react'

import { applyStandardChart, createAccount, setAccountActive, updateAccount } from '@/app/actions/books'
import { Icon } from '@/components/ui/icon'
import { SECTION_CATEGORIES } from '@/lib/ledger/accounts'
import {
  ACCOUNT_CATEGORY_LABEL_KO,
  ACCOUNT_SECTION,
  ACCOUNT_SECTION_LABEL_KO,
  CASH_FLOW_CLASS,
  CASH_FLOW_CLASS_LABEL_KO,
  type Account,
  type AccountCategory,
  type AccountSection,
  type CashFlowClass,
} from '@/types'

/**
 * 계정과목 목록·추가·수정·비활성화 (Phase 2-B 블록 1).
 *
 * 구분(재무제표의 줄) 순서로 묶는다 — 장부를 쓰는 사람이 계정을 찾는 순서가 그것이다.
 * 구분을 고르면 대분류 선택지가 좁혀진다. 0015의 accounts_category_section과 같은 표(lib/ledger/accounts.ts)다.
 *
 * canEdit은 안내지 판정이 아니다. 0016의 can_keep_books()가 실제 문이다.
 */

interface Draft {
  code: string
  name: string
  section: AccountSection
  category: AccountCategory
  cashFlow: CashFlowClass | ''
}

const EMPTY: Draft = { code: '', name: '', section: 'sga', category: 'other', cashFlow: '' }

const input =
  'w-full rounded border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50'

export function AccountsManager({
  businessId,
  accounts,
  usedCodes,
  canEdit,
  usesEcountCodes,
}: {
  businessId: string
  accounts: Account[]
  usedCodes: string[]
  canEdit: boolean
  usesEcountCodes: boolean
}) {
  const [list, setList] = useState(accounts)
  const [adding, setAdding] = useState<Draft | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const used = new Set(usedCodes)
  const inactiveCount = list.filter((a) => !a.active).length
  const visible = list.filter((a) => showInactive || a.active)

  function upsert(saved: Account) {
    setList((l) =>
      [...l.filter((a) => a.account_code !== saved.account_code), saved].sort((a, b) =>
        a.account_code.localeCompare(b.account_code),
      ),
    )
  }

  async function run<T extends { error?: string }>(work: () => Promise<T>): Promise<T | null> {
    if (busy) return null
    setBusy(true)
    setError(null)
    setNotice(null)
    const result = await work()
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return null
    }
    return result
  }

  async function submitNew() {
    if (!adding) return
    const result = await run(() => createAccount({ businessId, ...adding }))
    if (result?.account) {
      upsert(result.account)
      setAdding(null)
      setNotice(`${result.account.account_code} ${result.account.name} 계정을 만들었습니다.`)
    }
  }

  async function submitEdit() {
    if (!editing) return
    const result = await run(() => updateAccount({ businessId, ...editing }))
    if (result?.account) {
      upsert(result.account)
      setEditing(null)
    }
  }

  async function toggle(a: Account) {
    const result = await run(() => setAccountActive({ businessId, code: a.account_code, active: !a.active }))
    if (result?.account) upsert(result.account)
  }

  async function standard() {
    const result = await run(() => applyStandardChart(businessId))
    if (result) {
      setNotice(`표준 계정과목표에서 ${result.added ?? 0}개 계정을 넣었습니다. 새로고침하면 목록에 섭니다.`)
      // 넣은 행을 받아 오지 않는다. 서버가 다시 그린 목록이 원천이다.
      window.location.reload()
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-ink-muted">
          <span className="tnum">{list.length - inactiveCount}</span>개 사용 중
          {inactiveCount > 0 ? (
            <>
              {' '}· <span className="tnum">{inactiveCount}</span>개 비활성{' '}
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className="text-ink-dim underline-offset-2 hover:text-ink hover:underline"
              >
                {showInactive ? '숨기기' : '보기'}
              </button>
            </>
          ) : null}
          {usesEcountCodes ? ' · ECOUNT 코드 체계 (업로드 때 매핑)' : ''}
        </p>
        {canEdit && !adding ? (
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setError(null)
              setAdding(EMPTY)
            }}
            className="flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            <Icon name="plus" className="size-3" />
            계정 추가
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border border-line-soft bg-raised/60 px-2.5 py-1.5 text-[11.5px] text-ink-dim">
          {notice}
        </p>
      ) : null}

      {adding ? (
        <section className="rounded-xl border border-line-soft bg-panel p-3">
          <h2 className="text-[12.5px] font-semibold">새 계정</h2>
          <AccountFields draft={adding} onChange={setAdding} withCode disabled={busy} />
          <FormButtons busy={busy} onSave={submitNew} onCancel={() => setAdding(null)} />
        </section>
      ) : null}

      {list.length === 0 ? (
        <section className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center">
          <p className="text-[13px] text-ink-dim">이 회사에는 계정과목이 없습니다.</p>
          {usesEcountCodes ? (
            <p className="mt-1 text-[11.5px] text-ink-muted">ECOUNT 엑셀 업로드 때 계정이 코드 그대로 들어옵니다.</p>
          ) : canEdit ? (
            <button
              type="button"
              onClick={standard}
              disabled={busy}
              className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40"
            >
              {busy ? '적용 중…' : '표준 계정과목표 적용 (한국 중소기업)'}
            </button>
          ) : null}
        </section>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-[10.5px] text-ink-muted">
                <th className="px-3 py-2 font-normal">코드</th>
                <th className="px-3 py-2 font-normal">계정명</th>
                <th className="px-3 py-2 font-normal">대분류</th>
                <th className="px-3 py-2 font-normal">현금흐름</th>
                <th className="px-3 py-2 font-normal">원천</th>
                <th className="px-3 py-2 text-right font-normal">{canEdit ? '관리' : ''}</th>
              </tr>
            </thead>
            {ACCOUNT_SECTION.map((section) => {
              const rows = visible.filter((a) => a.section === section)
              if (rows.length === 0) return null
              return (
                <tbody key={section}>
                  <tr>
                    <th colSpan={6} className="bg-raised/50 px-3 py-1 text-left text-[10.5px] font-semibold text-ink-dim">
                      {ACCOUNT_SECTION_LABEL_KO[section]}
                    </th>
                  </tr>
                  {rows.map((a) =>
                    editing?.code === a.account_code ? (
                      <tr key={a.account_code} className="border-t border-line-soft">
                        <td colSpan={6} className="px-3 py-2">
                          <p className="text-[11px] text-ink-muted">
                            <span className="tnum font-semibold text-ink">{a.account_code}</span> 수정 — 코드는 바뀌지 않습니다
                          </p>
                          <AccountFields draft={editing} onChange={setEditing} disabled={busy} />
                          <FormButtons busy={busy} onSave={submitEdit} onCancel={() => setEditing(null)} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={a.account_code} className={`border-t border-line-soft ${a.active ? '' : 'text-ink-muted'}`}>
                        <td className="px-3 py-1.5 tnum">{a.account_code}</td>
                        <td className="px-3 py-1.5">
                          {a.name}
                          {!a.active ? <span className="ml-1.5 rounded border border-line px-1 text-[9.5px]">비활성</span> : null}
                          {used.has(a.account_code) ? (
                            <span className="ml-1.5 text-[9.5px] text-ink-muted" title="전표가 이 계정을 쓰고 있어 지울 수 없습니다">
                              전표 있음
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-ink-dim">{ACCOUNT_CATEGORY_LABEL_KO[a.category]}</td>
                        <td className="px-3 py-1.5 text-ink-dim">{a.cash_flow ? CASH_FLOW_CLASS_LABEL_KO[a.cash_flow] : '—'}</td>
                        <td className="px-3 py-1.5 text-[11px] text-ink-muted">{a.source === 'ecount' ? 'ECOUNT' : '자체'}</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          {canEdit ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setAdding(null)
                                  setError(null)
                                  setEditing({
                                    code: a.account_code,
                                    name: a.name,
                                    section: a.section,
                                    category: a.category,
                                    cashFlow: a.cash_flow ?? '',
                                  })
                                }}
                                className="rounded px-1.5 py-0.5 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => toggle(a)}
                                className="rounded px-1.5 py-0.5 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40"
                              >
                                {a.active ? '비활성화' : '다시 사용'}
                              </button>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              )
            })}
          </table>
        </section>
      )}
    </div>
  )
}

function AccountFields({
  draft,
  onChange,
  withCode = false,
  disabled,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  withCode?: boolean
  disabled: boolean
}) {
  const categories = SECTION_CATEGORIES[draft.section]
  return (
    <div className={`mt-2 grid gap-2 ${withCode ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
      {withCode ? (
        <label className="text-[10.5px] text-ink-muted">
          계정코드
          <input
            className={`${input} mt-0.5 tnum`}
            value={draft.code}
            maxLength={20}
            placeholder="예: 8360"
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, code: e.target.value })}
          />
        </label>
      ) : null}
      <label className="text-[10.5px] text-ink-muted">
        계정명
        <input
          className={`${input} mt-0.5`}
          value={draft.name}
          maxLength={60}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>
      <label className="text-[10.5px] text-ink-muted">
        구분 (재무제표 줄)
        <select
          className={`${input} mt-0.5`}
          value={draft.section}
          disabled={disabled}
          onChange={(e) => {
            const section = e.target.value as AccountSection
            const allowed = SECTION_CATEGORIES[section]
            onChange({ ...draft, section, category: allowed.includes(draft.category) ? draft.category : allowed[0] })
          }}
        >
          {ACCOUNT_SECTION.map((s) => (
            <option key={s} value={s}>
              {ACCOUNT_SECTION_LABEL_KO[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[10.5px] text-ink-muted">
        대분류 (원가 구조)
        <select
          className={`${input} mt-0.5`}
          value={draft.category}
          disabled={disabled || categories.length === 1}
          onChange={(e) => onChange({ ...draft, category: e.target.value as AccountCategory })}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {ACCOUNT_CATEGORY_LABEL_KO[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[10.5px] text-ink-muted">
        현금흐름
        <select
          className={`${input} mt-0.5`}
          value={draft.cashFlow}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, cashFlow: e.target.value as CashFlowClass | '' })}
        >
          <option value="">없음 (현금 자신 · 손익 · 비현금)</option>
          {CASH_FLOW_CLASS.map((c) => (
            <option key={c} value={c}>
              {CASH_FLOW_CLASS_LABEL_KO[c]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function FormButtons({ busy, onSave, onCancel }: { busy: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="rounded bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-ink disabled:opacity-40"
      >
        {busy ? '저장 중…' : '저장'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded px-2 py-1 text-[11.5px] text-ink-muted hover:text-ink disabled:opacity-40"
      >
        취소
      </button>
    </div>
  )
}
