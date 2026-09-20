'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { saveOfficialStatement } from '@/app/actions/statements'
import { Icon } from '@/components/ui/icon'
import {
  BALANCE_SHEET_SECTIONS,
  INCOME_SECTIONS,
  balanceCheck,
  incomeSubtotals,
  type StatementLine,
} from '@/lib/statements/balance'
import { formatEok } from '@/lib/format'
import { ACCOUNT_SECTION_LABEL_KO, type Account, type AccountSection } from '@/types'

/**
 * 공식 재무제표 입력 (Phase 2-C 블록 1).
 *
 * **부호를 화면에서 숨긴다.** 원장은 amount = 차변 − 대변이라 매출·부채·자본이 음수로 앉는데,
 * 회장에게 "매출에 -700억을 넣으세요"라고 할 수는 없다. 입력 칸은 전부 사람이 읽는 양수로 받고,
 * 저장 직전에 대변 구분만 부호를 뒤집는다. 그 뒤집기가 이 파일의 유일한 규약이고
 * lib/statements/balance.ts가 읽는 쪽에서 같은 규약을 되돌린다.
 *
 * 소계는 입력이 아니다. 매출총이익·영업이익·당기순이익·자산합계는 계산된 줄이라 칸이 없다 —
 * 손으로 넣게 두면 그 값이 구성 항목의 합과 달라지는 재무제표가 만들어진다.
 *
 * 저장 버튼은 재무상태표가 닫히기 전까지 안 눌린다. 안 맞는 숫자가 **확정** 꼬리표를 달면
 * 그 뒤의 모든 화면이 틀린 값을 확정으로 말한다. 잠정은 고쳐지지만 확정은 신뢰의 근거다.
 */

/** 대변이 정상인 구분. 화면의 양수를 원장의 음수로 뒤집는다. */
const CREDIT_SECTIONS: AccountSection[] = [
  'revenue',
  'payable',
  'other_liability',
  'equity',
  'non_operating',
]

function toLedgerAmount(section: AccountSection, entered: number): number {
  return CREDIT_SECTIONS.includes(section) ? -entered : entered
}

/** 천 단위 쉼표까지 받아 숫자로. 빈 칸은 0이다(입력하지 않은 계정). */
function readAmount(raw: string): number {
  const bare = raw.replace(/[,\s₩]/g, '')
  if (bare === '' || bare === '-') return 0
  const value = Number(bare)
  return Number.isFinite(value) ? Math.round(value) : 0
}

const won = (n: number) => n.toLocaleString('ko-KR')

interface StatementEditorProps {
  businessId: string
  businessName: string
  accounts: Account[]
  /** 이미 활성 결산이 있는 기간. 덮어쓰기 확인을 띄울 때 쓴다. */
  existingPeriods: { kind: 'year' | 'quarter'; key: string; memo: string }[]
}

export function StatementEditor({
  businessId,
  businessName,
  accounts,
  existingPeriods,
}: StatementEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [periodKind, setPeriodKind] = useState<'year' | 'quarter'>('year')
  const [periodKey, setPeriodKey] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [memo, setMemo] = useState('')
  const [tab, setTab] = useState<'balance' | 'income'>('balance')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)

  /** 구분별로 묶은 계정. 표준표 순서(코드 오름차순)를 그대로 쓴다. */
  const bySection = useMemo(() => {
    const map = new Map<AccountSection, Account[]>()
    for (const account of accounts) {
      const list = map.get(account.section) ?? []
      list.push(account)
      map.set(account.section, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.account_code.localeCompare(b.account_code))
    return map
  }, [accounts])

  /** 입력값을 원장 규약(차변 − 대변)으로 옮긴 줄. 검증과 저장이 같은 배열을 본다. */
  const lines: StatementLine[] = useMemo(
    () =>
      accounts.flatMap((a) => {
        const entered = readAmount(amounts[a.account_code] ?? '')
        if (entered === 0) return []
        return [{ account_code: a.account_code, section: a.section, amount: toLedgerAmount(a.section, entered) }]
      }),
    [accounts, amounts],
  )

  const balance = balanceCheck(lines)
  const income = incomeSubtotals(lines)

  const periodValid =
    periodKind === 'year' ? /^\d{4}$/.test(periodKey) : /^\d{4}-Q[1-4]$/.test(periodKey)
  const evidenceValid = /^https?:\/\//i.test(evidenceUrl.trim())
  const canSave = periodValid && evidenceValid && memo.trim() !== '' && balance.balanced && !pending

  const clash = existingPeriods.find((p) => p.kind === periodKind && p.key === periodKey)

  const submit = () => {
    setError(null)
    // 같은 기간에 활성 결산이 있으면 무엇이 바뀌는지 말하고 확인을 받는다.
    // 덮어쓰지는 않는다 — 이전 행은 supersede로 남고 감사 기록이 둘 다 붙든다(0020).
    if (clash) {
      const go = window.confirm(
        `${periodKey}에 이미 결산이 있습니다.\n\n기존: ${clash.memo}\n새로: ${memo.trim()}\n\n` +
          '이전 결산은 지워지지 않고 정정 이력으로 남습니다. 계속할까요?',
      )
      if (!go) return
    }

    startTransition(async () => {
      const result = await saveOfficialStatement({
        businessId,
        periodKind,
        periodKey,
        evidenceUrl: evidenceUrl.trim(),
        memo: memo.trim(),
        lines: lines.map((l) => ({ account_code: l.account_code, amount: l.amount })),
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setSaved(result.id ?? null)
      router.refresh()
    })
  }

  const sections = tab === 'balance' ? BALANCE_SHEET_SECTIONS : INCOME_SECTIONS

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-panel p-3">
        <label className="text-[11px] text-ink-dim">
          기간 단위
          <select
            value={periodKind}
            onChange={(e) => {
              setPeriodKind(e.target.value as 'year' | 'quarter')
              setPeriodKey('')
            }}
            className="mt-1 block rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink"
          >
            <option value="year">연간</option>
            <option value="quarter">분기</option>
          </select>
        </label>

        <label className="text-[11px] text-ink-dim">
          기간
          <input
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value.trim())}
            placeholder={periodKind === 'year' ? '2025' : '2026-Q1'}
            className="mt-1 block w-28 rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink tnum"
          />
        </label>

        <label className="min-w-[240px] flex-1 text-[11px] text-ink-dim">
          증빙 링크 (사내 스토리지 PDF)
          <input
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="https://..."
            className="mt-1 block w-full rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink"
          />
        </label>

        <label className="min-w-[200px] flex-1 text-[11px] text-ink-dim">
          메모
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="성연회계법인 2025 결산"
            className="mt-1 block w-full rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink"
          />
        </label>
      </div>

      {clash ? (
        <p className="flex items-start gap-1.5 rounded-md bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <Icon name="shield" className="mt-px size-3.5 shrink-0" />
          {periodKey}에 이미 결산이 있습니다({clash.memo}). 저장하면 정정으로 기록됩니다.
        </p>
      ) : null}

      <div className="flex gap-1">
        {(
          [
            ['balance', '재무상태표'],
            ['income', '손익계산서'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`rounded-md px-3 py-1.5 text-[12px] transition-colors ${
              tab === key ? 'bg-accent/15 font-semibold text-accent' : 'text-ink-dim hover:bg-raised hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {sections.map((section) => {
          const rows = bySection.get(section) ?? []
          if (rows.length === 0) return null
          const credit = CREDIT_SECTIONS.includes(section)
          const subtotal = rows.reduce((t, a) => t + readAmount(amounts[a.account_code] ?? ''), 0)

          return (
            <section key={section} className="rounded-lg border border-line-soft">
              <header className="flex items-baseline justify-between border-b border-line-soft px-3 py-1.5">
                <h3 className="text-[12px] font-semibold text-ink">
                  {ACCOUNT_SECTION_LABEL_KO[section]}
                  {credit ? <span className="ml-1.5 text-[10px] font-normal text-ink-muted">대변</span> : null}
                </h3>
                <span className="text-[12px] font-semibold text-ink tnum">{won(subtotal)}</span>
              </header>
              <ul className="divide-y divide-line-soft">
                {rows.map((a) => (
                  <li key={a.account_code} className="flex items-center gap-3 px-3 py-1">
                    <span className="w-14 shrink-0 text-[10.5px] text-ink-muted tnum">{a.account_code}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">{a.name}</span>
                    <input
                      inputMode="numeric"
                      value={amounts[a.account_code] ?? ''}
                      onChange={(e) =>
                        setAmounts((prev) => ({ ...prev, [a.account_code]: e.target.value }))
                      }
                      // 입력은 언제나 양수다. 대변 계정의 부호 뒤집기는 저장 직전에 한 번만 한다.
                      placeholder="0"
                      className="w-36 rounded-md border border-line bg-app px-2 py-1 text-right text-[12px] text-ink tnum"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {/* 소계 — 계산된 줄이다. 칸이 없는 것이 요점이다. */}
      {tab === 'balance' ? (
        <div className="rounded-lg border border-line bg-panel p-3">
          <dl className="grid grid-cols-3 gap-3 text-[12px]">
            <Total label="자산 합계" value={balance.assets} />
            <Total label="부채 합계" value={balance.liabilities} />
            <Total label="자본 합계" value={balance.equity} />
          </dl>
          <p
            className={`mt-3 flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] ${
              balance.balanced ? 'bg-ok/10 text-ok' : 'bg-critical/10 text-critical'
            }`}
          >
            <Icon name={balance.balanced ? 'check-circle' : 'shield'} className="size-3.5 shrink-0" />
            {balance.balanced
              ? '자산 = 부채 + 자본. 닫혔습니다.'
              : lines.length === 0
                ? '금액을 넣으면 여기서 균형을 확인합니다.'
                : `자산 − (부채 + 자본) = ${won(balance.difference)}원 안 맞습니다.`}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-panel p-3">
          <dl className="grid grid-cols-2 gap-3 text-[12px] md:grid-cols-4">
            <Total label="매출총이익" value={income.grossProfit} />
            <Total label="EBITDA" value={income.ebitda} />
            <Total label="영업이익" value={income.operatingProfit} />
            <Total label="당기순이익" value={income.netIncome} />
          </dl>
          <p className="mt-2 text-[11px] text-ink-muted">
            소계는 계산된 줄입니다. 구성 항목을 고치면 따라 바뀝니다.
          </p>
        </div>
      )}

      {error ? (
        <p className="rounded-md bg-critical/10 px-3 py-2 text-[12px] text-critical">{error}</p>
      ) : null}
      {saved !== null ? (
        <p className="rounded-md bg-ok/10 px-3 py-2 text-[12px] text-ok">
          {businessName} {periodKey} 결산을 저장했습니다. 이 기간의 월별 입력은 이제 잠깁니다.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className="rounded-md bg-accent px-4 py-2 text-[12.5px] font-semibold text-app transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? '저장 중…' : '확정으로 저장'}
        </button>
        {!canSave && !pending ? (
          <span className="text-[11px] text-ink-muted">
            {!periodValid
              ? '기간을 넣으세요.'
              : !evidenceValid
                ? '증빙 링크가 필요합니다.'
                : memo.trim() === ''
                  ? '메모가 필요합니다.'
                  : '재무상태표가 닫혀야 저장됩니다.'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className={`text-[15px] font-semibold tnum ${value < 0 ? 'text-critical' : 'text-ink'}`}>
        {won(value)}
        <span className="ml-1.5 text-[11px] font-normal text-ink-muted">{formatEok(value)}</span>
      </dd>
    </div>
  )
}
