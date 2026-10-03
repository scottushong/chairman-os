import { ApprovalForm } from '@/components/approvals/approval-form'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { boss } from '@/lib/boss'
import { kstToday } from '@/lib/chairman-project'
import { tr, type Lang } from '@/lib/i18n'
import { getRepository } from '@/lib/repository'

/**
 * `/approvals/new` — 양식으로 결재 올리기 (Phase 9 블록 2).
 *
 * 양식 다섯(0038 approval_templates)과 이 사람의 결재선 첫 칸(my_approval_lead)을 서버에서 읽어
 * 내린다. 올릴 수 있는 회사는 이 사람에게 보이는 회사다 — 모듈 권한(can_module)은 DB가 본다.
 */
export default async function NewApprovalPage() {
  await recordScreenRead({ path: '/approvals/new', kind: 'page' })

  const user = await currentUser()
  const lang: Lang = user?.language ?? 'ko'
  const repo = await getRepository()
  const [templates, lead, businesses] = await Promise.all([
    repo.listApprovalTemplates(),
    repo.myApprovalLead(),
    repo.listBusinesses(),
  ])
  const due = new Date(`${kstToday()}T00:00:00Z`)
  due.setUTCDate(due.getUTCDate() + 7)

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-5 lg:px-6">
      <PageHeader
        icon="stamp"
        title={tr(lang, '결재 올리기', 'New approval')}
        code="Phase 9 · Block 2"
        description={tr(
          lang,
          `양식을 고르고 항목을 채우면, 올리기 전에 결재선(팀장 → 규칙 판정 → ${boss(user?.role)})을 먼저 보여 드립니다.`,
          'Pick a template, fill it in, and see the approval line before you submit.',
        )}
      />
      <ApprovalForm
        templates={templates}
        lead={lead}
        businesses={businesses.filter((b) => b.visible).map((b) => ({ id: b.business_id, name: b.name }))}
        defaultDeadline={due.toISOString().slice(0, 10)}
        lang={lang}
        viewerRole={user?.role ?? null}
      />
    </div>
  )
}
