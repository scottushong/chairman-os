'use client'

import { useMemo, useState } from 'react'

import {
  planAccounts,
  type AccountClass,
  type AccountFileRow,
  type AccountOverrides,
  type AccountPlanLine,
  type ExistingAccount,
  type IgnoredRow,
} from '@/lib/ecount/excel/accounts-import'
import { SECTION_CATEGORIES } from '@/lib/ledger/accounts'
import {
  ACCOUNT_CATEGORY_LABEL_KO,
  ACCOUNT_SECTION,
  ACCOUNT_SECTION_LABEL_KO,
  CASH_FLOW_CLASS,
  CASH_FLOW_CLASS_LABEL_KO,
  type AccountCategory,
  type AccountSection,
  type CashFlowClass,
} from '@/types'

/**
 * ① 계정과목 미리보기 — 병합 계획(새 계정 · 이름 다름 · 같음 · 막힘)과 사람의 선택(새 계정 분류 고침 · 이름 바꿀 코드).
 *
 * 계획은 서버와 같은 순수 함수(planAccounts)로 화면에서 다시 돌린다 — 분류를 고르면 그 줄의 «분류 미정» 차단이
 * 바로 풀린다. 등록 때 서버는 원본을 다시 읽어 **처음부터 다시** 계획하고, 여기서 받는 것은 고침 · 체크뿐이다.
 * 있는 계정의 분류는 고를 칸이 없다(절대 안 바꾼다).
 */

const select =
  'rounded border border-line bg-panel px-1.5 py-0.5 text-t11 text-ink outline-none focus:border-accent disabled:opacity-50'

const STATUS: Record<AccountPlanLine['status'], { label: string; cls: string }> = {
  new: { label: '새 계정', cls: 'bg-accent/15 text-ink' },
  same: { label: '같음', cls: 'bg-raised text-ink-muted' },
  name_differs: { label: '이름 다름', cls: 'bg-warning/15 text-warning' },
  renamed: { label: '이름 바꿈', cls: 'bg-accent/15 text-ink' },
  blocked: { label: '막힘', cls: 'bg-critical/15 text-critical' },
}

function classLabel(c: AccountClass | null): string {
  if (!c) return '미정'
  const parts = [ACCOUNT_SECTION_LABEL_KO[c.section]]
  if (c.category !== 'asset' && c.category !== 'liability' && c.category !== 'equity' && c.category !== 'revenue') parts.push(ACCOUNT_CATEGORY_LABEL_KO[c.category])
  if (c.cash_flow) parts.push(CASH_FLOW_CLASS_LABEL_KO[c.cash_flow])
  return parts.join(' · ')
}

export function EcountAccountsPreview({
  input,
  busy,
  onCommit,
}: {
  input: { rows: AccountFileRow[]; ignored: IgnoredRow[]; existing: ExistingAccount[] }
  busy: boolean
  onCommit: (choices: { overrides: AccountOverrides; renames: string[] }) => void
}) {
  const [overrides, setOverrides] = useState<AccountOverrides>({})
  const [renames, setRenames] = useState<string[]>([])
  const [onlyIssues, setOnlyIssues] = useState(false)
  const plan = useMemo(() => planAccounts({ ...input, overrides, renames }), [input, overrides, renames])

  const counts = {
    new: plan.lines.filter((l) => l.status === 'new').length,
    differs: plan.lines.filter((l) => l.status === 'name_differs').length,
    renamed: plan.lines.filter((l) => l.status === 'renamed').length,
    same: plan.lines.filter((l) => l.status === 'same').length,
    blocked: plan.lines.filter((l) => l.status === 'blocked').length,
  }
  const shown = onlyIssues ? plan.lines.filter((l) => l.blocks.length || l.warnings.length || l.status === 'new') : plan.lines

  function override(code: string, c: AccountClass | null) {
    setOverrides((o) => {
      const next = { ...o }
      if (c) next[code] = c
      else delete next[code]
      return next
    })
  }

  return (
    <div className="space-y-3" aria-label="계정과목 미리보기">
      <div className="flex flex-wrap items-center gap-1.5 text-t11h">
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-ink">새 계정 {counts.new}</span>
        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">이름 다름 {counts.differs}</span>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-ink">이름 바꿈 {counts.renamed}</span>
        <span className="rounded bg-raised px-1.5 py-0.5 text-ink-muted">같음 {counts.same}</span>
        <span className={`rounded px-1.5 py-0.5 ${counts.blocked ? 'bg-critical/15 text-critical' : 'bg-raised text-ink-muted'}`}>막힘 {counts.blocked}</span>
        <label className="ml-auto flex min-h-11 items-center gap-1 text-t10h text-ink-dim lg:min-h-0">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          새 계정 · 문제 있는 줄만
        </label>
      </div>
      <p className="text-t10h text-ink-muted">
        분류는 «구분» 열 · 코드 대역 · 계정명으로 제안한 것입니다. 새 계정은 줄마다 고칠 수 있고, 이미 있는 계정의 분류는 바꾸지 않습니다.
        이름이 다른 계정은 체크한 것만 파일의 이름으로 바꿉니다. 파일에 없는 계정은 지우지 않습니다.
      </p>

      <div className="max-h-[32rem] overflow-auto rounded border border-line-soft">
        <table className="min-w-full text-t11">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left text-t10h text-ink-muted">
              <th className="px-2 py-1 font-normal">행</th>
              <th className="px-2 py-1 font-normal">코드</th>
              <th className="px-2 py-1 font-normal">계정명</th>
              <th className="px-2 py-1 font-normal">상태</th>
              <th className="px-2 py-1 font-normal">분류</th>
              <th className="px-2 py-1 font-normal">알림</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={`${l.rowNo}-${l.code}`} className="border-t border-line-soft align-top">
                <td className="px-2 py-1 text-ink-muted">{l.rowNo}</td>
                <td className="px-2 py-1 font-mono text-ink">{l.code || '—'}</td>
                <td className="px-2 py-1 text-ink">
                  {l.name || '—'}
                  {!l.active ? <span className="ml-1 text-t10h text-ink-muted">(사용안함)</span> : null}
                  {l.existing && (l.status === 'name_differs' || l.status === 'renamed') ? (
                    <label className="mt-0.5 flex items-center gap-1 text-t10h text-ink-dim">
                      <input
                        type="checkbox"
                        checked={renames.includes(l.code)}
                        disabled={busy}
                        onChange={(e) => setRenames((r) => (e.target.checked ? [...r, l.code] : r.filter((c) => c !== l.code)))}
                      />
                      장부 «{l.existing.name}» → 이 이름으로 바꾸기
                    </label>
                  ) : null}
                </td>
                <td className="px-2 py-1">
                  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-t10h ${STATUS[l.status].cls}`}>{STATUS[l.status].label}</span>
                </td>
                <td className="px-2 py-1">
                  {l.existing ? (
                    <span className="text-ink-dim">{classLabel(l.existing)} <span className="text-t10h text-ink-muted">(장부 그대로)</span></span>
                  ) : l.code ? (
                    <ClassPicker
                      line={l}
                      value={overrides[l.code] ?? null}
                      busy={busy}
                      onChange={(c) => override(l.code, c)}
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2 py-1 text-t10h">
                  {l.blocks.map((b) => (
                    <p key={b} className="text-critical">{b}</p>
                  ))}
                  {l.warnings.map((w) => (
                    <p key={w} className="text-warning">{w}</p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.ignored.length ? (
        <details className="text-t11 text-ink-dim">
          <summary className="cursor-pointer text-warning">합계 · 제목 행 {plan.ignored.length}줄은 싣지 않습니다</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {plan.ignored.map((r) => (
              <li key={r.rowNo}>
                {r.rowNo}행 «{r.text}» — {r.why}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {plan.missing.length ? (
        <details className="text-t11 text-ink-dim">
          <summary className="cursor-pointer text-warning">장부에는 있는데 파일에 없는 계정 {plan.missing.length}개 — 지우지 않습니다</summary>
          <p className="mt-1 pl-3">{plan.missing.map((m) => `${m.code} ${m.name}`).join(' · ')}</p>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || plan.blockCount > 0 || (plan.creates.length === 0 && plan.renames.length === 0)}
          onClick={() => onCommit({ overrides, renames })}
          className="min-h-11 rounded-md bg-accent px-3 text-t11h font-semibold text-ink disabled:opacity-40 lg:min-h-0 lg:py-1.5"
        >
          계정과목 등록 — 새 {plan.creates.length}개 · 이름 {plan.renames.length}개
        </button>
        <span className="text-t10h text-ink-muted">
          {plan.blockCount > 0
            ? `막힌 줄 ${plan.blockCount}개를 고쳐야 등록할 수 있습니다.`
            : plan.creates.length === 0 && plan.renames.length === 0
              ? '장부에 더하거나 바꿀 것이 없습니다.'
              : '서버가 원본을 다시 읽어 같은 판정을 한 번 더 한 뒤 넣습니다.'}
        </span>
      </div>
    </div>
  )
}

function ClassPicker({
  line,
  value,
  busy,
  onChange,
}: {
  line: AccountPlanLine
  value: AccountClass | null
  busy: boolean
  onChange: (c: AccountClass | null) => void
}) {
  const current = value ?? line.suggestion
  const section = current?.section ?? ''
  const categories = section ? SECTION_CATEGORIES[section] : []
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap gap-1">
        <select
          className={select}
          value={section}
          disabled={busy}
          aria-label={`${line.code} 구분`}
          onChange={(e) => {
            const s = e.target.value as AccountSection
            if (!s) return onChange(null)
            const allowed = SECTION_CATEGORIES[s]
            const cat = current && allowed.includes(current.category) ? current.category : allowed[0]
            onChange({ section: s, category: cat, cash_flow: current?.cash_flow ?? null })
          }}
        >
          <option value="">구분 고르기</option>
          {ACCOUNT_SECTION.map((s) => (
            <option key={s} value={s}>
              {ACCOUNT_SECTION_LABEL_KO[s]}
            </option>
          ))}
        </select>
        {section && categories.length > 1 ? (
          <select
            className={select}
            value={current?.category}
            disabled={busy}
            aria-label={`${line.code} 대분류`}
            onChange={(e) => onChange({ ...current!, category: e.target.value as AccountCategory })}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {ACCOUNT_CATEGORY_LABEL_KO[c]}
              </option>
            ))}
          </select>
        ) : null}
        {section ? (
          <select
            className={select}
            value={current?.cash_flow ?? ''}
            disabled={busy}
            aria-label={`${line.code} 현금흐름`}
            onChange={(e) => onChange({ ...current!, cash_flow: (e.target.value || null) as CashFlowClass | null })}
          >
            <option value="">현금흐름 없음</option>
            {CASH_FLOW_CLASS.map((c) => (
              <option key={c} value={c}>
                {CASH_FLOW_CLASS_LABEL_KO[c]}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <p className="text-t10h text-ink-muted">
        {value ? (
          <>
            직접 고름 ·{' '}
            <button type="button" className="text-accent hover:underline" disabled={busy} onClick={() => onChange(null)}>
              제안대로
            </button>
          </>
        ) : line.suggestion ? (
          `제안 — ${line.why}`
        ) : (
          '제안 없음'
        )}
      </p>
    </div>
  )
}
