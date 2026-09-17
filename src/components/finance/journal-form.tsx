'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { postJournalEntry } from '@/app/actions/books'
import { Icon } from '@/components/ui/icon'
import { CLOSED_PERIOD_MESSAGE } from '@/lib/ledger/journal'
import { JOURNAL_TEMPLATES, type JournalTemplate } from '@/lib/ledger/journal-templates'
import { ACCOUNT_SECTION, ACCOUNT_SECTION_LABEL_KO, type AccountSection } from '@/types'

/**
 * 전표 입력 (Phase 2-B 블록 2).
 *
 * 헤더(일자·적요·증빙링크) + 라인 N개(계정·차변·대변). 한 줄에는 차변이나 대변 중 한쪽만 쓴다.
 * 차변 합 = 대변 합이 아니면 저장 버튼이 잠긴다 — DB도 같은 규칙으로 거부한다(0016 journal_slip_balanced).
 *
 * 마감된 달(또는 그 이전) 날짜를 고르면 저장 대신 '정정 전표로 입력' 안내가 선다.
 * 그 판정은 화면 안내다. 실제로 막는 것은 DB 트리거(closed_period)다.
 */

export interface FormAccount {
  account_code: string
  name: string
  section: AccountSection
}

interface Row {
  account_code: string
  debit: string
  credit: string
}

const EMPTY_ROW: Row = { account_code: '', debit: '', credit: '' }

const input =
  'w-full rounded border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50'

/** '1,000,000' → 1000000. 비었거나 숫자가 아니면 0 — 합계에서만 쓴다. 저장 검증은 서버가 한다. */
function won(value: string): number {
  const n = Number(value.replaceAll(',', '').trim())
  return Number.isFinite(n) ? n : 0
}

function withCommas(value: string): string {
  const digits = value.replace(/[^0-9]/g, '')
  return digits ? Number(digits).toLocaleString('ko-KR') : ''
}

export function JournalForm({
  businessId,
  accounts,
  lockedThrough,
  defaultDate,
}: {
  businessId: string
  /** 사용 중인 계정만 */
  accounts: FormAccount[]
  /** 마지막 마감 달. 이 달과 그 이전은 입력할 수 없다 */
  lockedThrough: string | null
  defaultDate: string
}) {
  const router = useRouter()
  const [date, setDate] = useState(defaultDate)
  const [memo, setMemo] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [rows, setRows] = useState<Row[]>([EMPTY_ROW, EMPTY_ROW])
  const [templateAmount, setTemplateAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const known = new Set(accounts.map((a) => a.account_code))
  const debit = rows.reduce((s, r) => s + won(r.debit), 0)
  const credit = rows.reduce((s, r) => s + won(r.credit), 0)
  const filled = rows.filter((r) => r.account_code || r.debit || r.credit)
  const balanced = debit > 0 && debit === credit
  const locked = lockedThrough !== null && date.slice(0, 7) <= lockedThrough
  const bothSides = filled.some((r) => won(r.debit) > 0 && won(r.credit) > 0)

  function applyTemplate(t: JournalTemplate) {
    const amount = withCommas(templateAmount)
    setRows(
      t.lines.map((l) => ({
        // 이 회사에 없거나 비활성인 계정은 비워 둔다. 없는 계정으로 조용히 채우지 않는다.
        account_code: known.has(l.code) ? l.code : '',
        debit: l.side === 'debit' ? amount : '',
        credit: l.side === 'credit' ? amount : '',
      })),
    )
    setMemo(t.memo)
    setError(null)
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function submit() {
    if (busy) return
    setError(null)
    setSaved(null)
    if (bothSides) {
      setError('한 줄에는 차변이나 대변 중 한쪽만 씁니다.')
      return
    }
    setBusy(true)
    const result = await postJournalEntry({
      businessId,
      entryDate: date,
      memo,
      evidenceUrl,
      lines: filled.map((r) => ({
        account_code: r.account_code,
        side: won(r.debit) > 0 ? 'debit' : 'credit',
        amount: String(won(r.debit) > 0 ? won(r.debit) : won(r.credit)),
      })),
    })
    setBusy(false)
    if (result.error || !result.slipNo) {
      setError(result.error ?? '저장하지 못했습니다.')
      return
    }
    setSaved(result.slipNo)
    setMemo('')
    setEvidenceUrl('')
    setRows([EMPTY_ROW, EMPTY_ROW])
    setTemplateAmount('')
    router.refresh()
  }

  const bySection = ACCOUNT_SECTION.map((s) => ({
    section: s,
    accounts: accounts.filter((a) => a.section === s),
  })).filter((g) => g.accounts.length > 0)

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3.5" aria-label="전표 입력">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="pencil" className="size-4 text-ink-dim" />
          전표 입력
        </h2>
        <p className="text-[10.5px] text-ink-muted">
          {lockedThrough ? `${lockedThrough.replace('-', '년 ')}월까지 마감 — 그 이전 날짜는 입력할 수 없습니다` : '마감된 달 없음'}
        </p>
      </div>

      <div className="mt-2.5 flex flex-wrap items-end gap-1.5">
        <label className="text-[10.5px] text-ink-muted">
          템플릿 금액
          <input
            className={`${input} mt-0.5 w-32 text-right tnum`}
            value={templateAmount}
            inputMode="numeric"
            placeholder="0"
            disabled={busy}
            onChange={(e) => setTemplateAmount(withCommas(e.target.value))}
          />
        </label>
        {JOURNAL_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={busy}
            onClick={() => applyTemplate(t)}
            className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-2.5 grid gap-2 md:grid-cols-[150px_1fr_1fr]">
        <label className="text-[10.5px] text-ink-muted">
          일자
          <input type="date" className={`${input} mt-0.5`} value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-[10.5px] text-ink-muted">
          적요
          <input
            className={`${input} mt-0.5`}
            value={memo}
            maxLength={200}
            placeholder="예: 8월 SaaS 구독 매출"
            disabled={busy}
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>
        <label className="text-[10.5px] text-ink-muted">
          증빙 링크 (선택)
          <input
            className={`${input} mt-0.5`}
            value={evidenceUrl}
            placeholder="https://… 사내 스토리지"
            disabled={busy}
            onChange={(e) => setEvidenceUrl(e.target.value)}
          />
        </label>
      </div>

      <table className="mt-2.5 w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] text-ink-muted">
            <th className="w-8 py-1 font-normal">#</th>
            <th className="py-1 font-normal">계정</th>
            <th className="w-40 py-1 text-right font-normal">차변</th>
            <th className="w-40 py-1 text-right font-normal">대변</th>
            <th className="w-10 py-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line-soft">
              <td className="py-1 text-[11px] text-ink-muted tnum">{i + 1}</td>
              <td className="py-1 pr-2">
                <select
                  aria-label={`${i + 1}번째 줄 계정`}
                  className={input}
                  value={r.account_code}
                  disabled={busy}
                  onChange={(e) => setRow(i, { account_code: e.target.value })}
                >
                  <option value="">계정 선택</option>
                  {bySection.map((g) => (
                    <optgroup key={g.section} label={ACCOUNT_SECTION_LABEL_KO[g.section]}>
                      {g.accounts.map((a) => (
                        <option key={a.account_code} value={a.account_code}>
                          {a.account_code} {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-2">
                <input
                  aria-label={`${i + 1}번째 줄 차변`}
                  className={`${input} text-right tnum`}
                  value={r.debit}
                  inputMode="numeric"
                  disabled={busy}
                  onChange={(e) => setRow(i, { debit: withCommas(e.target.value) })}
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  aria-label={`${i + 1}번째 줄 대변`}
                  className={`${input} text-right tnum`}
                  value={r.credit}
                  inputMode="numeric"
                  disabled={busy}
                  onChange={(e) => setRow(i, { credit: withCommas(e.target.value) })}
                />
              </td>
              <td className="py-1 text-right">
                {rows.length > 2 ? (
                  <button
                    type="button"
                    aria-label={`${i + 1}번째 줄 지우기`}
                    disabled={busy}
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    className="rounded px-1.5 text-[12px] text-ink-muted hover:text-critical disabled:opacity-40"
                  >
                    ×
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          <tr className="border-t border-line">
            <td />
            <td className="py-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setRows((rs) => [...rs, EMPTY_ROW])}
                className="flex items-center gap-1 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40"
              >
                <Icon name="plus" className="size-3" />줄 추가
              </button>
            </td>
            <td className="py-1.5 pr-2 text-right font-semibold tnum">{debit.toLocaleString('ko-KR')}</td>
            <td className="py-1.5 pr-2 text-right font-semibold tnum">{credit.toLocaleString('ko-KR')}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !balanced || locked}
          className="rounded bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40"
        >
          {busy ? '저장 중…' : '전표 저장'}
        </button>
        {locked ? (
          <span role="alert" className="text-[11.5px] text-critical">
            {CLOSED_PERIOD_MESSAGE}
          </span>
        ) : debit === 0 && credit === 0 ? (
          <span className="text-[11.5px] text-ink-muted">금액을 입력하세요.</span>
        ) : balanced ? (
          <span className="text-[11.5px] text-ok">차대 일치</span>
        ) : (
          <span className="text-[11.5px] text-critical tnum">
            차대 불일치 — 차이 {Math.abs(debit - credit).toLocaleString('ko-KR')}원
          </span>
        )}
        {saved ? (
          <span role="status" className="text-[11.5px] text-ink-dim">
            저장했습니다: <span className="tnum font-semibold text-ink">{saved}</span> · 잠정
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}
    </section>
  )
}
