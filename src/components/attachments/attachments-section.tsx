import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import type { AttachmentEntity } from '@/types'

import { AttachmentsPanel, type AttachmentsPanelProps } from './attachments-panel'

/**
 * «첨부» 칸의 서버 쪽 — 읽기만 한다. 보이는 첨부 · 이름표 · (회장에게만) Vault 지정자와 고를 사람.
 * 권한은 다시 판정하지 않는다 — 0045가 안 보이는 첨부를 아예 주지 않는다.
 */
export async function AttachmentsSection({
  entityTable,
  entityId,
  fill,
  compact,
  locked,
  deleteLocked,
}: {
  entityTable: AttachmentEntity
  entityId: string
  fill?: AttachmentsPanelProps['fill']
  compact?: boolean
  locked?: string
  deleteLocked?: boolean
}) {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  if (!user) return null
  const isChairman = user.role === 'Chairman'
  const [attachments, people, me] = await Promise.all([
    repo.listAttachments(entityTable, entityId),
    // 이름표는 조직도가 보이는 범위(0026)만큼. 못 읽으면 «올린 사람»으로 떨어진다.
    repo.listUserAccounts().catch(() => []),
    // 첨부 등급 기본값 = 본인 보안등급 이하에서 가장 높은 것. 못 읽으면 «일반»으로(가장 덜 막히는 쪽).
    repo.getMyProfile().catch(() => null),
  ])
  const names = Object.fromEntries(people.map((p) => [p.user_id, p.display_name]))
  names[user.user_id] = user.name

  const vaultViewers = isChairman
    ? Object.fromEntries(
        await Promise.all(
          attachments
            .filter((a) => a.security_class === 'Vault')
            .map(async (a) => [a.attachment_id, await repo.listAttachmentViewers(a.attachment_id)] as const),
        ),
      )
    : undefined

  return (
    <AttachmentsPanel
      entityTable={entityTable}
      entityId={entityId}
      attachments={attachments}
      mode={repo.mode}
      viewer={{ user_id: user.user_id, role: user.role, maxClass: me?.max_security_class ?? 'Normal' }}
      names={names}
      vaultViewers={vaultViewers}
      people={isChairman ? people.filter((p) => !p.revoked_at && p.user_id !== user.user_id).map((p) => ({ user_id: p.user_id, display_name: p.display_name })) : undefined}
      fill={fill}
      compact={compact}
      locked={locked}
      deleteLocked={deleteLocked}
    />
  )
}
