import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { InviteUser } from '@/components/settings/invite-user'
import { RevokeButton } from '@/components/settings/revoke-button'
import { Icon } from '@/components/ui/icon'
import { canManageUsers } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { formatDateTime } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import { getRepository } from '@/lib/repository'
import {
  ROLE_LABEL_KO,
  SECURITY_CLASS_LABEL_KO,
  type Business,
  type UserAccount,
  type UserInvitation,
} from '@/types'

/**
 * CH-049 RBAC — 사용자와 권한.
 *
 * 0004_bootstrap_chairman은 첫 사람 한 명을 SQL Editor에서 심는 파일이고, 그 머리에
 * "두 번째 사람부터는 회장이 앱에서 초대한다"고 적혀 있다. 이 화면이 그 약속의 이행이다.
 *
 * 두 목록이 따로 있는 이유
 *   사용자   이미 들어와 있는 사람. 지금 무엇을 볼 수 있는가.
 *   초대     아직 계정이 없는 사람에게 준 약속. 계정이 생기면 무엇을 줄 것인가.
 *   합치면 '이 사람은 지금 시스템을 쓰고 있나'가 흐려진다. 자를 때 채우는 칸도 서로 다르다.
 *
 * 404로 막는 것은 안내다. 실제 문은 0002의 user_profiles_admin_write와 0011의
 * user_invitations_admin이 지킨다 — Chairman이 아니면 이 화면을 열어도 목록이 비고
 * 어떤 버튼도 통하지 않는다. 403이 아니라 404인 이유는 회사 상세와 같다:
 * '있지만 권한이 없다'고 말해 주는 것 자체가 그 화면의 존재를 알려 주는 일이다.
 */
export default async function UsersPage() {
  const user = await currentUser()
  if (!canManageUsers(user)) notFound()

  const repo = await getRepository()
  const [accounts, invitations, businesses] = await Promise.all([
    repo.listUserAccounts(),
    repo.listUserInvitations(),
    repo.listBusinesses(),
  ])

  // 살아 있는 사람이 위, 회수된 사람이 아래. 회수된 사람을 숨기지 않는 이유는
  // '누가 잘렸는지'가 이 화면이 답해야 하는 질문의 절반이기 때문이다.
  const orderedAccounts = [...accounts].sort(
    (a, b) =>
      Number(Boolean(a.revoked_at)) - Number(Boolean(b.revoked_at)) ||
      a.created_at.localeCompare(b.created_at),
  )

  const pending = invitations.filter((i) => !i.accepted_at && !i.revoked_at)
  const settled = invitations.filter((i) => i.accepted_at || i.revoked_at)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="users"
        title="사용자 · 권한"
        code="CH-049"
        description="초대하면 역할·회사 범위·보안등급이 같이 정해집니다. 회수는 한 줄로 전 테이블을 동시에 닫습니다."
      >
        <Link
          href="/"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          대시보드로
        </Link>
      </PageHeader>

      <div className="mt-4">
        <InviteUser businesses={businesses} />
      </div>

      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="users" className="size-4 text-ink-dim" />
          사용자
          <span className="text-[11px] font-normal text-ink-muted tnum">
            {orderedAccounts.filter((a) => !a.revoked_at).length}명 활성 · 총{' '}
            {orderedAccounts.length}명
          </span>
        </h2>

        {orderedAccounts.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-ink-muted">
            아직 사용자가 없습니다. dummy 모드에서는 늘 비어 있습니다 — 사용자 표는 live에만
            있습니다.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {orderedAccounts.map((a) => (
              <AccountRow
                key={a.user_id}
                account={a}
                businesses={businesses}
                self={a.user_id === user?.user_id}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="mail" className="size-4 text-ink-dim" />
          대기 중인 초대
          <span className="text-[11px] font-normal text-ink-muted tnum">{pending.length}건</span>
        </h2>
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
          계정이 아직 없는 사람들입니다. Supabase Dashboard에서 이 주소로 계정이 만들어지는 순간
          아래 권한이 자동으로 붙습니다(0011 on_auth_user_created). 메일을 앱에서 직접 보내지
          못하는 이유는 DEFERRED D-15에 적어 두었습니다.
        </p>

        {pending.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-ink-muted">대기 중인 초대가 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {pending.map((i) => (
              <InvitationRow key={i.invitation_id} invitation={i} businesses={businesses} />
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 ? (
        <section className="mt-3.5 mb-6 rounded-xl border border-line-soft bg-panel p-3.5">
          <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
            <Icon name="clock" className="size-4 text-ink-dim" />
            지난 초대
            <span className="text-[11px] font-normal text-ink-muted tnum">{settled.length}건</span>
          </h2>
          <ul className="mt-2 space-y-1">
            {settled.map((i) => (
              <InvitationRow key={i.invitation_id} invitation={i} businesses={businesses} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/** 회사 범위 한 줄. 전사 역할은 빈 배열이지만 전부 본다 — 그 차이를 말로 적는다. */
function scopeText(businessIds: string[], businesses: Business[], groupScope: boolean): string {
  if (groupScope) return '전사 (모든 회사)'
  if (businessIds.length === 0) return '지정된 회사 없음 — 아무것도 보이지 않습니다'
  return businessIds.map((id) => businessName(businesses, id)).join(' · ')
}

function AccountRow({
  account,
  businesses,
  self,
}: {
  account: UserAccount
  businesses: Business[]
  /** 지금 이 화면을 보고 있는 본인인가. 자기 자신은 자를 수 없다. */
  self: boolean
}) {
  const revoked = Boolean(account.revoked_at)
  const groupScope = account.role === 'Chairman' || account.role === 'GroupCFO'

  return (
    <li
      className={`rounded-lg px-2 py-2 transition-colors hover:bg-raised/60 ${
        revoked ? 'opacity-50' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] font-semibold">{account.display_name}</span>
        {account.title_ko ? (
          <span className="text-[11px] text-ink-muted">{account.title_ko}</span>
        ) : null}
        <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">
          {ROLE_LABEL_KO[account.role]}
        </span>
        <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-muted">
          {SECURITY_CLASS_LABEL_KO[account.max_security_class]}
        </span>
        {revoked ? (
          <span className="rounded bg-critical/15 px-1.5 py-0.5 text-[10px] font-semibold text-critical">
            회수됨 {formatDateTime(account.revoked_at!)}
          </span>
        ) : null}

        <span className="ml-auto">
          {revoked ? null : self ? (
            // 마지막 Chairman이 스스로를 자르면 admin 정책을 통과할 사람이 남지 않는다.
            <span className="text-[10.5px] text-ink-muted">본인 계정</span>
          ) : (
            <RevokeButton kind="account" id={account.user_id} label={account.display_name} />
          )}
        </span>
      </div>
      <p className="mt-0.5 text-[10.5px] text-ink-muted">
        {scopeText(account.business_ids, businesses, groupScope)}
      </p>
    </li>
  )
}

function InvitationRow({
  invitation,
  businesses,
}: {
  invitation: UserInvitation
  businesses: Business[]
}) {
  const groupScope = invitation.role === 'Chairman' || invitation.role === 'GroupCFO'
  const settled = Boolean(invitation.accepted_at || invitation.revoked_at)

  return (
    <li className={`rounded-lg px-2 py-2 transition-colors hover:bg-raised/60 ${settled ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] font-semibold">{invitation.display_name}</span>
        <span className="text-[11px] text-ink-dim">{invitation.email}</span>
        <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">
          {ROLE_LABEL_KO[invitation.role]}
        </span>
        <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-muted">
          {SECURITY_CLASS_LABEL_KO[invitation.max_security_class]}
        </span>
        {invitation.accepted_at ? (
          <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold text-ok">
            수락됨 {formatDateTime(invitation.accepted_at)}
          </span>
        ) : null}
        {invitation.revoked_at ? (
          <span className="rounded bg-critical/15 px-1.5 py-0.5 text-[10px] font-semibold text-critical">
            취소됨 {formatDateTime(invitation.revoked_at)}
          </span>
        ) : null}

        <span className="ml-auto">
          {settled ? (
            <span className="text-[10.5px] text-ink-muted tnum">
              {formatDateTime(invitation.invited_at)} 초대
            </span>
          ) : (
            <RevokeButton
              kind="invitation"
              id={invitation.invitation_id}
              label={invitation.email}
            />
          )}
        </span>
      </div>
      <p className="mt-0.5 text-[10.5px] text-ink-muted">
        {scopeText(invitation.business_ids, businesses, groupScope)}
      </p>
    </li>
  )
}
