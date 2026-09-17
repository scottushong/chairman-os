import { projectClock } from '@/lib/chairman-project'
import type { ChairmanProject, IsoDate } from '@/types'

/**
 * /ai 아침 루틴 맨 위. 장기 프로젝트 하나에 한 줄 + 진행바.
 * "{title} · D-{n} · {경과일}/{총일} ({pct}%)" — 여러 개면 나란히 선다.
 *
 * 숫자는 저장값이 아니라 today로 계산한 값이다(lib/chairman-project.ts).
 */
export function ProjectCounters({ projects, today }: { projects: ChairmanProject[]; today: IsoDate }) {
  if (projects.length === 0) return null
  return (
    <section aria-label="장기 프로젝트" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
      {projects.map((p) => {
        const c = projectClock(p, today)
        return (
          <div key={p.project_id} className="rounded-xl border border-accent/30 bg-panel px-4 py-3.5">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[14px] leading-snug tnum">
              <span className="font-semibold text-ink">{p.title}</span>
              <span className="text-ink-muted">·</span>
              <span className="font-semibold text-accent">{c.label}</span>
              <span className="text-ink-muted">·</span>
              <span className="text-ink-dim">
                {c.elapsed}/{c.total} ({c.pct}%)
              </span>
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={c.pct}
              aria-label={`${p.title} 경과율`}
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-raised"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${c.pct}%` }} />
            </div>
            {p.this_month_action ? (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-dim">
                <span className="text-ink-muted">이번 달 · </span>
                {p.this_month_action}
              </p>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
