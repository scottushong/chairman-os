'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { decideTxGroup, saveDedupeSetting } from '@/app/actions/finance-v21'
import type { FinDedupeSetting, FinTxGroup } from '@/types'

/**
 * 0072 «자료 간 같은 거래 한 번만» — 이 달의 묶음(같은 거래 · 중복 의심 · 다른 거래)과 기준 출처 설정.
 * 중복 의심(suspect)은 자동으로 «같은 거래»가 되지 않는다 — 사람이 이유를 적고 정한다. 원천 줄은 고치지 않는다(R2 · ECOUNT 오류는 차이로만).
 */

const STATUS_KO: Record<FinTxGroup['status'], string> = { same: '같은 거래', suspect: '중복 의심', rejected: '다른 거래' }
const STATUS_TONE: Record<FinTxGroup['status'], string> = { same: 'bg-ok/15 text-ok', suspect: 'bg-gold/15 text-gold', rejected: 'bg-raised text-ink-dim' }
const AMOUNT_KO: Record<FinDedupeSetting['amount_base'], string> = { ledger: '회계 원장', tax_invoice: '세금계산서', r2_ecount: 'R2 · ECOUNT' }
const QTY_KO: Record<FinDedupeSetting['qty_base'], string> = { r2_ecount: 'R2 · ECOUNT', ledger: '회계 원장' }

export function FinanceTxPanel({ businessId, month, groups, lines, setting }: { businessId: string; month: string; groups: FinTxGroup[]; lines: Record<string, string>; setting: FinDedupeSetting }) {
  const suspects = groups.filter((g) => g.status === 'suspect')
  const same = groups.filter((g) => g.status === 'same').length
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-t13 font-semibold">자료 간 같은 거래 · {month}</h2>
        <span className="text-t11h text-ink-muted tnum">같은 거래 {same} · 중복 의심 {suspects.length}</span>
      </div>
      <p className="mt-1 text-t10h text-ink-muted">
        R2 · ECOUNT · 회계 원장 · 세금계산서에 같은 거래가 두 번 들어가지 않게 묶습니다(거래처 · 날짜 ±3일 · 품목/계정 · 금액(세전 · 세후) · 수량). 금액만 맞는 것은 «중복 의심»으로 두고 자동으로 넣지 않습니다. 원본 줄은 고치지 않습니다.
      </p>
      {suspects.length ? (
        <ul className="mt-2 space-y-2">
          {suspects.map((g) => (
            <SuspectRow key={g.group_id} g={g} businessId={businessId} lines={lines} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-t11h text-ink-muted">정할 «중복 의심»이 없습니다.</p>
      )}
      {groups.some((g) => g.status !== 'suspect') ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-t11h text-ink-dim">정해진 묶음 {groups.length - suspects.length}</summary>
          <ul className="mt-1 divide-y divide-line-soft">
            {groups.filter((g) => g.status !== 'suspect').map((g) => (
              <li key={g.group_id} className="flex flex-wrap items-center gap-2 py-1 text-t11h">
                <span className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${STATUS_TONE[g.status]}`}>{STATUS_KO[g.status]}</span>
                <span className="min-w-0">{g.members.map((m) => lines[`${m.source_table}:${m.line_id}`] ?? '지난 줄').join(' ↔ ')}</span>
                {g.reason ? <span className="text-ink-muted">이유: {g.reason}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <DedupeSetting businessId={businessId} setting={setting} />
    </section>
  )
}

function SuspectRow({ g, businessId, lines }: { g: FinTxGroup; businessId: string; lines: Record<string, string> }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const decide = (status: 'same' | 'rejected') =>
    start(async () => {
      const r = await decideTxGroup(g.group_id, businessId, status, reason)
      setMsg(r.error ?? (status === 'same' ? '같은 거래로 정했습니다.' : '다른 거래로 풀었습니다(기록은 남습니다).'))
      if (r.ok) router.refresh()
    })
  return (
    <li className="rounded-lg border border-gold/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2 text-t11h">
        <span className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${STATUS_TONE.suspect}`}>중복 의심</span>
        <span className="min-w-0 break-words">{g.members.filter((m) => !m.released).map((m) => lines[`${m.source_table}:${m.line_id}`] ?? '지난 줄').join(' ↔ ')}</span>
      </div>
      <p className="mt-0.5 text-t10h text-ink-muted">맞은 열쇠: {Object.values(g.evidence ?? {}).map(String).join(' · ') || '—'}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="이유(필수)" aria-label="이유" className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-t12h" />
        <button type="button" disabled={busy || reason.trim().length < 2} onClick={() => decide('same')} className="min-h-9 rounded-md bg-accent px-3 text-t11h font-semibold text-white disabled:opacity-40">
          같은 거래
        </button>
        <button type="button" disabled={busy || reason.trim().length < 2} onClick={() => decide('rejected')} className="min-h-9 rounded-md border border-line px-3 text-t11h text-ink-dim disabled:opacity-40">
          다른 거래
        </button>
      </div>
      {msg ? <p role="status" className="mt-1 text-t10h">{msg}</p> : null}
    </li>
  )
}

function DedupeSetting({ businessId, setting }: { businessId: string; setting: FinDedupeSetting }) {
  const router = useRouter()
  const [amount, setAmount] = useState(setting.amount_base)
  const [qty, setQty] = useState(setting.qty_base)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const changed = amount !== setting.amount_base || qty !== setting.qty_base
  return (
    <details className="mt-3 rounded-lg border border-line-soft px-2.5 py-2">
      <summary className="cursor-pointer text-t11h text-ink-dim">
        기준 출처 — 금액 {AMOUNT_KO[setting.amount_base]} · 수량 {QTY_KO[setting.qty_base]}
      </summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <label className="text-t10h text-ink-muted">
          금액 기준
          <select value={amount} onChange={(e) => setAmount(e.target.value as typeof amount)} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink">
            {Object.entries(AMOUNT_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-t10h text-ink-muted">
          수량 기준
          <select value={qty} onChange={(e) => setQty(e.target.value as typeof qty)} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink">
            {Object.entries(QTY_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-t10h text-ink-muted sm:col-span-2">
          이유(필수)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink" />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || !changed || reason.trim().length < 2}
        onClick={() =>
          start(async () => {
            const r = await saveDedupeSetting(businessId, amount, qty, reason)
            setMsg(r.error ?? '바꿨습니다. 다음 묶음부터 이 기준을 씁니다.')
            if (r.ok) router.refresh()
          })
        }
        className="mt-2 min-h-9 rounded-md border border-line px-3 text-t11h text-ink-dim hover:border-accent disabled:opacity-40"
      >
        기준 바꾸기
      </button>
      {msg ? <p role="status" className="mt-1 text-t10h">{msg}</p> : null}
    </details>
  )
}
