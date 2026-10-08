import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import {
  LEDGER_GRAIN_LABEL,
  ledgerParams,
  type LedgerFilters,
  type LedgerGroup,
  type LedgerRow,
  type LedgerSortKey,
  type LedgerTotals,
} from '@/lib/approval-ledger'
import { withParams } from '@/lib/query'

/**
 * 결재 대장 그리기 — 표(md 이상) · 카드(md 미만) · 묶음 합계. 전부 서버 컴포넌트다(누르는 것은 전부 링크).
 *
 * 줄을 누르면 기존 결재 상세(/approvals?id=)로 간다 — 상세 화면을 두 벌 만들지 않는다.
 * 폰에서는 표 대신 카드를 그린다. 가로로 미는 표는 열 개가 넘으면 읽을 수 없다.
 */

const BASE = '/approvals/ledger'
const won = new Intl.NumberFormat('ko-KR')
const money = (n: number | null) => (n === null ? '—' : won.format(n))

const STATUS_TONE: Record<LedgerRow['status'], string> = {
  open: 'bg-warning/15 text-warning',
  approved: 'bg-ok/15 text-ok',
  recorded: 'bg-raised text-ink-dim',
  rejected: 'bg-critical/15 text-critical',
  modified: 'bg-raised text-ink-dim',
  delegated: 'bg-raised text-ink-dim',
}

/** 결재 상세 — 열린 결재는 대기 탭, 끝난 결재는 완료 탭에 있다(그 탭에 없는 id는 상세가 맨 위 건을 연다). */
export const detailHref = (r: LedgerRow) => withParams('/approvals', { tab: r.status === 'open' ? 'open' : 'done', id: r.id })

function StatusBadge({ row }: { row: LedgerRow }) {
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-t10h font-semibold ${STATUS_TONE[row.status]}`}>{row.status_label}</span>
}

function ExternalLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
      <Icon name="file-text" className="size-3.5 shrink-0" />
      열기
    </a>
  )
}

const COLUMNS: { key: LedgerSortKey | null; label: string; right?: boolean }[] = [
  { key: 'id', label: '결재 번호' },
  { key: 'date', label: '날짜' },
  { key: 'template', label: '양식' },
  { key: 'title', label: '제목' },
  { key: 'requester', label: '올린 사람' },
  { key: 'amount', label: '금액', right: true },
  { key: 'vendor', label: '구입처' },
  { key: null, label: '링크' },
  { key: 'status', label: '상태' },
  { key: 'approver', label: '현재 결재자' },
  { key: 'decided', label: '최종 처리일' },
]

function SortHeader({ col, filters }: { col: (typeof COLUMNS)[number]; filters: LedgerFilters }) {
  if (!col.key) return <span>{col.label}</span>
  const active = filters.sort === col.key
  // 같은 칸을 다시 누르면 방향만 뒤집는다. 새 칸은 날짜 · 금액 · 처리일은 큰 것부터, 글자 칸은 가나다순부터.
  const numeric = col.key === 'date' || col.key === 'amount' || col.key === 'decided'
  const dir = active ? (filters.dir === 'asc' ? 'desc' : 'asc') : numeric ? 'desc' : 'asc'
  const href = withParams(BASE, { ...ledgerParams(filters), sort: col.key, dir })
  return (
    <Link href={href} className={`inline-flex items-center gap-0.5 hover:text-ink ${active ? 'font-semibold text-ink' : ''}`} aria-sort={active ? (filters.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {col.label}
      {active ? <Icon name={filters.dir === 'asc' ? 'arrow-up' : 'arrow-down'} className="size-3" /> : null}
    </Link>
  )
}

export function LedgerTable({ rows, filters }: { rows: LedgerRow[]; filters: LedgerFilters }) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-line-soft bg-panel md:block">
      <table className="w-full min-w-[1080px] text-t12">
        <thead>
          <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
            {COLUMNS.map((c) => (
              <th key={c.label} className={`whitespace-nowrap px-3 py-2 font-normal ${c.right ? 'text-right' : ''}`}>
                <SortHeader col={c} filters={filters} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line-soft hover:bg-raised/60">
              <td className="whitespace-nowrap px-3 py-2 tnum">
                <Link href={detailHref(r)} className="text-accent hover:underline">
                  {r.id}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2 tnum text-ink-dim">{r.day || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2">{r.template_name}</td>
              <td className="max-w-[280px] px-3 py-2">
                <Link href={detailHref(r)} className="line-clamp-2 font-semibold hover:underline">
                  {r.title}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {r.requester}
                {r.team ? <span className="block text-t10h text-ink-muted">{r.team}</span> : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tnum">{money(r.amount)}</td>
              <td className="max-w-[160px] truncate px-3 py-2">{r.vendor || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2">{r.link ? <ExternalLink href={r.link} /> : <span className="text-ink-muted">—</span>}</td>
              <td className="px-3 py-2">
                <StatusBadge row={r} />
              </td>
              <td className="whitespace-nowrap px-3 py-2">{r.approver ?? <span className="text-ink-muted">—</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 tnum text-ink-dim">{r.decided_day || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 폰 — 결재 한 건 = 카드 한 장. 카드 안에 링크가 둘(상세 · 바깥 링크)이라 카드 전체를 링크로 감싸지 않는다. */
export function LedgerCards({ rows }: { rows: LedgerRow[] }) {
  return (
    <ul className="space-y-2 md:hidden">
      {rows.map((r) => (
        <li key={r.id} className="min-w-0 rounded-xl border border-line-soft bg-panel px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-t11 text-ink-muted">
            <span className="tnum">{r.day || '—'}</span>
            <span>·</span>
            <span>{r.template_name}</span>
            <span className="ml-auto shrink-0">
              <StatusBadge row={r} />
            </span>
          </div>
          <Link href={detailHref(r)} className="mt-1 block break-words text-t13 leading-snug font-semibold">
            {r.title}
          </Link>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-t11h">
            <dt className="text-ink-muted">금액</dt>
            <dd className="text-right font-semibold tnum">{money(r.amount)}</dd>
            <dt className="text-ink-muted">올린 사람</dt>
            <dd className="truncate text-right">
              {r.requester}
              {r.team ? <span className="text-ink-muted"> · {r.team}</span> : null}
            </dd>
            {r.vendor ? (
              <>
                <dt className="text-ink-muted">구입처</dt>
                <dd className="truncate text-right">{r.vendor}</dd>
              </>
            ) : null}
            <dt className="text-ink-muted">현재 결재자</dt>
            <dd className="truncate text-right">{r.approver ?? '—'}</dd>
            {r.decided_day ? (
              <>
                <dt className="text-ink-muted">최종 처리일</dt>
                <dd className="text-right tnum">{r.decided_day}</dd>
              </>
            ) : null}
          </dl>
          <div className="mt-2 flex items-center justify-between text-t11h">
            <span className="text-ink-muted tnum">{r.id}</span>
            {r.link ? <ExternalLink href={r.link} /> : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

const TOP = 8

function GroupBox({ title, groups }: { title: string; groups: LedgerGroup[] }) {
  const shown = groups.slice(0, TOP)
  return (
    <section className="min-w-0 rounded-xl border border-line-soft bg-panel px-3.5 py-3">
      <h3 className="text-t11h font-semibold text-ink-dim">{title}</h3>
      {shown.length === 0 ? (
        <p className="mt-2 text-t11 text-ink-muted">없음</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {shown.map((g) => (
            <li key={g.key} className="flex items-baseline gap-2 text-t11h">
              <span className="min-w-0 flex-1 truncate">{g.label}</span>
              <span className="shrink-0 text-ink-muted tnum">{g.count}건</span>
              <span className="shrink-0 font-semibold tnum">{won.format(g.sum)}</span>
            </li>
          ))}
        </ul>
      )}
      {groups.length > TOP ? <p className="mt-1.5 text-t10h text-ink-muted">외 {groups.length - TOP}개 — 엑셀 «묶음 합계»에 전부 있습니다</p> : null}
    </section>
  )
}

export function LedgerTotalsPanel({ totals, filters }: { totals: LedgerTotals; filters: LedgerFilters }) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-line-soft bg-panel px-3.5 py-3">
          <p className="text-t11 text-ink-muted">건수</p>
          <p className="mt-0.5 text-t18 font-bold tnum">{won.format(totals.count)}건</p>
        </div>
        <div className="rounded-xl border border-line-soft bg-panel px-3.5 py-3">
          <p className="text-t11 text-ink-muted">금액 합계</p>
          <p className="mt-0.5 truncate text-t18 font-bold tnum">{won.format(totals.sum)}원</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        <GroupBox title={filters.grain === 'month' ? '월별' : `${LEDGER_GRAIN_LABEL[filters.grain]}별`} groups={filters.grain === 'month' ? totals.byMonth : totals.byPeriod} />
        <GroupBox title="양식별" groups={totals.byTemplate} />
        <GroupBox title="구입처별" groups={totals.byVendor} />
        <GroupBox title="팀별" groups={totals.byTeam} />
      </div>
    </div>
  )
}
