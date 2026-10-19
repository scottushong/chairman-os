import Link from 'next/link'
import { redirect } from 'next/navigation'

import { C } from '@/components/e-approval/parts'
import { EaPersonal } from '@/components/e-approval/ea-settings'
import { eaStore } from '@/lib/approvals/store'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'

/** 0087 전자결재 개인 설정 — 자주 쓰는 결재선 · 대결자 · 알림. 판정은 DB(ea_my_settings · ea_proxy_save …). */
export const dynamic = 'force-dynamic'

export default async function EApprovalSettingsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const store = await eaStore()
  const [settings, people, forms] = await Promise.all([store.mySettings().catch(() => null), store.people().catch(() => []), store.forms().catch(() => [])])
  return (
    <div className={`${C.bg} min-h-full pb-20 lg:pb-6`}>
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 py-5 sm:px-6">
        <Link href="/e-approval" className="text-[13px] text-[#2f5bd3]">
          ← 전자결재
        </Link>
        <h1 className="text-[22px] font-bold text-[#1f2329]">전자결재 개인 설정</h1>
        {settings ? <EaPersonal settings={settings} people={people} forms={forms.filter((f) => f.active)} today={kstToday()} /> : <div className={`${C.card} px-4 py-6 text-[14px] text-[#6b7280]`}>설정을 불러오지 못했습니다.</div>}
      </div>
    </div>
  )
}
