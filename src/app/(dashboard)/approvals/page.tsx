import Link from 'next/link'

import { ApprovalDetail } from '@/components/approvals/approval-detail'
import { DraftDecision } from '@/components/approvals/draft-decision'
import { PageHeader } from '@/components/layout/page-header'
import { FilterChips, type FilterOption } from '@/components/ui/filter-chips'
import { Icon } from '@/components/ui/icon'
import { canDraftDecision } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { countOn, type DecisionAuditRecord } from '@/lib/decision-log'
import { dayKey, dDay, formatDDay } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import { firstParam, oneOf, withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import {
  DECISION_STATUS_LABEL_KO,
  WORK_PRIORITY_LABEL_KO,
  type Decision,
  type WorkPriority,
} from '@/types'

/**
 * CH-041 전자결재.
 *
 * 대시보드의 '내 결정 사항'(CH-015/016) 패널이 아침에 훑는 자리라면 여기는 파고드는 자리다.
 * 패널은 제목과 선택안만 보여 주고 바로 누르게 하지만, 여기는 첨부와 처리 이력까지 펴 놓는다.
 *
 * 목록과 상세를 한 화면에 둔 이유는 결재가 연속 동작이기 때문이다 —
 * 한 건 처리하고 목록으로 돌아갔다 다시 들어오면 스무 건에서 열 번 넘게 화면이 뒤집힌다.
 *
 * 어느 건이 열려 있는지는 URL(?id=)에 있다. 링크로 특정 결재를 지목할 수 있어야 한다.
 *
 * 기안도 여기 있다(DEFERRED D-10 선택지 A). 결재를 올리는 일과 처리하는 일이 같은 화면인 이유는
 * 첨부가 올릴 때 거는 값이기 때문이다 — 상세 패널에 붙이면 '결재 내용을 결재자가 고친다'가 된다.
 */

const BASE = '/approvals'
const TABS = ['open', 'done'] as const
type Tab = (typeof TABS)[number]

const TAB_LABEL: Record<Tab, string> = { open: '대기', done: '완료' }

const IMPACT_TONE: Record<WorkPriority, string> = {
  Critical: 'bg-critical/15 text-critical',
  High: 'bg-warning/15 text-warning',
  Medium: 'bg-raised text-ink-dim',
  Low: 'bg-raised text-ink-muted',
}

const IMPACT_RANK: Record<WorkPriority, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }

export default async function ApprovalsPage(props: PageProps<'/approvals'>) {
  const params = await props.searchParams
  const tab: Tab = oneOf(firstParam(params.tab), TABS) ?? 'open'
  const businessFilter = firstParam(params.business)
  const selectedId = firstParam(params.id)

  const repo = await getRepository()
  const [decisions, businesses, audit, user] = await Promise.all([
    repo.listDecisions(),
    repo.listBusinesses(),
    repo.listDecisionAudit(),
    currentUser(),
  ])

  const isOpen = (d: Decision) => d.status === 'Open'
  const byTab = decisions.filter((d) => (tab === 'open' ? isOpen(d) : !isOpen(d)))
  const shown = businessFilter ? byTab.filter((d) => d.business_id === businessFilter) : byTab

  /** 완료 탭의 정렬 기준. 결정별 마지막 처리 시각을 audit_log에서 낸다. */
  const handledAt = new Map<string, string>()
  audit.forEach((a) => {
    const seen = handledAt.get(a.decision_id)
    if (!seen || Date.parse(a.occurred_at) > Date.parse(seen)) {
      handledAt.set(a.decision_id, a.occurred_at)
    }
  })

  // 대기는 중요도 → 마감 순, 완료는 최근 처리한 것이 위. 두 탭이 답하는 질문이 다르다.
  const ordered = [...shown].sort((a, b) =>
    tab === 'open'
      ? IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || a.deadline.localeCompare(b.deadline)
      : Date.parse(handledAt.get(b.decision_id) ?? '0') -
          Date.parse(handledAt.get(a.decision_id) ?? '0') ||
        b.deadline.localeCompare(a.deadline),
  )

  // ?id=가 지금 목록에 없으면(탭을 옮겼거나 방금 처리했다) 맨 위를 연다. 빈 오른쪽 칸을 두지 않는다.
  const selected = ordered.find((d) => d.decision_id === selectedId) ?? ordered[0]

  const history: DecisionAuditRecord[] = selected
    ? audit
        .filter((a) => a.decision_id === selected.decision_id)
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    : []

  const tabOptions: FilterOption[] = TABS.map((t) => ({
    label: TAB_LABEL[t],
    href: withParams(BASE, { tab: t, business: businessFilter }),
    active: tab === t,
    count: decisions.filter((d) => (t === 'open' ? isOpen(d) : !isOpen(d))).length,
  }))

  const businessOptions: FilterOption[] = [
    {
      label: '전체',
      href: withParams(BASE, { tab }),
      active: !businessFilter,
      count: byTab.length,
    },
    ...businesses.map((b) => ({
      label: b.name,
      href: withParams(BASE, { tab, business: b.business_id }),
      active: businessFilter === b.business_id,
      count: byTab.filter((d) => d.business_id === b.business_id).length,
    })),
  ]

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="stamp"
        title="전자결재"
        code="CH-041"
        description="승인·거절·수정요청·위임. 처리하면 결정 상태가 옮겨지고 감사 로그에 한 줄이 남는다."
      >
        <span className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim tnum">
          오늘 처리 <span className="font-semibold text-ink">{countOn(audit, dayKey())}</span>건
        </span>
      </PageHeader>

      {/* 기안(DEFERRED D-10 선택지 A). 올릴 수 있는 회사가 없으면 폼 자체를 내지 않는다 —
          회사 선택지가 빈 폼은 저장을 눌러야 이유를 알 수 있다. */}
      {canDraftDecision(user) && businesses.length > 0 ? (
        <div className="mt-3">
          <DraftDecision businesses={businesses} />
        </div>
      ) : null}

      <div className="mt-4 space-y-2 rounded-xl border border-line-soft bg-panel/60 px-3.5 py-3">
        <FilterChips label="탭" options={tabOptions} />
        <FilterChips label="회사" options={businessOptions} />
      </div>

      <div className="mt-3 grid grid-cols-12 gap-3.5 pb-6">
        <div className="col-span-12 xl:col-span-5">
          {ordered.length === 0 ? (
            <p className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center text-[12.5px] text-ink-muted">
              {tab === 'open' ? '대기 중인 결재가 없습니다.' : '처리한 결재가 없습니다.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {ordered.map((d) => (
                <li key={d.decision_id}>
                  <Link
                    href={withParams(BASE, { tab, business: businessFilter, id: d.decision_id })}
                    aria-current={selected?.decision_id === d.decision_id ? 'true' : undefined}
                    className={`block rounded-xl border px-3.5 py-3 transition-colors ${
                      selected?.decision_id === d.decision_id
                        ? 'border-accent bg-raised'
                        : 'border-line-soft bg-panel hover:border-line'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${IMPACT_TONE[d.impact]}`}
                      >
                        {WORK_PRIORITY_LABEL_KO[d.impact]}
                      </span>
                      <span className="truncate text-[11px] text-ink-muted">
                        {businessName(businesses, d.business_id)}
                      </span>
                      <span
                        className={`ml-auto shrink-0 text-[11px] font-semibold tnum ${
                          dDay(d.deadline) < 0 && d.status === 'Open'
                            ? 'text-critical'
                            : 'text-ink-dim'
                        }`}
                      >
                        {d.status === 'Open'
                          ? formatDDay(d.deadline)
                          : DECISION_STATUS_LABEL_KO[d.status]}
                      </span>
                    </span>
                    <span className="mt-1 block text-[13px] leading-snug font-semibold">
                      {d.title}
                    </span>
                    {d.attachment_url ? (
                      <span className="mt-1 flex items-center gap-1 text-[10.5px] text-ink-muted">
                        <Icon name="file-text" className="size-3" />
                        첨부 있음
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="col-span-12 xl:col-span-7">
          {selected ? (
            <ApprovalDetail
              decision={selected}
              businessName={businessName(businesses, selected.business_id)}
              history={history}
            />
          ) : (
            <p className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center text-[12.5px] text-ink-muted">
              왼쪽에서 결재를 고르면 내용과 처리 이력이 여기 열립니다.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
