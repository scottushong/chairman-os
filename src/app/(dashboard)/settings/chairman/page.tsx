import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { ChairmanProjectEditor } from '@/components/settings/chairman-project-editor'
import { ManifestoEditor } from '@/components/settings/manifesto-editor'
import { Icon } from '@/components/ui/icon'
import { canEditChairmanRoutine } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday, orderProjects, projectClock } from '@/lib/chairman-project'
import { formatDateTime } from '@/lib/format'
import { getRepository } from '@/lib/repository'
import { CHAIRMAN_PROJECT_STATUS_LABEL_KO } from '@/types'

/**
 * /settings/chairman — 회장 루틴의 내용을 넣는 자리 (Phase 3-B).
 *
 * 장기 프로젝트와 선언문은 시드가 없다. 회장 개인의 문장이라 git에 들어가면 안 된다(0014).
 * 404로 막는 것은 안내다. 실제 문은 0014의 RLS가 지킨다 — /settings/users와 같은 이유로 403이 아니다.
 */
export default async function ChairmanSettingsPage() {
  const user = await currentUser()
  if (!canEditChairmanRoutine(user)) notFound()

  const repo = await getRepository()
  const [projects, manifesto] = await Promise.all([
    repo.listChairmanProjects(),
    repo.getChairmanManifesto(),
  ])
  const today = kstToday()

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <PageHeader
        icon="crown"
        title="회장 루틴"
        code="Phase 3-B"
        description="장기 프로젝트와 선언문은 /ai 아침 루틴 맨 위에 올라가고, 야간 브리핑이 우선순위를 매기는 기준이 됩니다."
      >
        <Link
          href="/ai"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          아침 루틴 보기
        </Link>
      </PageHeader>

      <section className="mt-4 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="target" className="size-4 text-ink-dim" />
          장기 프로젝트
          <span className="text-[11px] font-normal text-ink-muted tnum">{projects.length}건</span>
        </h2>
        <p className="mt-1 text-[10.5px] text-ink-muted">
          D-day와 경과율은 저장하지 않습니다. 매일 오늘 날짜(KST)로 다시 계산합니다.
        </p>

        {projects.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {orderProjects(projects).map((p) => {
              const c = projectClock(p, today)
              return (
                <li key={p.project_id} className="rounded-lg px-2 py-2 hover:bg-raised/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold">{p.title}</span>
                    <span className="text-[11px] font-semibold text-accent tnum">{c.label}</span>
                    <span className="text-[11px] text-ink-muted tnum">
                      {p.start_date} → {p.target_date} · {c.elapsed}/{c.total} ({c.pct}%)
                    </span>
                    <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">
                      {CHAIRMAN_PROJECT_STATUS_LABEL_KO[p.status]}
                    </span>
                    <span className="ml-auto">
                      <ChairmanProjectEditor project={p} />
                    </span>
                  </div>
                  {p.this_month_action ? (
                    <p className="mt-0.5 text-[11px] text-ink-dim">이번 달 · {p.this_month_action}</p>
                  ) : null}
                  {p.note ? (
                    <p className="mt-0.5 text-[10.5px] whitespace-pre-line text-ink-muted">{p.note}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}

        <div className="mt-3">
          <ChairmanProjectEditor />
        </div>
      </section>

      <section className="mt-3.5 mb-6 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="book" className="size-4 text-ink-dim" />
          선언문
          <span className="text-[11px] font-normal text-ink-muted tnum">
            {manifesto.updated_at ? `${formatDateTime(manifesto.updated_at)} 저장` : '아직 없음'}
          </span>
        </h2>
        <p className="mt-1 mb-2 text-[10.5px] text-ink-muted">
          야간 브리핑은 이 글을 요약하거나 인용하지 않습니다. 오늘 회사 상황의 우선순위를 매기는 기준으로만 씁니다.
        </p>
        <ManifestoEditor initial={manifesto.body} />
      </section>
    </div>
  )
}
