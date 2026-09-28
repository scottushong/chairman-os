import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { Icon, type IconName } from '@/components/ui/icon'
import {
  ACTIVITY_DEDUP_MINUTES,
  ACTIVITY_KIND_LABEL_KO,
  ACTIVITY_ONLINE_MINUTES,
  ACTIVITY_RETENTION_DAYS,
  ACTIVITY_TIMELINE_DAYS,
  ANOMALY_BASIS_KO,
  ANOMALY_KIND,
  ANOMALY_LABEL_KO,
  detectAnomalies,
  loginsOn,
  onlineNow,
  type ActivityEvent,
  type ActivityPerson,
} from '@/lib/activity'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { formatDateTime } from '@/lib/format'
import { getRepository } from '@/lib/repository'
import { ROLE_LABEL_KO, type Role } from '@/types'

/**
 * /settings/activity — 회장 전용 접속 현황 (블록 7).
 *
 * ■ 이 화면이 무엇인가 ■
 * 감사 도구다. 감시 도구가 아니다. 그 둘을 가르는 것은 "무엇을 안 남기는가"와
 * "근거를 보여 주는가" 둘이고, 이 화면은 그 둘을 화면 위에서 스스로 말한다.
 *
 * ■ 회장만이다 — 두 겹으로 ■
 *   ① 화면: 아래 notFound(). 403이 아니라 404다(/settings/chairman과 같은 방식) —
 *      "여기 무언가 있는데 당신은 못 본다"는 말 자체가 정보다.
 *   ② 데이터: 0031 activity_events()가 회장이 아니면 0행을 준다. 화면이 역할을 보고
 *      안 부르는 것이 아니라, 불러도 0건이다. 한 겹이 느슨해져도 다른 겹이 남는다.
 *      (RLS만으로는 '회장만'이 되지 않는다 — 0026이 audit_log_read에 subtree 분기를
 *      얹어서 팀장은 자기 팀원의 줄을 본다. 그것은 0026이 정한 규칙이고 여기서
 *      뒤집지 않는다. 다만 이 화면의 데이터는 원문대로 회장 전용이다.)
 *
 * ■ 이 화면을 연 것도 기록에 남는다 ■
 * 회장이 예외가 되면 '누가 이 기록을 봤나'에 답할 수 없다. 그래서 첫 줄에서
 * 자기 자신을 기록한다 — 5분 억제가 걸려 있어 새로고침으로 줄이 늘지 않는다.
 */
export default async function ActivityPage() {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') notFound()

  await recordScreenRead({ path: '/settings/activity', kind: 'page' })

  const repo = await getRepository()
  const [events, accounts] = await Promise.all([
    repo.listActivityEvents(ACTIVITY_TIMELINE_DAYS),
    repo.listUserAccounts(),
  ])

  const people: ActivityPerson[] = accounts.map((a) => ({
    user_id: a.user_id,
    display_name: a.display_name,
    status: a.status,
    left_on: a.left_on,
    revoked_at: a.revoked_at,
  }))
  const nameOf = new Map(accounts.map((a) => [a.user_id, a.display_name]))
  const roleOf = new Map(accounts.map((a) => [a.user_id, a.role]))
  const who = (id: string | null) => (id ? nameOf.get(id) ?? `${id.slice(0, 8)}…` : '시스템')

  const online = onlineNow(events)
  const todayLogins = loginsOn(events, kstToday())
  const anomalies = detectAnomalies(events, people)

  // 사용자별 타임라인. 기록이 있는 사람만 줄을 세운다 — 한 줄도 없는 사람까지
  // 늘어놓으면 목록이 '사람 목록'이 되고, 이 화면은 사람 목록이 아니다.
  const timeline = new Map<string, ActivityEvent[]>()
  for (const e of events) {
    if (!e.actor_user_id) continue
    const list = timeline.get(e.actor_user_id)
    if (list) list.push(e)
    else timeline.set(e.actor_user_id, [e])
  }
  const timelineRows = [...timeline.entries()].sort(
    (a, b) => Date.parse(b[1][0].occurred_at) - Date.parse(a[1][0].occurred_at),
  )

  return (
    <div className="mx-auto max-w-[980px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="eye"
        title="접속 현황"
        code="블록 7"
        description={`누가 언제 무엇을 열었는지의 기록입니다. 최근 ${ACTIVITY_TIMELINE_DAYS}일을 봅니다.`}
      >
        <Link
          href="/settings"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          설정으로
        </Link>
      </PageHeader>

      {/* ───────── 이 화면이 남기는 것과 남기지 않는 것 ───────── */}
      <section className="mt-4 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-t13 font-semibold">
          <Icon name="shield" className="size-4 text-ink-dim" />
          이 기록에 무엇이 들어 있나
        </h2>
        <ul className="mt-1.5 space-y-1 text-t10h leading-relaxed text-ink-muted">
          <li>
            · 남기는 것: <b className="font-semibold text-ink-dim">사람 · 시각 · 경로 · 문서 id ·
            기기 요약 · 도시 · 시간대</b>.
          </li>
          <li>
            · <b className="font-semibold text-ink-dim">IP 원본은 남기지 않습니다.</b> 도시까지입니다.
            기록을 만드는 DB 함수에 IP를 받을 인자 자체가 없습니다. 기기도 &apos;Chrome ·
            Windows&apos; 같은 요약이고 브라우저가 보낸 원문 문자열은 저장하지 않습니다.
          </li>
          <li>
            · 같은 화면에 {ACTIVITY_DEDUP_MINUTES}분 안에 다시 들어간 것은 한 줄로 셉니다.
            새로고침 횟수는 기록되지 않습니다.
          </li>
          <li>
            · 보관 기간 <b className="font-semibold text-ink-dim">{ACTIVITY_RETENTION_DAYS}일</b>.
            그 뒤로는 회장님께도, 본인에게도 보이지 않습니다. 감사 기록이라 행을 지우지는
            않습니다 — 지울 수 있게 만드는 순간 감사 기록이 아니게 되기 때문입니다.
          </li>
          <li>
            · 이 화면을 연 것도 같은 방식으로 기록에 남습니다. 회장님이 예외가 되면
            &apos;누가 이 기록을 봤나&apos;에 답할 자리가 없어집니다.
          </li>
        </ul>
        <Link
          href="/privacy"
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          개인정보 처리방침의 열람 기록 항목
          <Icon name="chevron-right" className="size-3.5" />
        </Link>
      </section>

      {/* ───────── 현재 접속 중 ───────── */}
      <Section icon="clock" title="현재 접속 중" note={`최근 ${ACTIVITY_ONLINE_MINUTES}분 안에 기록이 있는 사람`}>
        {online.length === 0 ? (
          <Empty>지금 {ACTIVITY_ONLINE_MINUTES}분 안에 움직인 사람이 없습니다.</Empty>
        ) : (
          <ul className="space-y-1">
            {online.map((o) => (
              <li
                key={o.user_id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-raised px-3 py-2 text-t11h"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />
                <b className="font-semibold text-ink">{who(o.user_id)}</b>
                <span className="text-ink-dim">{roleLabel(roleOf.get(o.user_id))}</span>
                <code className="text-t10h text-ink-dim">{o.path ?? '—'}</code>
                <span className="ml-auto text-t10h text-ink-muted">
                  {formatDateTime(o.last_seen)} · {o.device ?? '—'} · {o.city ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ───────── 오늘 로그인 ───────── */}
      <Section icon="users" title="오늘 로그인" note={`${kstToday()} (KST) · 성공과 실패를 같이 봅니다`}>
        {todayLogins.length === 0 ? (
          <Empty>오늘 로그인 기록이 없습니다.</Empty>
        ) : (
          <ul className="space-y-1">
            {todayLogins.map((e, i) => (
              <li
                key={`${e.occurred_at}-${e.actor_user_id}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-raised px-3 py-2 text-t11h"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-t9h ${
                    e.ok === false ? 'bg-critical/15 text-critical' : 'bg-panel text-ink-dim'
                  }`}
                >
                  {e.ok === false ? '실패' : '성공'}
                </span>
                <b className="font-semibold text-ink">{who(e.actor_user_id)}</b>
                <span className="text-ink-dim">{roleLabel(roleOf.get(e.actor_user_id ?? ''))}</span>
                <span className="ml-auto text-t10h text-ink-muted">
                  {formatDateTime(e.occurred_at)} · {e.device ?? '—'} · {e.city ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ───────── 이상 징후 ───────── */}
      <Section
        icon="bell"
        title="이상 징후"
        note="무엇을 이상으로 보는지 아래에 적어 두었습니다 — 근거 없는 태그는 만들지 않습니다"
      >
        <dl className="mb-2.5 space-y-1">
          {ANOMALY_KIND.map((kind) => {
            const hits = anomalies.filter((a) => a.kind === kind)
            return (
              <div key={kind} className="rounded-lg bg-raised px-3 py-2">
                <dt className="flex flex-wrap items-baseline gap-1.5 text-t11h font-semibold text-ink">
                  {ANOMALY_LABEL_KO[kind]}
                  <span
                    className={`rounded px-1.5 py-0.5 text-t9h font-normal ${
                      hits.length > 0 ? 'bg-warning/15 text-warning' : 'bg-panel text-ink-dim'
                    }`}
                  >
                    {hits.length}건
                  </span>
                </dt>
                <dd className="mt-0.5 text-t10h leading-relaxed text-ink-muted">
                  판정 기준: {ANOMALY_BASIS_KO[kind]}
                </dd>
                {hits.length > 0 ? (
                  <ul className="mt-1.5 space-y-1">
                    {hits.map((a, i) => (
                      <li
                        key={`${a.kind}-${a.user_id}-${a.at}-${i}`}
                        className="rounded-md bg-panel px-2.5 py-1.5 text-t11"
                      >
                        <b className="font-semibold text-ink">{who(a.user_id)}</b>{' '}
                        <span className="text-ink-dim">{a.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </dl>
        <p className="text-t10 leading-relaxed text-ink-muted">
          태그는 사실의 요약이지 판단이 아닙니다. 새 도시는 출장일 수 있고, 심야 접속은
          시차일 수 있으며, 문서를 몰아 보는 것은 감사 준비일 수 있습니다 — 그래서 태그마다
          숫자와 시각을 같이 적어 두었습니다. 태그만 보고 사람을 부르지 않는 것이 이 화면의
          쓰임입니다.
        </p>
      </Section>

      {/* ───────── 사용자별 타임라인 ───────── */}
      <Section
        icon="layers"
        title={`사용자별 ${ACTIVITY_TIMELINE_DAYS}일 타임라인`}
        note={`기록이 있는 사람만 나옵니다 · 전체 ${events.length}줄`}
      >
        {timelineRows.length === 0 ? (
          <Empty>
            최근 {ACTIVITY_TIMELINE_DAYS}일 안에 기록이 없습니다. 기록은 화면을 열 때 쌓이기
            시작합니다.
          </Empty>
        ) : (
          <div className="space-y-2">
            {timelineRows.map(([userId, list]) => (
              <details key={userId} className="rounded-lg bg-raised px-3 py-2">
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 text-t11h">
                  <b className="font-semibold text-ink">{who(userId)}</b>
                  <span className="text-ink-dim">{roleLabel(roleOf.get(userId))}</span>
                  <span className="text-t10h text-ink-muted">{list.length}줄</span>
                  <span className="ml-auto text-t10h text-ink-muted">
                    마지막 {formatDateTime(list[0].occurred_at)}
                  </span>
                </summary>
                <ul className="mt-1.5 space-y-0.5">
                  {list.map((e, i) => (
                    <li
                      key={`${userId}-${e.occurred_at}-${i}`}
                      className="flex flex-wrap items-baseline gap-x-2 border-t border-line-soft py-1 text-t10h first:border-0"
                    >
                      <span className="tnum text-ink-dim">{formatDateTime(e.occurred_at)}</span>
                      <span className="text-ink-muted">
                        {e.action === 'login'
                          ? e.ok === false
                            ? '로그인 실패'
                            : '로그인'
                          : ACTIVITY_KIND_LABEL_KO[e.kind ?? 'page']}
                      </span>
                      <code className="text-ink-dim">{e.path ?? '—'}</code>
                      {/*
                        entity_table이 있을 때만 그린다. 로그인 줄도 entity_id를 갖고 있지만
                        (자기 계정의 uuid다) 그것은 '무엇을 열었나'가 아니라 '누구의 로그인인가'라,
                        사람 이름이 이미 줄 머리에 있는 자리에 uuid를 한 번 더 뿌리게 된다.
                      */}
                      {e.entity_table && e.entity_id ? (
                        <span className="text-ink-muted">
                          {e.entity_table} · {e.entity_id}
                        </span>
                      ) : null}
                      <span className="ml-auto text-ink-muted">
                        {e.device ?? '—'} · {e.city ?? '—'} · {e.tz ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </Section>

      <div className="pb-6" />
    </div>
  )
}

/* ------------------------------------------------------------------ 조각들 */

function roleLabel(role: Role | undefined): string {
  return role ? ROLE_LABEL_KO[role] : '—'
}

function Section({
  icon,
  title,
  note,
  children,
}: {
  icon: IconName
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-3 rounded-xl border border-line-soft bg-panel p-3.5 sm:mt-3.5">
      <h2 className="mb-2 flex flex-wrap items-baseline gap-1.5 text-t13 font-semibold">
        <Icon name={icon} className="size-4 text-ink-dim" />
        {title}
        <span className="rounded bg-raised px-1.5 py-0.5 text-t9h font-normal text-ink-dim">
          {note}
        </span>
      </h2>
      {children}
    </section>
  )
}

/** 비어 있는 것은 고장이 아니다. 왜 비었는지를 같이 적는다. */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-raised px-3 py-2.5 text-t11 text-ink-muted">{children}</p>
}
