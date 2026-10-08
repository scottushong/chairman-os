import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import {
  LEDGER_GRAIN_LABEL,
  LEDGER_GRAINS,
  LEDGER_STATUS_KEYS,
  LEDGER_STATUS_LABEL,
  dateWindow,
  ledgerParams,
  periodKey,
  periodLabel,
  shiftPeriod,
  type LedgerFilters,
} from '@/lib/approval-ledger'
import { withParams } from '@/lib/query'

/**
 * 결재 대장 거르기 — 전부 URL에 있다(lib/query.ts). 엑셀 링크가 같은 값을 그대로 싣는다.
 *
 * 기간은 두 길이다.
 *   단위 칩(일 · 주 · 월 · 분기 · 년) — 오늘이 든 그 단위의 기간으로 가고, ‹ › 로 앞뒤 기간을 넘긴다.
 *   직접 — 시작일 · 끝일을 적는다(기간 칩이 꺼져 있을 때만 칸이 보인다).
 * 나머지 칸은 평범한 GET 폼이다 — 자바스크립트 없이도 거르기가 된다.
 */

const BASE = '/approvals/ledger'
const input = 'w-full min-w-0 rounded-md border border-line bg-panel px-2.5 py-1.5 text-t12h'

export interface LedgerFilterOptions {
  companies: { id: string; name: string }[]
  templates: { key: string; name: string }[]
  requesters: string[]
  teams: string[]
  vendors: string[]
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-t11 text-ink-dim">{label}</span>
      {children}
    </label>
  )
}

export function LedgerFilterBar({ filters, options, today }: { filters: LedgerFilters; options: LedgerFilterOptions; today: string }) {
  const params = ledgerParams(filters)
  const { from, to } = dateWindow(filters)
  // 기간 칩은 기간 · 직접 범위를 갈아 끼우고 나머지 거르기는 그대로 둔다.
  const rest = { ...params, grain: undefined, period: undefined, from: undefined, to: undefined }
  const chip = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-t11 transition-colors ${
      active ? 'border-accent bg-accent/15 font-semibold text-ink' : 'border-line text-ink-muted hover:text-ink-dim'
    }`

  return (
    <div className="space-y-3 rounded-xl border border-line-soft bg-panel px-3.5 py-3">
      <div className="m-tabs flex flex-wrap items-center gap-1.5">
        <span className="text-t10 font-semibold tracking-[0.08em] text-ink-muted">기간</span>
        <Link href={withParams(BASE, { ...rest, grain: filters.grain === 'month' ? undefined : filters.grain })} className={chip(!filters.period && !from && !to)}>
          전체
        </Link>
        {LEDGER_GRAINS.map((g) => (
          <Link
            key={g}
            href={withParams(BASE, { ...rest, grain: g === 'month' ? undefined : g, period: periodKey(today, g) })}
            className={chip(!!filters.period && filters.grain === g)}
          >
            {LEDGER_GRAIN_LABEL[g]}
          </Link>
        ))}
        {filters.period ? (
          <span className="ml-1 inline-flex items-center gap-1">
            <Link
              href={withParams(BASE, { ...params, period: shiftPeriod(filters.period, filters.grain, -1) })}
              aria-label="이전 기간"
              className="rounded-md border border-line px-1.5 py-1 text-ink-dim hover:text-ink"
            >
              <Icon name="chevron-right" className="size-3.5 rotate-180" />
            </Link>
            <span className="text-t12h font-semibold tnum">{periodLabel(filters.period, filters.grain)}</span>
            <Link
              href={withParams(BASE, { ...params, period: shiftPeriod(filters.period, filters.grain, 1) })}
              aria-label="다음 기간"
              className="rounded-md border border-line px-1.5 py-1 text-ink-dim hover:text-ink"
            >
              <Icon name="chevron-right" className="size-3.5" />
            </Link>
          </span>
        ) : null}
      </div>

      <form method="get" action={BASE} className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
        {/* 기간 칩 값 · 정렬은 폼이 바꾸지 않는다 — 숨은 칸으로 그대로 싣는다. */}
        {filters.grain !== 'month' ? <input type="hidden" name="grain" value={filters.grain} /> : null}
        {filters.period ? <input type="hidden" name="period" value={filters.period} /> : null}
        {params.sort ? <input type="hidden" name="sort" value={params.sort} /> : null}
        {params.dir ? <input type="hidden" name="dir" value={params.dir} /> : null}

        <Field label="회사">
          <select name="company" defaultValue={filters.company ?? ''} className={input}>
            <option value="">전체</option>
            {options.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="양식">
          <select name="template" defaultValue={filters.template ?? ''} className={input}>
            <option value="">전체</option>
            {options.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="상태">
          <select name="status" defaultValue={filters.status ?? ''} className={input}>
            <option value="">전체</option>
            {LEDGER_STATUS_KEYS.map((s) => (
              <option key={s} value={s}>
                {LEDGER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="올린 사람">
          <input name="requester" list="ledger-requesters" defaultValue={filters.requester ?? ''} className={input} />
          <datalist id="ledger-requesters">
            {options.requesters.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="팀">
          <input name="team" list="ledger-teams" defaultValue={filters.team ?? ''} className={input} />
          <datalist id="ledger-teams">
            {options.teams.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="구입처">
          <input name="vendor" list="ledger-vendors" defaultValue={filters.vendor ?? ''} className={input} />
          <datalist id="ledger-vendors">
            {options.vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="금액 이상(원)">
          <input name="min" inputMode="numeric" defaultValue={filters.min ?? ''} className={`${input} tnum`} />
        </Field>
        <Field label="금액 이하(원)">
          <input name="max" inputMode="numeric" defaultValue={filters.max ?? ''} className={`${input} tnum`} />
        </Field>
        {filters.period ? null : (
          <>
            <Field label="시작일">
              <input type="date" name="from" defaultValue={from ?? ''} className={input} />
            </Field>
            <Field label="끝일">
              <input type="date" name="to" defaultValue={to ?? ''} className={input} />
            </Field>
          </>
        )}
        <Field label="찾기 (제목 · 항목 · 이름)" className="col-span-2">
          <input name="q" type="search" defaultValue={filters.q ?? ''} className={input} />
        </Field>
        <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-6">
          <button type="submit" className="rounded-md border border-accent bg-accent px-3 py-1.5 text-t11h font-semibold text-white">
            거르기
          </button>
          <Link href={BASE} className="rounded-md border border-line px-3 py-1.5 text-t11h text-ink-dim hover:text-ink">
            모두 지우기
          </Link>
        </div>
      </form>
    </div>
  )
}
