import Link from 'next/link'

import {
  AiAnalysis,
  BlindNote,
  CeoHandling,
  Measured,
  ScoreLevel,
  SeverityChip,
  StatusChip,
} from '@/components/attention/pieces'
import { TriageButtons } from '@/components/attention/triage-buttons'
import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { recordScreenRead } from '@/lib/activity-record'
import {
  attentionRows,
  filterExceptions,
  summarizeAttention,
  type AttentionFilter,
  type AttentionRow,
} from '@/lib/attention/screen'
import { currentUser } from '@/lib/auth/session'
import { firstParam, oneOf, withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import {
  EXCEPTION_STATUS,
  EXCEPTION_STATUS_LABEL_KO,
  type ExceptionStatus,
} from '@/types'

/**
 * `/attention` — 주의 전체 목록 (Phase 7 블록 B-3 · §18 · §19).
 *
 * 원문: *"/attention 전체 목록: 열림/관찰 중/종료, 규칙별·회사별 필터, 이력."*
 *
 * ■ 이 화면이 답하는 질문 ■ 대시보드 카드가 «오늘 어디를 볼 것인가»라면 이 화면은
 * «무엇이 있었나»다. 그래서 순서도 다르다 — 카드는 등급 순(급한 것이 위), 이 목록은
 * **감지 순**(최근이 위)이다. 두 순서를 하나로 맞추면 한쪽 질문에 답을 못 한다.
 *
 * ■ 필터는 URL에 둔다(HANDOVER §2 ④ · `lib/query.ts`) ■ 값이 없으면 키를 아예 뺀다 —
 * `?status=`가 붙은 URL과 안 붙은 URL이 같은 화면을 뜻하면 «지금 어느 탭이 켜져 있나»를
 * 판정하는 자리가 두 곳으로 갈라진다. 필터가 걸린 화면을 그대로 남에게 보낼 수 있어야 한다.
 *
 * ■ 못 보는 것을 «없는 것»으로 그리지 않는다 ■ `exceptions_read`가 좁아서 TeamLead·Member는
 * 0행을 받는다. 그들에게 «주의 0건»·«전 회사 정상»이라고 적지 않는다 — 비어 있는 목록과
 * «못 보는 목록»은 **다른 문장**을 받는다.
 *
 * ■ AI Query 자리는 짓지 않았다 ■ 원문의 "왜 DY가 yellow인가?"는 컨트롤러가 블록 B에서
 * 빼기로 판정했고 DEFERRED에 적혀 있다 — 예외가 비어 있는 표는 그 질문에 답할 수 없고,
 * 답할 수 없는 자리에 모델을 붙이면 모델이 지어낸다.
 */
export default async function AttentionPage(props: PageProps<'/attention'>) {
  await recordScreenRead({ path: '/attention', kind: 'page' })

  const params = await props.searchParams
  const filter: AttentionFilter = {
    status: oneOf<ExceptionStatus>(firstParam(params.status), EXCEPTION_STATUS),
    rule: firstParam(params.rule),
    biz: firstParam(params.biz),
  }

  const [user, repo] = await Promise.all([currentUser(), getRepository()])
  const [businesses, exceptions, rules, scores, financeKpis, ledger] = await Promise.all([
    repo.listBusinesses(),
    repo.listExceptions(),
    repo.listExceptionRules(),
    repo.listAttentionScores(),
    repo.listFinanceKpis(),
    repo.loadFinanceLedger(),
  ])

  const visible = businesses.filter((b) => b.visible)
  // 접는 자리는 대시보드 카드와 **같은 함수**다. 여기서 다시 세지 않는다.
  const view = summarizeAttention({
    businesses: visible,
    exceptions,
    rules,
    scores,
    financeKpis,
    ledger,
    role: user?.role,
  })
  const rows = attentionRows({ businesses: visible, exceptions, rules, scores })
  const shown = filterExceptions(rows, filter)
  const canTriage = user?.role === 'Chairman' || user?.role === 'BusinessCEO'

  /** 탭 한 칸의 건수. **필터가 걸린 뒤의 수가 아니라 상태별 전체 수**다. */
  const countOf = (status: ExceptionStatus | undefined) =>
    status === undefined ? rows.length : rows.filter((r) => r.exception.status === status).length

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-5">
      <PageHeader
        icon="bell"
        title="주의"
        code="§18 Exception Engine · §19 Attention Score"
        description="규칙이 걸려서 생긴 예외입니다. 회장님이 어디를 볼 것인지 가리키는 목록이고, 결정은 회장님이 합니다."
      >
        <Link
          href="/attention/rules"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          규칙 · 임계값
        </Link>
      </PageHeader>

      {/* ───────── 한 줄 요약. 정상과 «재지 못함»을 따로 적는다 ───────── */}
      {view.readable ? (
        <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile
            label="주의가 걸린 회사"
            value={`${view.attentionCompanies.length}개사`}
            note={
              view.attentionCompanies.length === 0
                ? '지금 열린 RED/YELLOW 예외가 있는 회사가 없습니다.'
                : '열린 RED/YELLOW 예외가 하나라도 있는 회사입니다.'
            }
          />
          <Tile
            label="정상"
            value={`${view.normal.length}개사`}
            note="재어 봤고 열린 RED/YELLOW가 없는 회사입니다. 재지 못한 회사는 여기 들어 있지 않습니다."
          />
          <Tile
            label="재지 못한 회사"
            value={`${view.unmeasured.length}개사`}
            note={
              view.unmeasured.length === 0
                ? '모든 회사의 수치 규칙을 실제로 재었습니다.'
                : '«이상 없음»이 아니라 «재지 못했다»입니다. 아래에 회사별 이유가 있습니다.'
            }
          />
        </section>
      ) : (
        <div className="mt-4 rounded-xl border border-line-soft bg-panel p-3.5">
          <BlindNote />
        </div>
      )}

      {view.readable && view.unmeasured.length > 0 ? (
        <section className="mt-3 rounded-xl border border-line-soft bg-panel p-3.5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Icon name="shield" className="size-4 text-ink-dim" />
            재지 못한 회사
            <span className="rounded bg-raised px-1.5 py-0.5 text-[9.5px] font-normal text-ink-dim">
              정상과 다른 칸입니다
            </span>
          </h2>
          <ul className="mt-2 space-y-1.5">
            {view.unmeasured.map((u) => (
              <li key={u.business_id} className="rounded-lg bg-raised px-3 py-2">
                <p className="text-[11.5px] font-semibold text-ink">{u.name}</p>
                {/* 이유 없이는 세지 않는다 — «못 쟀다»는 이유가 곧 그 사실의 근거다. */}
                <ul className="mt-0.5 space-y-0.5">
                  {u.reasons.map((r) => (
                    <li key={r} className="text-[10.5px] leading-relaxed text-ink-muted">
                      · {r}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ───────── 탭과 필터. 전부 URL이다 ───────── */}
      <nav className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="상태">
        <Tab href={withParams('/attention', { rule: filter.rule, biz: filter.biz })} on={!filter.status}>
          전체 {countOf(undefined)}
        </Tab>
        {EXCEPTION_STATUS.map((s) => (
          <Tab
            key={s}
            href={withParams('/attention', { status: s, rule: filter.rule, biz: filter.biz })}
            on={filter.status === s}
          >
            {EXCEPTION_STATUS_LABEL_KO[s]} {countOf(s)}
          </Tab>
        ))}
      </nav>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <FilterRow
          label="회사"
          all={withParams('/attention', { status: filter.status, rule: filter.rule })}
          allOn={!filter.biz}
          items={visible.map((b) => ({
            key: b.business_id,
            label: b.name,
            href: withParams('/attention', {
              status: filter.status,
              rule: filter.rule,
              biz: b.business_id,
            }),
            on: filter.biz === b.business_id,
          }))}
        />
        <FilterRow
          label="규칙"
          all={withParams('/attention', { status: filter.status, biz: filter.biz })}
          allOn={!filter.rule}
          items={rules.map((r) => ({
            key: r.rule_key,
            label: r.name,
            href: withParams('/attention', {
              status: filter.status,
              biz: filter.biz,
              rule: r.rule_key,
            }),
            on: filter.rule === r.rule_key,
          }))}
        />
      </div>

      {/* ───────── 목록 ───────── */}
      <section className="mt-3 space-y-2">
        {shown.length === 0 ? (
          <p className="rounded-lg bg-raised px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted">
            {view.readable
              ? '이 조건에 해당하는 예외가 없습니다. (필터를 지우면 전체가 보입니다)'
              : /* 못 보는 계정에게는 «없다»고 말하지 않는다. */
                '이 계정에서는 예외 목록이 집계되지 않습니다 — 위의 안내를 보십시오.'}
          </p>
        ) : (
          shown.map((row) => <Row key={row.exception.id} row={row} canTriage={canTriage} />)
        )}
      </section>

      <p className="mt-3 text-[10px] leading-relaxed text-ink-muted">
        이 목록의 등급은 «얼마나 나쁜가»가 아니라 «누가 손대는가»입니다(§19 — RED 회장 결정
        · YELLOW 회장 인지 · GREEN CEO 처리). 점수 옆의 «여섯 축 중 N개 없음»은 그 등급이 몇
        개의 축으로 난 것인지를 말합니다 — 오늘 출처가 있는 축은 재무 하나뿐입니다.
      </p>

      <div className="pb-6" />
    </div>
  )
}

/** 예외 한 줄. 카드와 **같은 조각들**을 쓴다 — 라벨이 한 화면에서만 빠지는 길을 막는다. */
function Row({ row, canTriage }: { row: AttentionRow; canTriage: boolean }) {
  return (
    <article className="rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <SeverityChip level={row.exception.severity} />
        <StatusChip status={row.exception.status} until={row.exception.monitor_until} />
        <span className="text-[12.5px] font-semibold text-ink">{row.business_name}</span>
        <span className="text-[11.5px] text-ink-dim">{row.rule_name}</span>
        <Measured row={row} />
        {row.exception.period ? (
          <span className="text-[10px] text-ink-muted tnum">기간 {row.exception.period}</span>
        ) : null}
        <span className="ml-auto text-[10px] text-ink-muted tnum">
          감지 {row.exception.detected_at.slice(0, 10)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <ScoreLevel row={row} />
        <CeoHandling handling={row.exception.ceo_handling} />
        {row.exception.chairman_action_required ? (
          <span className="rounded bg-critical/15 px-1.5 py-0.5 text-[9.5px] font-bold text-critical">
            회장 결정 필요
          </span>
        ) : null}
      </div>

      <div className="mt-1.5">
        <AiAnalysis analysis={row.exception.ai_analysis} />
      </div>

      {/*
       * 이력 — 같은 (회사 · 규칙)의 **지난 기간**들. (회사·규칙·기간)이 0035의 unique라
       * «지난 건»은 곧 «다른 기간의 건»이다. 0건이면 그 사실을 적는다 — 빈 자리를 두면
       * «이력을 못 읽었다»와 «처음 걸렸다»가 구별되지 않는다.
       */}
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[10.5px] text-ink-dim">
          이력 {row.history.length}건 (같은 회사 · 같은 규칙의 지난 기간)
        </summary>
        {row.history.length === 0 ? (
          <p className="mt-1 text-[10.5px] text-ink-muted">
            이 규칙이 이 회사에서 걸린 것은 이번이 처음입니다.
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {row.history.map((h) => (
              <li key={h.id} className="text-[10.5px] text-ink-muted tnum">
                {h.period ?? '기간 없음'} · {h.severity} · {EXCEPTION_STATUS_LABEL_KO[h.status]} ·
                감지 {h.detected_at.slice(0, 10)}
              </li>
            ))}
          </ul>
        )}
      </details>

      {/* 종료된 건에는 버튼을 두지 않는다 — 다시 닫는 버튼은 누를 이유가 없다. */}
      {canTriage && row.exception.status !== 'closed' ? (
        <div className="mt-2">
          <TriageButtons exceptionId={row.exception.id} businessId={row.exception.business_id} />
        </div>
      ) : null}
    </article>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-dim">
        <Icon name="target" className="size-3.5" />
        {label}
      </p>
      <p className="mt-1 text-[22px] font-bold leading-none text-ink tnum">{value}</p>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-muted">{note}</p>
    </div>
  )
}

function Tab({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={`rounded-md px-2.5 py-1.5 text-[11.5px] tnum transition-colors ${
        on ? 'bg-accent text-app font-semibold' : 'border border-line text-ink-dim hover:text-ink'
      }`}
    >
      {children}
    </Link>
  )
}

function FilterRow({
  label,
  all,
  allOn,
  items,
}: {
  label: string
  all: string
  allOn: boolean
  items: { key: string; label: string; href: string; on: boolean }[]
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-1">
      <span className="mr-0.5 text-[10.5px] text-ink-dim">{label}</span>
      <Chip href={all} on={allOn}>
        전체
      </Chip>
      {items.map((i) => (
        <Chip key={i.key} href={i.href} on={i.on}>
          {i.label}
        </Chip>
      ))}
    </div>
  )
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded px-1.5 py-0.5 text-[10.5px] transition-colors ${
        on ? 'bg-raised font-semibold text-ink' : 'text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </Link>
  )
}
