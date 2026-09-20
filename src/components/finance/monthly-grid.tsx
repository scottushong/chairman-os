'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { saveMonthlyBooks } from '@/app/actions/monthly'
import { Icon } from '@/components/ui/icon'
import { formatEok } from '@/lib/format'
import { MANUFACTURING_ROWS, STARTUP_ROWS, buildMonthlySlip, type MonthlyRow } from '@/lib/statements/monthly'
import { parsePastedColumn } from '@/lib/statements/paste'
import { isLocked, lockingPeriod, type OfficialPeriod } from '@/lib/statements/period'

/**
 * 월별 간이 손익 (Phase 2-C 블록 2).
 *
 * 12개월 × 항목의 표. 스프레드시트처럼 칸을 채우고, 저장하면 달마다 요약 전표 한 장이
 * 장부로 들어간다(lib/statements/monthly.ts). **이 화면은 마감하지 않는다** —
 * 마감은 기존 월 마감 버튼이 그대로 한다.
 *
 * 공식 재무제표가 덮은 달은 칸이 잠기고 '확정'으로 표시된다. 잠그는 이유는 화면 정리가
 * 아니라 이중 계상을 막는 것이다 — 그 달은 이미 확정 결산이 말하고 있다.
 *
 * 붙여넣기는 항목 한 줄 단위다. 엑셀에서 열 하나(12칸)를 복사해 아무 칸에나 붙이면
 * 그 줄의 열두 달이 채워진다. 못 읽은 칸은 0이 아니라 빈칸으로 남고 몇 칸이 실패했는지 말한다.
 */

const won = (n: number) => n.toLocaleString('ko-KR')

/**
 * 달마다의 요약 전표를 미리 계산한다 — 미분류 차액을 저장 전에 보여 주려고.
 *
 * 컴포넌트 밖에 두는 이유는 잔액 항목이 '전월과의 차이'라 **직전 달의 값을 들고 가야 하기**
 * 때문이다. 렌더 안에서 변수를 이어 쓰면 react-hooks 규칙(Cannot reassign after render)에 걸린다.
 * 순수 함수로 빼면 그 누적이 함수 안에서 끝난다.
 */
function previewMonths(
  rows: readonly MonthlyRow[],
  openMonths: string[],
  read: (rowKey: string, month: string) => string,
): { month: string; residual: number; touched: boolean }[] {
  const out: { month: string; residual: number; touched: boolean }[] = []
  let prior: Record<string, number> = {}

  for (const month of openMonths) {
    const values = Object.fromEntries(rows.map((r) => [r.key, readAmount(read(r.key, month))]))
    const slip = buildMonthlySlip({ rows, values, priorBalances: prior })
    prior = values
    out.push({
      month,
      residual: slip.residual,
      touched: rows.some((r) => read(r.key, month) !== ''),
    })
  }
  return out
}

function readAmount(raw: string): number {
  const bare = raw.replace(/[,\s₩]/g, '')
  if (bare === '' || bare === '-') return 0
  const value = Number(bare)
  return Number.isFinite(value) ? Math.round(value) : 0
}

interface MonthlyGridProps {
  businessId: string
  /** 그릴 열두 달. 'YYYY-MM' 오름차순. */
  months: string[]
  /** 이 회사의 활성 공식 재무제표. 잠금 판정이 쓴다. */
  officials: OfficialPeriod[]
  /** 공식 결산의 메모 — 잠긴 칸의 근거를 hover로 보여 준다. */
  officialMemos: Record<string, string>
  preset: 'manufacturing' | 'startup'
  canEdit: boolean
}

export function MonthlyGrid({
  businessId,
  months,
  officials,
  officialMemos,
  preset,
  canEdit,
}: MonthlyGridProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const allRows = preset === 'startup' ? STARTUP_ROWS : MANUFACTURING_ROWS
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const rows = useMemo(() => allRows.filter((r) => !hidden.has(r.key)), [allRows, hidden])

  /** cells[rowKey][month] = 입력 문자열. */
  const [cells, setCells] = useState<Record<string, Record<string, string>>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const valueOf = (rowKey: string, month: string) => cells[rowKey]?.[month] ?? ''
  const setCell = (rowKey: string, month: string, raw: string) =>
    setCells((prev) => ({ ...prev, [rowKey]: { ...(prev[rowKey] ?? {}), [month]: raw } }))

  const openMonths = months.filter((m) => !isLocked(m, officials))

  /** 붙여넣기 — 그 줄의 **열린 달**만 채운다. 잠긴 달을 건너뛰지 않으면 칸이 밀린다. */
  const pasteInto = (rowKey: string, startMonth: string, text: string) => {
    const targets = openMonths.slice(openMonths.indexOf(startMonth))
    if (targets.length === 0) return
    const parsed = parsePastedColumn(text, targets.length)

    setCells((prev) => {
      const line = { ...(prev[rowKey] ?? {}) }
      targets.forEach((month, i) => {
        const value = parsed.values[i]
        if (value !== null) line[month] = String(value)
      })
      return { ...prev, [rowKey]: line }
    })

    const parts: string[] = [`${targets.length}칸 중 ${parsed.values.filter((v) => v !== null).length}칸을 채웠습니다.`]
    if (parsed.failed > 0) parts.push(`${parsed.failed}칸은 숫자로 읽지 못해 비워 두었습니다.`)
    if (parsed.overflow > 0) parts.push(`${parsed.overflow}칸은 열두 달을 넘겨 버렸습니다.`)
    setNotice(parts.join(' '))
  }

  const preview = previewMonths(rows, openMonths, valueOf)

  const dirtyMonths = preview.filter((p) => p.touched)

  const submit = () => {
    setError(null)
    setResult(null)
    startTransition(async () => {
      const payload = dirtyMonths.map((p) => ({
        month: p.month,
        values: Object.fromEntries(rows.map((r) => [r.key, readAmount(valueOf(r.key, p.month))])),
      }))
      const state = await saveMonthlyBooks({ businessId, preset, months: payload })
      if (state.error) {
        setError(state.error)
        return
      }
      const parts = [`${state.saved?.length ?? 0}개월을 전표로 넣었습니다.`]
      if (state.unbalanced && state.unbalanced.length > 0) {
        parts.push(
          `${state.unbalanced.map((u) => u.month).join(', ')}은 숫자가 서로 맞지 않아 미분류 줄이 함께 들어갔습니다.`,
        )
      }
      setResult(parts.join(' '))
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-ink-muted">항목 숨김:</span>
        {allRows.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() =>
              setHidden((prev) => {
                const next = new Set(prev)
                if (next.has(r.key)) next.delete(r.key)
                else next.add(r.key)
                return next
              })
            }
            aria-pressed={hidden.has(r.key)}
            className={`rounded px-1.5 py-0.5 text-[10.5px] transition-colors ${
              hidden.has(r.key)
                ? 'bg-raised text-ink-muted line-through'
                : 'bg-accent/10 text-ink-dim hover:text-ink'
            }`}
          >
            {r.label}
          </button>
        ))}
        {/* 숨김은 화면 설정이지 계정 삭제가 아니다. 숨긴 항목은 저장에도 빠진다. */}
        <span className="text-[10.5px] text-ink-muted">— 숨긴 항목은 저장에서도 빠집니다.</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line bg-panel">
              {/* 첫 열은 폭을 못 박는다. 좁으면 '현금잔액 월말잔액'이 세 줄로 깨진다. */}
              <th className="sticky left-0 z-10 w-[132px] min-w-[132px] bg-panel px-2 py-1.5 text-left font-semibold text-ink">
                항목
              </th>
              {months.map((m) => {
                const locked = isLocked(m, officials)
                const by = lockingPeriod(m, officials)
                return (
                  <th
                    key={m}
                    title={
                      locked && by
                        ? `${by.key} 결산이 덮은 달 — ${officialMemos[`${by.kind}:${by.key}`] ?? '공식 재무제표'}`
                        : undefined
                    }
                    className={`px-1.5 py-1.5 text-right font-semibold tnum ${
                      locked ? 'text-ink-muted' : 'text-ink'
                    }`}
                  >
                    {m.slice(5)}월
                    {locked ? (
                      <span className="block text-[9px] font-normal text-ok">확정</span>
                    ) : null}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line-soft last:border-0">
                <td className="sticky left-0 z-10 w-[132px] min-w-[132px] bg-app px-2 py-1 whitespace-nowrap text-ink-dim">
                  {r.label}
                  {!r.flow ? (
                    // 잔액 항목이라는 사실을 적는다. 발생액과 잔액을 섞어 넣으면 전표가 어긋난다.
                    <span className="ml-1 text-[9.5px] text-ink-muted">월말잔액</span>
                  ) : null}
                </td>
                {months.map((m) => {
                  const locked = isLocked(m, officials)
                  return (
                    <td key={m} className="px-1 py-0.5">
                      <input
                        inputMode="numeric"
                        disabled={locked || !canEdit}
                        value={valueOf(r.key, m)}
                        onChange={(e) => setCell(r.key, m, e.target.value)}
                        onPaste={(e) => {
                          const text = e.clipboardData.getData('text')
                          // 여러 칸을 복사한 경우에만 가로챈다. 한 칸이면 평소대로 붙는다.
                          if (!/[\t\n]/.test(text)) return
                          e.preventDefault()
                          pasteInto(r.key, m, text)
                        }}
                        className="w-full min-w-[72px] rounded border border-line bg-app px-1 py-0.5 text-right text-ink tnum disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-muted"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 미분류 차액 — 저장 전에 보여 준다. 숨기면 회장이 자기 숫자가 안 맞는 걸 모른다. */}
      {dirtyMonths.some((p) => p.residual !== 0) ? (
        <div className="rounded-md bg-warning/10 px-3 py-2 text-[11.5px] text-warning">
          <p className="flex items-center gap-1.5 font-semibold">
            <Icon name="shield" className="size-3.5 shrink-0" />
            숫자가 서로 맞지 않는 달이 있습니다 — 그만큼 미분류로 들어갑니다.
          </p>
          <ul className="mt-1 space-y-0.5 tnum">
            {dirtyMonths
              .filter((p) => p.residual !== 0)
              .map((p) => (
                <li key={p.month}>
                  {p.month} · {won(Math.abs(p.residual))}원 ({formatEok(Math.abs(p.residual))})
                </li>
              ))}
          </ul>
          <p className="mt-1 text-[10.5px]">
            매출·비용의 상대는 현금·매출채권·매입채무입니다. 그 셋을 채우면 차액이 줄어듭니다.
          </p>
        </div>
      ) : null}

      {notice ? (
        <p className="rounded-md bg-raised px-3 py-2 text-[11.5px] text-ink-dim">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-critical/10 px-3 py-2 text-[12px] text-critical">{error}</p>
      ) : null}
      {result ? <p className="rounded-md bg-ok/10 px-3 py-2 text-[12px] text-ok">{result}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canEdit || pending || dirtyMonths.length === 0}
          className="rounded-md bg-accent px-4 py-2 text-[12.5px] font-semibold text-app transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? '저장 중…' : `${dirtyMonths.length}개월 전표로 넣기`}
        </button>
        <span className="text-[11px] text-ink-muted">
          저장하면 달마다 요약 전표가 <strong className="font-semibold">잠정</strong>으로 들어갑니다. 마감은
          전표 화면의 월 마감 버튼이 합니다.
        </span>
      </div>
    </div>
  )
}
