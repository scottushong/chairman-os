import { AttachmentsSection } from '@/components/attachments/attachments-section'
import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { canConfirmIntake, sameFileNotice } from '@/lib/intake/rules'
import { getRepository } from '@/lib/repository'

import { IntakePanel } from './intake-panel'

/**
 * 회사 화면의 «자료 받는 입구»(설계서 A2 · F9 — 지금의 «첨부» 칸 자리). 서버 쪽은 읽기만 한다 — 보이는 입구 줄 · 이름표 ·
 * 같은 파일 알림(0058 intake_same_file). 권한은 다시 판정하지 않는다(0058 RLS가 안 보이는 줄을 주지 않는다).
 *
 * 0058 전에 회사에 붙여 둔 첨부(entity businesses)는 «이전 첨부»로 아래에 그대로 둔다 — 지우지도 숨기지도 않는다. 새 파일은 입구로.
 */
export async function IntakeSection({ businessId }: { businessId: string }) {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  if (!user) return null
  // 기능 스위치 «자료 받는 입구»(0073, 기본 대표만) — 범위 밖이면 0058 전과 같은 «첨부» 칸.
  if (!(await featureOn(user, 'intake', businessId))) return <AttachmentsSection entityTable="businesses" entityId={businessId} />
  const [items, people, me, legacy] = await Promise.all([
    repo.listIntakeItems(businessId).catch((e) => {
      console.error('[intake] 목록을 못 읽었다', e)
      return []
    }),
    repo.listUserAccounts().catch(() => []),
    repo.getMyProfile().catch(() => null),
    repo.listAttachments('businesses', businessId).catch(() => []),
  ])
  const names = Object.fromEntries(people.map((p) => [p.user_id, p.display_name]))
  names[user.user_id] = user.name

  // 같은 파일 알림 — 아직 어디에도 넣지 않은 줄만(넣은 줄에는 할 일이 없다). 한 화면 20줄까지.
  const notices: Record<string, string> = {}
  await Promise.all(
    items
      .filter((i) => i.file_sha256 && i.status !== 'loaded')
      .slice(0, 20)
      .map(async (i) => {
        const n = sameFileNotice(await repo.intakeSameFile(i.item_id).catch(() => []))
        if (n) notices[i.item_id] = n
      }),
  )

  return (
    <>
      <IntakePanel
        businessId={businessId}
        items={items}
        mode={repo.mode}
        viewer={{ user_id: user.user_id, role: user.role, maxClass: me?.max_security_class ?? 'Normal' }}
        canConfirm={canConfirmIntake(user, businessId)}
        names={names}
        notices={notices}
      />
      {legacy.length ? <AttachmentsSection entityTable="businesses" entityId={businessId} legacy /> : null}
    </>
  )
}
