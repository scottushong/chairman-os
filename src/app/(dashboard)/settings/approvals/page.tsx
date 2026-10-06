import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { ApprovalTemplatesEditor } from '@/components/settings/approval-templates-editor'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * `/settings/approvals` — 결재 양식 · 대표 규칙 (2026-10-06 첫 직원 피드백).
 *
 * 금액 기준은 원래부터 DB 표(0038 approval_templates)의 값이었다 — 코드에 박힌 값이 아니다. 고칠 화면만 없었다.
 * 회장 전용이다(0038 approval_templates_write). 직원에게는 화면도 링크도 없다 — 직원 화면 용어 원칙(CLAUDE.md).
 */
export default async function ApprovalSettingsPage() {
  const user = await currentUser()
  if (user?.role !== 'Chairman') redirect('/me')
  await recordScreenRead({ path: '/settings/approvals', kind: 'page' })
  const templates = await (await getRepository()).listApprovalTemplates()

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 lg:px-6">
      <PageHeader
        icon="stamp"
        title="결재 양식 · 규칙"
        code="0038"
        description="양식마다 항목과 회장까지 올라가는 기준을 정합니다. 기준 미만은 팀장 결재로 끝나고, 팀장 · 직속 상위가 없으면 «기록 완료»로 바로 저장됩니다."
      />
      <div className="mt-4">
        <ApprovalTemplatesEditor templates={templates} />
      </div>
    </div>
  )
}
