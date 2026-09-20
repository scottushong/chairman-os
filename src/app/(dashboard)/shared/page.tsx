import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { currentUser } from '@/lib/auth/session'
import { formatDateTime } from '@/lib/format'
import { getRepository } from '@/lib/repository'
import { SHARE_ENTITY_LABEL_KO, type ShareEntityTable, type ShareRecord } from '@/types'

/**
 * Phase 6-1 블록 C-2 — 나에게 공유된 것 전부.
 *
 * 문서·업무·프로젝트 셋을 한 화면에 모은다. 셋이 서로 다른 목록 화면에 흩어져 있으면
 * "나에게 지금 무엇이 열려 있나"를 아무 데서도 답할 수 없다 — 그것이 이 화면이 답하는
 * 유일한 질문이다.
 *
 * **만료된 것은 여기 오지 않는다.** 0025의 shared_with_me()가 이미 거르고, 어댑터도 같은
 * 조건으로 읽는다. 화면에서 다시 거르지 않는다 — 규칙이 두 곳으로 갈라지는 자리다.
 * 사라진 이유를 사람이 알 수 있게, 빈 상태 문구가 '기간이 끝나면 사라진다'를 말한다.
 *
 * 제목은 대상 표에서 가져온다. 대상이 지워졌거나(유령 행) 그 사이에 회사가 바뀌어
 * 더는 볼 수 없으면 제목 자리가 비는데, 그때는 '대상을 볼 수 없습니다'로 적고 링크를
 * 걸지 않는다 — 없는 화면으로 보내면 404가 뜬다.
 */
export default async function SharedWithMePage() {
  const user = await currentUser()
  // 로그인하지 않았으면 '나'가 없다. 그 경우 볼 것이 아무것도 없다(proxy가 먼저 /login으로 보낸다).
  if (!user) notFound()

  const repo = await getRepository()
  const [shares, documents, tasks, projects] = await Promise.all([
    repo.listSharesWithMe(user.user_id),
    repo.listDocuments(),
    repo.listTasks(),
    repo.listProjects(),
  ])

  const titleOf = (s: ShareRecord): string | null => {
    if (s.entity_table === 'documents') {
      return documents.find((d) => d.document_id === s.entity_id)?.title ?? null
    }
    if (s.entity_table === 'tasks') return tasks.find((t) => t.task_id === s.entity_id)?.title ?? null
    return projects.find((p) => p.project_id === s.entity_id)?.name ?? null
  }

  const hrefOf = (table: ShareEntityTable, id: string) =>
    table === 'documents'
      ? `/documents/${encodeURIComponent(id)}`
      : table === 'tasks'
        ? `/tasks/${encodeURIComponent(id)}`
        : `/projects/${encodeURIComponent(id)}`

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="eye"
        title="나에게 공유된 것"
        code="CH-049"
        description="문서·업무·프로젝트 중 다른 사람이 나에게 열어 준 것들입니다. 기간이 끝나면 목록에서 사라집니다."
      >
        <Link
          href="/"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          대시보드로
        </Link>
      </PageHeader>

      <section className="mt-4 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="users" className="size-4 text-ink-dim" />
          공유받은 항목
          <span className="text-[11px] font-normal text-ink-muted tnum">{shares.length}건</span>
        </h2>

        {shares.length === 0 ? (
          <p className="py-10 text-center text-[12px] leading-relaxed text-ink-muted">
            나에게 공유된 것이 없습니다.
            <br />
            기간이 끝난 공유는 사람이 회수를 잊어도 이 목록에서 사라집니다 — 여기 없다는 것은
            지금 열려 있지 않다는 뜻입니다.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {shares.map((s) => {
              const title = titleOf(s)
              return (
                <li key={s.share_id} className="rounded-lg px-2 py-2 transition-colors hover:bg-raised/60">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">
                      {SHARE_ENTITY_LABEL_KO[s.entity_table]}
                    </span>
                    {title ? (
                      <Link
                        href={hrefOf(s.entity_table, s.entity_id)}
                        className="text-[12.5px] font-semibold transition-colors hover:text-accent"
                      >
                        {title}
                      </Link>
                    ) : (
                      <span className="text-[12.5px] font-semibold text-ink-muted">
                        대상을 볼 수 없습니다 ({s.entity_id})
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-ink-dim tnum">
                      {remainingText(s.expires_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10.5px] text-ink-muted tnum">
                    {s.shared_by_name ?? '이름 없음'}이(가) {formatDateTime(s.created_at)}에 열었습니다
                    {s.expires_at ? ` · ${s.expires_at.slice(0, 10)}까지` : ' · 기간 없음'}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="mt-3 pb-6 text-[11px] leading-relaxed text-ink-dim">
        회수는 공유를 연 사람만 할 수 있습니다. 기간을 늘리려면 그 사람이 회수하고 다시 공유해야
        합니다 — 한 행을 늘렸다 줄였다 하면 &lsquo;언제까지였는가&rsquo;가 기록에 남지 않습니다.
      </p>
    </div>
  )
}

/** 남은 기간. 만료된 것은 애초에 오지 않으므로 '만료됨'은 경합 상황에서만 보인다. */
function remainingText(expiresAt: string | null): string {
  if (!expiresAt) return '무기한'
  const ms = Date.parse(expiresAt) - Date.now()
  if (ms <= 0) return '만료됨'
  const days = Math.floor(ms / 86_400_000)
  return days >= 1 ? `${days}일 남음` : `${Math.max(1, Math.floor(ms / 3_600_000))}시간 남음`
}
