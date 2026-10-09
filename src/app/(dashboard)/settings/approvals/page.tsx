import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { ApprovalTemplatesEditor } from '@/components/settings/approval-templates-editor'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { boss } from '@/lib/boss'
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
  const b = boss(user.role)

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 lg:px-6">
      <PageHeader
        icon="stamp"
        title="결재 양식 · 규칙"
        code="0038"
        description={`양식마다 항목과 ${b}까지 올라가는 기준을 정합니다. 결재선은 조직도의 상사 사슬입니다(0059).`}
      />
      {/* 0059 결재선 규칙 — «기록 완료» 자동 종결은 없어졌다. 회장 전용 화면이라 호칭은 boss(role) 그대로. */}
      <ul className="mt-3 space-y-1 rounded-xl border border-line-soft bg-raised px-3 py-2.5 text-t12h text-ink-dim">
        <li>
          <b className="text-ink">기준 미만</b> → 직속 상사 승인으로 종결
        </li>
        <li>
          <b className="text-ink">기준 이상</b> → 상사 결재(조직도 순서대로) → {b} 최종 승인
        </li>
        <li>
          <b className="text-ink">계약 · 채용</b> → 금액 무관 상사 → {b}
        </li>
        <li className="text-ink-muted">상사가 {b}인 직원은 소액도 {b}이 승인합니다(승인함에서 한 번에 승인).</li>
      </ul>
      <div className="mt-4">
        <ApprovalTemplatesEditor templates={templates} />
      </div>
    </div>
  )
}
