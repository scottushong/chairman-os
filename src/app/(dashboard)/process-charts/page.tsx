import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { ProcessSyncPanel } from '@/components/process/process-sync-panel'
import { ProcessChartManager } from '@/components/settings/process-chart-manager'
import { SheetFrame } from '@/components/ui/sheet-frame'
import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { formatDateTime } from '@/lib/format'
import { embedSrc } from '@/lib/process-chart'
import { sheetsConnected } from '@/lib/process-sync/service'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import type { ProcessChartItem, ProcessChartSync } from '@/types'

/**
 * `/process-charts` — 프로세스 차트 (0071, 대표 결정 2026-10-12). 사이드 메뉴 «프로세스 차트».
 *
 * 탭 = 팀(연구소 · 영업 · 경영지원 …, 순서는 process_charts.sort_order). 각 탭:
 *   위    시트 그림(지금까지의 끼워 넣기 — «웹에 게시» 주소 그대로)
 *   아래  앱이 읽은 줄 목록 · 마지막 동기화 시각 · «지금 동기화» · 동기화 기록(경고 목록)
 *
 * 누가 어느 탭을 보는지는 0071 정책이 정한다 — 임원 이상 = 자기 회사 탭 전부, 팀장 · 팀원 = 자기 팀 탭만.
 * 화면은 다시 거르지 않는다(못 보는 탭은 목록에 아예 없다). 시트 주소 저장(아래 «시트 연결 관리»)은 대표 · CFO만.
 * 동기화로 들어온 업무는 업무 관리에서 고치지 못한다 — 고칠 곳은 시트다.
 */
export default async function ProcessChartsPage(props: PageProps<'/process-charts'>) {
  const params = await props.searchParams
  const repo = await getRepository()
  const [charts, businesses, items, syncs, user] = await Promise.all([
    repo.listProcessCharts(),
    repo.listBusinesses(),
    repo.listProcessChartItems(),
    repo.listProcessChartSyncs(200),
    currentUser(),
  ])
  // 0073 기능 스위치 «프로세스 차트» — 범위 밖이면 없는 화면.
  if (!(await featureOn(user, 'process_charts'))) notFound()
  const canEdit = user?.role === 'Chairman' || user?.role === 'GroupCFO'
  // 누른 사람 · 담당자 이름. 계정 목록은 그 사람에게 보이는 만큼만 온다(0026) — 못 찾으면 이메일 · «직원»으로.
  const names = new Map((await repo.listUserAccounts().catch(() => [])).map((p) => [p.user_id, p.display_name] as const))
  const appConnected = sheetsConnected()

  const wanted = Number(firstParam(params.tab))
  const chart = charts.find((c) => c.id === wanted) ?? charts[0] ?? null
  const business = chart ? businesses.find((b) => b.business_id === chart.business_id) : undefined
  const multiCompany = new Set(charts.map((c) => c.business_id)).size > 1

  const sameTeam = <T extends { business_id: string; team_name: string }>(r: T) =>
    !!chart && r.business_id === chart.business_id && r.team_name === chart.team_name
  const rows = items.filter(sameTeam).sort(byRow)
  const log = syncs.filter(sameTeam).slice(0, 10)
  const lastOk = log.find((s) => s.ok) ?? null
  const last = log[0] ?? null
  const connected = appConnected && !!chart?.sheet_id

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
      <PageHeader
        icon="grid"
        title="프로세스 차트"
        code="CH-055"
        description="팀별 업무 프로세스 시트를 보고, 시트의 업무를 업무 관리 · 캘린더로 가져옵니다. 고칠 곳은 시트입니다."
      />

      {charts.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line-soft bg-panel px-4 py-6 text-center text-t12 text-ink-muted">
          볼 수 있는 프로세스 차트가 없습니다. 팀장 · 팀원은 자기 팀 탭만 봅니다.
        </p>
      ) : (
        <nav className="mt-4 flex flex-wrap gap-1.5" aria-label="팀">
          {charts.map((c) => {
            const on = c.id === chart?.id
            const company = businesses.find((b) => b.business_id === c.business_id)?.name ?? c.business_id
            return (
              <Link
                key={c.id}
                href={`/process-charts?tab=${c.id}`}
                aria-current={on ? 'page' : undefined}
                className={`rounded-md border px-3 py-1.5 text-t12 transition-colors ${
                  on ? 'border-accent bg-accent/10 font-semibold text-ink' : 'border-line bg-panel text-ink-dim hover:border-accent hover:text-ink'
                }`}
              >
                {multiCompany ? `${company} · ` : ''}
                {c.team_name}
              </Link>
            )
          })}
        </nav>
      )}

      {chart ? (
        <div className="mt-4 space-y-4">
          <section className="rounded-xl border border-line-soft bg-panel p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-2">
              <h2 className="text-t13 font-semibold">{chart.title}</h2>
              <span className="text-t11 text-ink-muted">{business?.name ?? chart.business_id} · {chart.team_name}</span>
            </div>
            <SheetFrame src={embedSrc(chart.embed_url)} title={chart.title} className="h-[55vh] min-h-[320px] rounded-lg border border-line" />
          </section>

          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-t13 font-semibold">앱이 읽은 줄</h2>
                <p className="mt-0.5 text-t11h text-ink-muted">
                  {!appConnected
                    ? '연결 전 — 구글 시트 서비스 계정이 아직 연결되지 않았습니다.'
                    : !chart.sheet_id
                      ? '연결 전 — 이 탭에는 아직 시트 파일이 연결되지 않았습니다(대표 · CFO가 아래 «시트 연결 관리»에서 넣습니다).'
                      : lastOk
                        ? `마지막 동기화 ${formatDateTime(lastOk.synced_at)}`
                        : '아직 동기화한 적이 없습니다.'}
                </p>
                <p className="mt-0.5 text-t11 text-ink-muted">
                  시트 → 앱 한 방향입니다. 업무 관리에 들어온 업무는 앱에서 고치지 못합니다 — 시트에서 고치세요.
                </p>
              </div>
              <ProcessSyncPanel chartId={chart.id} connected={connected} lastSyncedAt={last?.synced_at ?? null} />
            </div>

            {rows.length === 0 ? (
              <p className="mt-4 text-center text-t12 text-ink-muted">읽은 줄이 없습니다.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-t11h">
                  <thead className="text-t10h text-ink-muted">
                    <tr className="border-b border-line-soft">
                      <th className="py-1.5 pr-2 font-normal">ID</th>
                      <th className="py-1.5 pr-2 font-normal">단계</th>
                      <th className="py-1.5 pr-2 font-normal">업무명</th>
                      <th className="py-1.5 pr-2 font-normal">담당</th>
                      <th className="py-1.5 pr-2 font-normal">시작일</th>
                      <th className="py-1.5 pr-2 font-normal">마감일</th>
                      <th className="py-1.5 pr-2 font-normal">상태</th>
                      <th className="py-1.5 font-normal">비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <ItemRow key={r.id} item={r} names={names} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="text-t13 font-semibold">동기화 기록</h2>
            {log.length === 0 ? (
              <p className="mt-2 text-t12 text-ink-muted">기록이 없습니다.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line-soft">
                {log.map((s) => (
                  <SyncRow key={s.id} sync={s} names={names} />
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {canEdit ? (
        <section className="mt-6">
          <h2 className="mb-2 text-t13 font-semibold">시트 연결 관리</h2>
          <ProcessChartManager charts={charts} businesses={businesses} canEdit={canEdit} />
        </section>
      ) : null}
    </div>
  )
}

function byRow(a: ProcessChartItem, b: ProcessChartItem): number {
  // 시트에 있는 줄이 먼저, 사라진 줄은 아래. 그다음 시트 ID(숫자가 섞여도 사람 순서로).
  if ((a.gone_at === null) !== (b.gone_at === null)) return a.gone_at === null ? -1 : 1
  return a.sheet_row_id.localeCompare(b.sheet_row_id, 'ko', { numeric: true })
}

const STATUS_TONE: Record<ProcessChartItem['status'], string> = {
  예정: 'text-ink-muted',
  진행: 'text-ink-dim',
  완료: 'text-ok',
  보류: 'text-warning',
}

function ItemRow({ item, names }: { item: ProcessChartItem; names: ReadonlyMap<string, string> }) {
  const gone = item.gone_at !== null
  return (
    <tr className={`border-b border-line-soft align-top ${gone ? 'opacity-60' : ''}`}>
      <td className="py-1.5 pr-2 tnum text-ink-dim">{item.sheet_row_id}</td>
      <td className="py-1.5 pr-2 text-ink-dim">{item.stage ?? '—'}</td>
      <td className="py-1.5 pr-2 text-ink">
        {item.task_id ? (
          <Link href={`/tasks/${encodeURIComponent(item.task_id)}`} className="hover:underline">
            {item.title}
          </Link>
        ) : (
          item.title
        )}
        {gone ? <span className="ml-1.5 rounded bg-raised px-1 text-t10 text-ink-muted">시트에서 사라짐</span> : null}
      </td>
      <td className="py-1.5 pr-2 text-ink-dim">
        {item.owner_user_id ? (names.get(item.owner_user_id) ?? item.assignee_email ?? '—') : <span className="text-warning">담당 미정</span>}
      </td>
      <td className="py-1.5 pr-2 tnum text-ink-dim">{item.start_on ?? '—'}</td>
      <td className="py-1.5 pr-2 tnum text-ink-dim">{item.due_on ?? '—'}</td>
      <td className={`py-1.5 pr-2 ${STATUS_TONE[item.status]}`}>{item.status}</td>
      <td className="py-1.5 text-ink-muted">{item.note ?? ''}</td>
    </tr>
  )
}

const TRIGGER_KO: Record<ProcessChartSync['trigger'], string> = { button: '버튼', open: '화면 열 때', cron: '자동(새벽)' }

function SyncRow({ sync, names }: { sync: ProcessChartSync; names: ReadonlyMap<string, string> }) {
  return (
    <li className="py-2 text-t11h">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="tnum text-ink-dim">{formatDateTime(sync.synced_at)}</span>
        <span className="text-ink-muted">
          {TRIGGER_KO[sync.trigger]}
          {sync.actor_user_id ? ` · ${names.get(sync.actor_user_id) ?? '직원'}` : ''}
        </span>
        {sync.ok ? (
          <span className="tnum text-ink-dim">
            읽은 줄 {sync.read_count} · 새로 {sync.new_count} · 바뀜 {sync.changed_count} · 사라짐 {sync.gone_count} · 건너뜀 {sync.skipped_count}
          </span>
        ) : (
          <span className="text-critical">실패 — {sync.error}</span>
        )}
      </div>
      {sync.warnings.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-t11 text-warning">경고 {sync.warnings.length}건</summary>
          <ul className="mt-1 space-y-0.5 pl-3 text-t11 text-ink-muted">
            {sync.warnings.map((w, i) => (
              <li key={i}>
                {w.row ? `${w.row}번째 줄 · ` : ''}
                {w.id ? `ID ${w.id} · ` : ''}
                {w.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  )
}
