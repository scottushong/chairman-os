import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { BriefTimezone } from '@/components/settings/brief-timezone'
import { ChairmanProjectEditor } from '@/components/settings/chairman-project-editor'
import { KakaoConnect } from '@/components/settings/kakao-connect'
import { ManifestoEditor } from '@/components/settings/manifesto-editor'
import { Icon } from '@/components/ui/icon'
import { canEditChairmanRoutine } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday, orderProjects, projectClock } from '@/lib/chairman-project'
import { decideChairmanTimezone } from '@/lib/chairman-timezone'
import { formatDateTime } from '@/lib/format'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import { CHAIRMAN_PROJECT_STATUS_LABEL_KO } from '@/types'

/**
 * /settings/chairman — 회장 루틴의 내용을 넣는 자리 (Phase 3-B).
 *
 * 장기 프로젝트와 선언문은 시드가 없다. 회장 개인의 문장이라 git에 들어가면 안 된다(0014).
 * 404로 막는 것은 안내다. 실제 문은 0014의 RLS가 지킨다 — /settings/users와 같은 이유로 403이 아니다.
 */
export default async function ChairmanSettingsPage(props: PageProps<'/settings/chairman'>) {
  const user = await currentUser()
  if (!canEditChairmanRoutine(user)) notFound()

  const params = await props.searchParams
  const repo = await getRepository()
  const [projects, manifesto, kakao, briefTz, events] = await Promise.all([
    repo.listChairmanProjects(),
    repo.getChairmanManifesto(),
    repo.getKakaoConnection(),
    repo.getBriefTimezone(),
    repo.listEvents(),
  ])
  // 장기 프로젝트의 D-day는 그대로 KST다 — 회장이 어디 있느냐로 장부 눈금이 흔들리면
  // 어제 본 D-780이 오늘 D-781이 아닌 날이 생긴다(lib/ai/night-brief.ts kstDate 주석).
  const today = kstToday()

  /**
   * 아침 알림이 **지금** 어느 시간대로 판정되고 있는가 (Phase 3-C 현지 시간).
   * 야간 Job이 매시 틱에서 부르는 것과 **같은 순수 함수**다 — 다른 걸 쓰면 화면이 말하는
   * 시각과 실제로 오는 시각이 갈라지고, 그 어긋남은 아침에만 드러난다.
   */
  const tzDecision = decideChairmanTimezone({
    manualTz: briefTz.brief_tz,
    trips: events.filter((e) => e.kind === 'Trip'),
    deviceTz: briefTz.current_tz,
    now: new Date(),
  })

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

      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="bell" className="size-4 text-ink-dim" />
          카카오 아침 알림
        </h2>
        <p className="mt-1 mb-2 text-[10.5px] text-ink-muted">
          {/* GitHub Actions의 schedule도 정시에 오지 않는다(몇 분~수십 분 지연). 화면이
              '06시 정각'으로 단정하면 06:40에 온 날 회장은 무언가 고장난 줄 안다 —
              그래서 폭(06~10시)을 먼저 말한다. 판정 정책은 lib/chairman-timezone.ts에 있다. */}
          아침 브리핑 06:00 (현지 시간 자동) — 그룹 브리핑 앞부분과 전문 링크가 회장님
          카카오톡으로 갑니다. 스케줄러 지연으로 조금 늦을 수 있고, 현지 10시를 넘기면 그날은
          건너뜁니다. 토큰은 서버에만 저장되고 이 화면으로 내려오지 않습니다.
        </p>
        <div className="mb-2.5">
          <BriefTimezone
            value={briefTz.brief_tz}
            decided={tzDecision.timezone}
            source={tzDecision.source}
            tripTitle={tzDecision.trip?.title ?? null}
          />
        </div>
        <KakaoConnect connection={kakao} notice={firstParam(params.kakao)} now={new Date().toISOString()} />
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
