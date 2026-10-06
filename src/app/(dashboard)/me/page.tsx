import Link from 'next/link'

import { ApprovalForm } from '@/components/approvals/approval-form'
import { NoticeStrip } from '@/components/groupware/notice-strip'
import { InstallHint } from '@/components/me/install-hint'
import { BundleComposer, TeamInbox } from '@/components/me/team-inbox'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { boss, bossEn } from '@/lib/boss'
import { kstToday } from '@/lib/chairman-project'
import { tr, type Lang } from '@/lib/i18n'
import { getRepository } from '@/lib/repository'
import { TASK_STATUS_LABEL_KO, type Decision, type Role } from '@/types'

/**
 * `/me` — 직원 홈 (Phase 6-2 블록 1). Member · TeamLead가 로그인하면 여기로 온다.
 *
 * 폰 우선. 탭: 내 업무 / 내 요청 / 채팅 / 팀. TeamLead는 둘 더 — 팀 요청함 / 회장 기안(취합).
 * 탭은 주소(?tab=)에 싣는다: 폰 하단 탭(MobileTabs)이 같은 주소를 쓴다.
 *
 * 요청 올리기는 **3탭 이내**: «요청 올리기»(1) → 양식(2) → 올리기(3). 양식은 Phase 9 블록 2의
 * 것을 그대로 쓴다(결재선 미리보기 포함). 공지 띠는 HOME에서 이리로 옮겼다(원문).
 */
type Tab = 'tasks' | 'requests' | 'team' | 'inbox' | 'bundle'

const STATUS_KO: Record<string, string> = { Open: '진행 중', Approved: '승인', Rejected: '반려', Modified: '수정요청', Delegated: '위임' }

function requestState(d: Decision, lang: Lang, role: Role | null): string {
  if (d.lead_status === 'pending') return tr(lang, '팀장 대기', 'Waiting for lead')
  if (d.status === 'Open' && d.chairman_required) return tr(lang, `${boss(role)} 결재 대기`, `Waiting for ${bossEn(role)}`)
  if (d.status === 'Approved' && d.decided_by_kind === 'rule') return tr(lang, '기록 완료', 'Recorded')
  return STATUS_KO[d.status] ?? d.status
}

export default async function MePage({ searchParams }: PageProps<'/me'>) {
  await recordScreenRead({ path: '/me', kind: 'page' })
  const params = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const user = await currentUser()
  const lang: Lang = user?.language ?? 'ko'
  const me = user?.user_id ?? ''
  const isLead = user?.role === 'TeamLead'
  const raw = one(params.tab) as Tab
  const tab: Tab = (['tasks', 'requests', 'team', ...(isLead ? ['inbox', 'bundle'] : [])] as Tab[]).includes(raw) ? raw : 'tasks'
  const composing = tab === 'requests' && one(params.new) === '1'

  const repo = await getRepository()
  const [tasks, decisions, notices, templates, lead, businesses, documents] = await Promise.all([
    repo.listTasks(),
    repo.listDecisions(),
    repo.listNotices(me),
    composing ? repo.listApprovalTemplates() : Promise.resolve([]),
    composing ? repo.myApprovalLead() : Promise.resolve(null),
    repo.listBusinesses(),
    tab === 'team' ? repo.listDocuments().catch(() => []) : Promise.resolve([]),
  ])
  const today = kstToday()
  const myTasks = tasks.filter((t) => t.owner === me && t.status !== 'Done').sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9'))
  const myRequests = decisions.filter((d) => d.created_by === me && d.template_key).sort((a, b) => b.decision_id.localeCompare(a.decision_id))
  const inbox = decisions.filter((d) => d.lead_status === 'pending' && d.approval_line?.[0]?.user_id === me)
  const bundleable = decisions.filter(
    (d) => d.lead_status === 'approved' && d.approval_line?.[0]?.user_id === me && d.status === 'Open' && d.chairman_required && !d.bundle_id,
  )
  const due = new Date(`${today}T00:00:00Z`)
  due.setUTCDate(due.getUTCDate() + 7)

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'tasks', label: tr(lang, '내 업무', 'My tasks'), badge: myTasks.length },
    { key: 'requests', label: tr(lang, '내 요청', 'My requests') },
    { key: 'team', label: tr(lang, '팀', 'Team') },
    ...(isLead
      ? [
          { key: 'inbox' as Tab, label: tr(lang, '팀 요청함', 'Team inbox'), badge: inbox.length },
          { key: 'bundle' as Tab, label: tr(lang, `${boss(user?.role)} 기안`, `To ${bossEn(user?.role)}`) },
        ]
      : []),
  ]

  return (
    <div className="mx-auto max-w-[720px] px-4 py-4">
      <h1 className="text-t18 font-bold tracking-tight">{tr(lang, `${user?.name ?? ''}님의 홈`, `${user?.display_name_en ?? user?.name ?? ''}’s home`)}</h1>
      <NoticeStrip notices={notices} today={today} lang={lang} />
      <InstallHint lang={lang} />

      {/* 넓은 화면용 탭(폰은 아래 하단 탭이 같은 주소로 간다). 채팅은 /chat으로. */}
      <nav className="mt-3 flex gap-1 overflow-x-auto" aria-label={tr(lang, '직원 홈 탭', 'Home tabs')}>
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/me?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-t12h font-semibold ${tab === t.key ? 'bg-accent text-white' : 'border border-line bg-raised'}`}
          >
            {t.label}
            {t.badge ? <span className="ml-1 tnum">{t.badge}</span> : null}
          </Link>
        ))}
        <Link href="/chat" className="shrink-0 rounded-lg border border-line bg-raised px-3 py-1.5 text-t12h font-semibold">
          {tr(lang, '채팅', 'Chat')}
        </Link>
      </nav>

      <section className="glass mt-3 rounded-glass p-3">
        {tab === 'tasks' ? (
          myTasks.length === 0 ? (
            <p className="py-6 text-center text-t12h text-ink-muted">{tr(lang, '맡은 열린 업무가 없습니다.', 'No open tasks.')}</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {myTasks.map((t) => (
                <li key={t.task_id}>
                  <Link href={`/tasks/${t.task_id}`} className="flex items-baseline gap-2 py-2.5 text-t13">
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className={`shrink-0 text-t11 tnum ${t.deadline && t.deadline < today ? 'font-semibold text-critical' : 'text-ink-muted'}`}>
                      {TASK_STATUS_LABEL_KO[t.status]}
                      {t.deadline ? ` · ${t.deadline.slice(5)}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === 'requests' ? (
          composing ? (
            <ApprovalForm
              templates={templates}
              lead={lead}
              businesses={businesses.filter((b) => b.visible).map((b) => ({ id: b.business_id, name: b.name }))}
              defaultDeadline={due.toISOString().slice(0, 10)}
              lang={lang}
              viewerRole={user?.role ?? null}
              afterSubmit="/me?tab=requests"
            />
          ) : (
            <>
              <Link href="/me?tab=requests&new=1" className="mb-2 block rounded-lg bg-accent px-3 py-3 text-center text-t14 font-semibold text-white">
                + {tr(lang, '요청 올리기', 'New request')}
              </Link>
              {myRequests.length === 0 ? (
                <p className="py-4 text-center text-t12h text-ink-muted">{tr(lang, '올린 요청이 없습니다.', 'No requests yet.')}</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {myRequests.map((d) => (
                    <li key={d.decision_id}>
                      <Link href={`/approvals?id=${d.decision_id}`} className="flex items-baseline gap-2 py-2.5 text-t13">
                        <span className="min-w-0 flex-1 truncate">{d.title}</span>
                        <span className="shrink-0 text-t11 font-semibold text-ink-dim">{requestState(d, lang, user?.role ?? null)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        ) : null}

        {tab === 'team' ? (
          <div className="space-y-3">
            <Link href="/chat" className="block rounded-lg border border-line bg-raised px-3 py-2 text-t12h font-semibold">
              💬 {tr(lang, '팀 채팅방으로', 'Open team chat')}
            </Link>
            <div>
              <p className="mb-1 text-t11 font-semibold text-ink-muted">{tr(lang, '팀 문서', 'Team documents')}</p>
              {documents.length === 0 ? (
                <p className="text-t12 text-ink-muted">{tr(lang, '볼 수 있는 문서가 없습니다.', 'No documents.')}</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {documents.slice(0, 15).map((d) => (
                    <li key={d.document_id}>
                      <Link href={`/documents/${encodeURIComponent(d.document_id)}`} className="block truncate py-2 text-t12h">
                        {d.title}
                        {d.version > 1 ? <span className="ml-1 text-t10h text-ink-muted">v{d.version}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'inbox' ? <TeamInbox pending={inbox} lang={lang} viewerRole={user?.role ?? null} /> : null}
        {tab === 'bundle' ? <BundleComposer candidates={bundleable} lang={lang} viewerRole={user?.role ?? null} /> : null}
      </section>
    </div>
  )
}
