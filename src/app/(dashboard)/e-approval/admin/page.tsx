import Link from 'next/link'
import { redirect } from 'next/navigation'

import { C } from '@/components/e-approval/parts'
import { EaAdmin } from '@/components/e-approval/ea-settings'
import { eaStore } from '@/lib/approvals/store'
import { currentUser } from '@/lib/auth/session'

/**
 * 0087 전자결재 관리 — 양식 관리 · 결재선 · 전결 규칙(대표만 · DB ea_form_save · ea_line_rule_save가 다시 막는다).
 * 관리자라고 문서를 다 보는 화면이 아니다(지시문 8번) — 여기에는 문서 목록이 없다.
 */
export const dynamic = 'force-dynamic'

export default async function EApprovalAdminPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (user.role !== 'Chairman') redirect('/e-approval')
  const store = await eaStore()
  const [forms, rules] = await Promise.all([store.forms().catch(() => []), store.rules().catch(() => [])])
  return (
    <div className={`${C.bg} min-h-full pb-20 lg:pb-6`}>
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 py-5 sm:px-6">
        <Link href="/e-approval" className="text-[13px] text-[#2f5bd3]">
          ← 전자결재
        </Link>
        <h1 className="text-[22px] font-bold text-[#1f2329]">전자결재 관리</h1>
        <EaAdmin forms={forms} rules={rules} />
      </div>
    </div>
  )
}
