import Link from 'next/link'

import { NoticeComposer } from '@/components/groupware/notice-composer'
import { NoticeList } from '@/components/groupware/notice-list'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { canWriteGroupNotice, canWriteNotice } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { tr, type Lang } from '@/lib/i18n'
import { getRepository } from '@/lib/repository'
import { SECURITY_CLASS_LABEL_KO, TASK_STATUS_LABEL_KO, type NoticeRead } from '@/types'

/**
 * `/groupware` — 그룹웨어 허브 (Phase 9 블록 1).
 *
 * 한 화면에 네 칸: 내 업무 / 결재 대기 / 최근 문서 / 공지. 앞의 셋은 **이미 있는 화면의 요약**이고
 * 각 칸의 «전체 보기»가 그 화면(/tasks · /approvals · /documents)으로 간다. 새 목록을 만들지 않는다
 * — 같은 업무가 두 화면에서 다른 모양으로 살면 한쪽만 고쳐지는 날이 온다.
 *
 * 무엇이 보이는지는 전부 RLS가 정한다(subtree · 회사 · 등급). 이 화면이 다시 거르는 것은
 * «내 것»(업무 담당자)과 «열린 것»(결재 Open)뿐이다.
 */
export default async function GroupwarePage() {
  await recordScreenRead({ path: '/groupware', kind: 'page' })

  const user = await currentUser()
  const lang: Lang = user?.language ?? 'ko'
  const repo = await getRepository()
  const [tasks, decisions, documents, notices, businesses] = await Promise.all([
    repo.listTasks(),
    repo.listDecisions(),
    repo.listDocuments(),
    repo.listNotices(user?.user_id ?? ''),
    repo.listBusinesses(),
  ])

  const today = kstToday()
  const myTasks = tasks
    .filter((t) => t.owner === user?.user_id && t.status !== 'Done')
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
  const openDecisions = decisions
    .filter((d) => d.status === 'Open')
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
  const recentDocs = [...documents].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const liveNotices = notices.filter((n) => !n.expires_on || n.expires_on >= today)

  // 읽음 확인은 작성자 · 회장만 받는다(0038). 그 공지만 묻는다 — 남의 공지에 물어도 자기 줄만 온다.
  const isChairman = user?.role === 'Chairman'
  const mine = liveNotices.filter((n) => isChairman || n.created_by === user?.user_id)
  const readLists = await Promise.all(mine.map((n) => repo.listNoticeReads(n.notice_id)))
  const reads: Record<number, NoticeRead[]> = Object.fromEntries(mine.map((n, i) => [n.notice_id, readLists[i]]))

  const businessNames = Object.fromEntries(businesses.map((b) => [b.business_id, b.name]))
  const writable = businesses.filter((b) => b.visible).map((b) => ({ id: b.business_id, name: b.name }))

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-5">
      <PageHeader
        icon="layers"
        title={tr(lang, '그룹웨어', 'Groupware')}
        code="Phase 9 · Block 1"
        description={tr(
          lang,
          '내 업무 · 결재 대기 · 최근 문서 · 공지를 한 화면에서. 각 칸의 «전체 보기»는 원래 화면으로 갑니다.',
          'My tasks, pending approvals, recent documents and notices in one place.',
        )}
      />

      <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Panel title={tr(lang, '내 업무', 'My tasks')} count={myTasks.length} href="/tasks" lang={lang}>
          {myTasks.length === 0 ? (
            <Empty>{tr(lang, '맡은 열린 업무가 없습니다.', 'No open tasks assigned to you.')}</Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {myTasks.slice(0, 6).map((t) => (
                <li key={t.task_id}>
                  <Link href={`/tasks/${t.task_id}`} className="flex items-baseline gap-2 py-1.5 text-[12.5px] hover:text-accent">
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="shrink-0 text-[10.5px] text-ink-muted">
                      {TASK_STATUS_LABEL_KO[t.status]}
                      {t.deadline ? ` · ${t.deadline.slice(5)}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={tr(lang, '결재 대기', 'Pending approvals')} count={openDecisions.length} href="/approvals" lang={lang}>
          {openDecisions.length === 0 ? (
            <Empty>{tr(lang, '열린 결재가 없습니다.', 'Nothing awaiting approval.')}</Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {openDecisions.slice(0, 6).map((d) => (
                <li key={d.decision_id}>
                  <Link href={`/approvals?id=${d.decision_id}`} className="flex items-baseline gap-2 py-1.5 text-[12.5px] hover:text-accent">
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    <span className="shrink-0 text-[10.5px] text-ink-muted">
                      {businessNames[d.business_id] ?? d.business_id}
                      {d.deadline ? ` · ${d.deadline.slice(5)}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={tr(lang, '최근 문서', 'Recent documents')} count={documents.length} href="/documents" lang={lang}>
          {recentDocs.length === 0 ? (
            <Empty>{tr(lang, '볼 수 있는 문서가 없습니다.', 'No documents you can see.')}</Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {recentDocs.slice(0, 6).map((d) => (
                <li key={d.document_id}>
                  <Link href={`/documents/${d.document_id}`} className="flex items-baseline gap-2 py-1.5 text-[12.5px] hover:text-accent">
                    <span className="min-w-0 flex-1 truncate">
                      {d.title}
                      {d.version > 1 ? <span className="ml-1 text-[10.5px] text-ink-muted">v{d.version}</span> : null}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-ink-muted">
                      {SECURITY_CLASS_LABEL_KO[d.security_class]} · {d.created_at.slice(5, 10)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={tr(lang, '공지', 'Notices')}
          count={liveNotices.length}
          lang={lang}
          action={
            canWriteNotice(user) ? (
              <NoticeComposer businesses={writable} canGroup={canWriteGroupNotice(user)} lang={lang} />
            ) : null
          }
        >
          <NoticeList
            notices={liveNotices}
            businessNames={businessNames}
            reads={reads}
            canDelete={liveNotices
              .filter((n) => isChairman || n.created_by === user?.user_id)
              .map((n) => n.notice_id)}
            lang={lang}
          />
        </Panel>
      </div>
    </div>
  )
}

function Panel({
  title,
  count,
  href,
  action,
  lang,
  children,
}: {
  title: string
  count: number
  href?: string
  action?: React.ReactNode
  lang: Lang
  children: React.ReactNode
}) {
  return (
    <section className="glass rounded-glass p-4" aria-label={title}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        <span className="text-[11px] text-ink-muted tnum">{count}</span>
        <div className="ml-auto flex items-center gap-2">
          {action}
          {href ? (
            <Link href={href} className="text-[11.5px] text-ink-dim underline-offset-2 hover:text-ink hover:underline">
              {tr(lang, '전체 보기 →', 'View all →')}
            </Link>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[12px] text-ink-muted">{children}</p>
}
