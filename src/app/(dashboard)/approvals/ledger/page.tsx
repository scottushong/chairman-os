import Link from 'next/link'

import { LedgerFilterBar, type LedgerFilterOptions } from '@/components/approvals/ledger/ledger-filters'
import { LedgerCards, LedgerTable, LedgerTotalsPanel } from '@/components/approvals/ledger/ledger-view'
import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { canExportLedger, kstDay, ledgerParams, ledgerTotals, parseLedgerFilters, windowLabel } from '@/lib/approval-ledger'
import { loadLedger } from '@/lib/approval-ledger-load'
import { boss, isChairman } from '@/lib/boss'
import { currentUser } from '@/lib/auth/session'
import { withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * 0059 결재 대장 — 양식 결재를 한 장의 표로. 경영지원이 회계 처리할 때 보는 자리다.
 *
 * ■ 누가 무엇을 보나 ■ 로그인한 누구나 열 수 있다. 보이는 줄은 RLS가 정한다 — 본인이 올린 것 · 결재선에 든 것,
 *   회장은 전부, «결재 대장 열람»(user_module_access '/approvals/ledger/<회사>') 줄이 있으면 그 회사 전부.
 *   메뉴는 회장과 열람 줄이 있는 사람에게만 건다(lib/nav.ts) — 화면 안내일 뿐 판정은 DB다.
 *
 * ■ 거르기는 URL ■ 같은 값이 «엑셀 내려받기»(/approvals/ledger/export)로 그대로 넘어간다. 라우트는 요청한 사람의
 *   세션으로 같은 함수(lib/approval-ledger-load.ts)를 다시 돌린다 — 화면에 없는 줄이 파일에 들어갈 길이 없다.
 */

const BASE = '/approvals/ledger'

const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x && x !== '—'))].sort((a, b) => a.localeCompare(b, 'ko'))

export default async function ApprovalLedgerPage(props: PageProps<'/approvals/ledger'>) {
  const params = await props.searchParams
  const filters = parseLedgerFilters(params)

  const [user, repo] = await Promise.all([currentUser(), getRepository()])
  const role = user?.role ?? null
  const { all, rows, templates, businesses } = await loadLedger(repo, role, filters)
  const totals = ledgerTotals(rows, filters.grain)
  const today = kstDay(new Date().toISOString())

  // 고르기 칸의 선택지 — 이 사람이 읽을 수 있는 줄(all)에서만 낸다. 못 보는 회사 · 사람 이름이 선택지로 새지 않는다.
  const seenCompanies = new Set(all.map((r) => r.business_id))
  const seenTemplates = new Set(all.map((r) => r.template_key))
  const options: LedgerFilterOptions = {
    companies: businesses.filter((b) => seenCompanies.has(b.business_id)).map((b) => ({ id: b.business_id, name: b.name })),
    templates: [...templates]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((t) => seenTemplates.has(t.template_key))
      .map((t) => ({ key: t.template_key, name: t.name_ko })),
    requesters: uniq(all.map((r) => r.requester)),
    teams: uniq(all.map((r) => r.team)),
    vendors: uniq(all.map((r) => r.vendor)),
  }

  const exportHref = withParams(`${BASE}/export`, ledgerParams(filters))
  const hasGrant = isChairman(role) || (user?.ledger?.length ?? 0) > 0
  // 엑셀은 회장, 또는 열람 줄이 있는 회사를 고른 사람만(0059 approval_ledger_log와 같은 판정 — 라우트도 403으로 막는다).
  const canExport = canExportLedger(role, user?.ledger, filters.company)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
      <PageHeader
        icon="book"
        title="결재 대장"
        code="CH-041"
        description="양식으로 올린 결재를 한 장의 표로 — 기간 · 회사 · 양식 · 사람 · 구입처 · 금액으로 거르고 엑셀로 내려받는다."
      >
        <Link href="/approvals" className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim hover:text-ink">
          전자결재
        </Link>
        {/* 평범한 링크다 — 라우트가 첨부 파일(Content-Disposition)로 돌려준다. Link로 걸면 화면 이동을 미리 가져오려 든다. */}
        {canExport ? (
          <a
            href={exportHref}
            className={`inline-flex items-center gap-1 rounded-md border border-accent bg-accent px-2.5 py-1.5 text-t11h font-semibold text-white ${
              rows.length === 0 ? 'pointer-events-none opacity-50' : ''
            }`}
            aria-disabled={rows.length === 0 ? 'true' : undefined}
          >
            <Icon name="arrow-down" className="size-3.5" />
            엑셀 내려받기
          </a>
        ) : hasGrant ? (
          <span className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim">회사를 고르면 엑셀로 내려받을 수 있습니다</span>
        ) : null}
      </PageHeader>

      <div className="mt-4">
        <LedgerFilterBar filters={filters} options={options} today={today} />
      </div>

      {all.length === 0 ? (
        <div className="mt-3 rounded-xl border border-line-soft bg-panel px-4 py-10 text-center">
          <p className="text-t12h text-ink-muted">볼 수 있는 결재가 없습니다.</p>
          {hasGrant ? null : (
            <p className="mt-1.5 text-t11 text-ink-muted">
              내가 올렸거나 결재선에 든 결재만 보입니다. 회사 결재 전부를 보려면 {boss(role)}에게 «결재 대장 열람»을 요청하세요.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3">
            <LedgerTotalsPanel totals={totals} filters={filters} />
          </div>

          <p className="mt-3 mb-1.5 text-t11 text-ink-dim">
            <span className="tnum">{rows.length}</span>건 · 기간 {windowLabel(filters)}
            {hasGrant ? null : <span className="text-ink-muted"> · 내가 올렸거나 결재선에 든 결재만 보입니다</span>}
          </p>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center">
              <p className="text-t12h text-ink-muted">조건에 맞는 결재가 없습니다.</p>
              <Link href={BASE} className="mt-1.5 inline-block text-t11h text-accent hover:underline">
                거르기 모두 지우기
              </Link>
            </div>
          ) : (
            <div className="pb-6">
              <LedgerTable rows={rows} filters={filters} />
              <LedgerCards rows={rows} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
