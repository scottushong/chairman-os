import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { ApproveInvitation } from '@/components/settings/approve-invitation'
import { InviteUser } from '@/components/settings/invite-user'
import { OrgChart } from '@/components/settings/org-chart'
import { RevokeButton } from '@/components/settings/revoke-button'
import { Icon } from '@/components/ui/icon'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { formatDateTime } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import { getRepository } from '@/lib/repository'
import {
  ROLE_LABEL_KO,
  SECURITY_CLASS_LABEL_KO,
  type Business,
  type UserInvitation,
} from '@/types'

/**
 * CH-049 RBAC + Phase 6-1 블록 B — 사용자 · 권한 · 조직도.
 *
 * 0004_bootstrap_chairman은 첫 사람 한 명을 SQL Editor에서 심는 파일이고, 그 머리에
 * "두 번째 사람부터는 회장이 앱에서 초대한다"고 적혀 있다. 이 화면이 그 약속의 이행이고,
 * Phase 6-1부터는 '누가 누구 밑인가'를 그리는 자리이기도 하다.
 *
 * **이 화면은 회장 전용이 아니다.** 0026이 초대를 위임하고 사람 목록을 subtree로 자른 뒤로,
 * 팀장도 자기 아래를 보고 자기 아래로 사람을 부른다. 그래서 canManageUsers()로 404를
 * 내던 문을 열었다 — 대신 **보이는 것과 눌리는 것을 DB가 정한다**:
 *   · 사람 목록은 0026이 subtree로 자른다(위·옆은 존재도 보이지 않는다).
 *   · 역할·팀·상사 변경과 팀 편집 버튼은 회장에게만 그린다(0002/0025가 판정한다).
 *   · 초대는 0026의 위임 정책이 판정한다(자기 subtree · 자기 등급 이하 · 자기 회사).
 * 로그인하지 않은 사람에게만 404다 — 그 경우는 볼 것이 아무것도 없다.
 *
 * 세 목록이 따로 있는 이유
 *   조직도   지금 시스템을 쓰는 사람들이 어디에 매달려 있는가.
 *   초대     아직 계정이 없는 사람에게 준 약속. 계정이 생기면 무엇을 줄 것인가.
 *   입퇴사   최근 30일에 누가 들어오고 나갔는가(KST 기준).
 */
export default async function UsersPage(props: PageProps<'/settings/users'>) {
  const params = await props.searchParams
  const user = await currentUser()
  if (!user) notFound()

  const repo = await getRepository()
  const [accounts, invitations, businesses, teams] = await Promise.all([
    repo.listUserAccounts(),
    repo.listUserInvitations(),
    repo.listBusinesses(),
    repo.listTeams(),
  ])

  const isChairman = user.role === 'Chairman'
  const viewerAccount = accounts.find((a) => a.user_id === user.user_id) ?? null

  const pending = invitations.filter((i) => !i.accepted_at && !i.revoked_at)
  const settled = invitations.filter((i) => i.accepted_at || i.revoked_at)

  // 30일 입퇴사 이력 — '오늘'은 언제나 KST다(0025 3절의 계산과 같은 기준).
  const today = kstToday()
  const from = kstToday(new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000))
  const movements = [
    ...accounts
      .filter((a) => a.joined_on && a.joined_on >= from && a.joined_on <= today)
      .map((a) => ({ person: a, kind: 'in' as const, on: a.joined_on! })),
    ...accounts
      .filter((a) => a.left_on && a.left_on >= from && a.left_on <= today)
      .map((a) => ({ person: a, kind: 'out' as const, on: a.left_on! })),
  ].sort((x, y) => y.on.localeCompare(x.on))

  const nameOf = (userId: string | null) =>
    userId ? (accounts.find((a) => a.user_id === userId)?.display_name ?? null) : null

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="users"
        title="사용자 · 권한 · 조직도"
        code="CH-049"
        description="회사 > 팀 > 사람. 보이는 범위는 자기 아래까지입니다 — 위와 옆은 존재도 보이지 않습니다."
      >
        <Link
          href="/"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          대시보드로
        </Link>
      </PageHeader>

      <div className="mt-4">
        <InviteUser
          businesses={businesses}
          teams={teams}
          people={accounts}
          viewer={user}
          viewerAccount={viewerAccount}
          initiallyOpen={params.invite === '1'}
        />
      </div>

      <div className="mt-3.5">
        {accounts.length === 0 ? (
          <p className="rounded-xl border border-line-soft bg-panel px-3.5 py-8 text-center text-[12px] text-ink-muted">
            보이는 사람이 없습니다. 조직도는 자기 아래(직속·그 아래)만 보여 줍니다 — 아직 아무도
            이 아래에 없다는 뜻입니다.
          </p>
        ) : (
          <OrgChart people={accounts} teams={teams} businesses={businesses} viewer={user} />
        )}
      </div>

      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="mail" className="size-4 text-ink-dim" />
          대기 중인 초대
          <span className="text-[11px] font-normal text-ink-muted tnum">{pending.length}건</span>
        </h2>
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
          계정이 아직 없는 사람들입니다. Supabase Dashboard에서 이 주소로 계정이 만들어지는 순간
          아래 권한이 자동으로 붙습니다(0011 on_auth_user_created). 회장 결재가 붙은 초대는
          승인 전에는 계정이 생겨도 권한이 붙지 않습니다(0026).
        </p>

        {pending.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-ink-muted">대기 중인 초대가 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {pending.map((i) => (
              <InvitationRow
                key={i.invitation_id}
                invitation={i}
                businesses={businesses}
                inviterName={nameOf(i.invited_by)}
                bossName={nameOf(i.reports_to)}
                canManage={isChairman}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="clock" className="size-4 text-ink-dim" />
          최근 30일 입·퇴사
          <span className="text-[11px] font-normal text-ink-muted tnum">{movements.length}건</span>
        </h2>
        <p className="mt-1 text-[10.5px] text-ink-muted">
          {from} ~ {today} (KST). 입사일·퇴사일이 비어 있는 사람은 여기 오지 않습니다.
        </p>
        {movements.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-ink-muted">
            최근 30일에 들어오거나 나간 사람이 없습니다.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {movements.map((m) => (
              <li
                key={`${m.kind}-${m.person.user_id}`}
                className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    m.kind === 'in' ? 'bg-ok/15 text-ok' : 'bg-critical/15 text-critical'
                  }`}
                >
                  {m.kind === 'in' ? '입사' : '퇴사'}
                </span>
                <span className="text-[12.5px] font-semibold">{m.person.display_name}</span>
                <span className="text-[11px] text-ink-dim">{ROLE_LABEL_KO[m.person.role]}</span>
                <span className="ml-auto text-[11px] text-ink-muted tnum">{m.on}</span>
              </li>
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
              <InvitationRow
                key={i.invitation_id}
                invitation={i}
                businesses={businesses}
                inviterName={nameOf(i.invited_by)}
                bossName={nameOf(i.reports_to)}
                canManage={isChairman}
              />
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

function InvitationRow({
  invitation,
  businesses,
  inviterName,
  bossName,
  canManage,
}: {
  invitation: UserInvitation
  businesses: Business[]
  /** 누가 불렀는가. 이름을 못 찾으면 null이다 — uuid를 대신 쓰지 않는다. */
  inviterName: string | null
  bossName: string | null
  /** 재발송·취소·승인은 아직 회장만 된다(0026이 update/delete 정책을 넓히지 않았다). */
  canManage: boolean
}) {
  const groupScope = invitation.role === 'Chairman' || invitation.role === 'GroupCFO'
  const settled = Boolean(invitation.accepted_at || invitation.revoked_at)
  const waiting = invitation.chairman_approval_required && !invitation.chairman_approved_at

  return (
    <li className={`rounded-lg px-2 py-2 transition-colors hover:bg-raised/60 ${settled ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] font-semibold">{invitation.display_name}</span>
        {invitation.display_name_en ? (
          <span className="text-[11px] text-ink-muted">{invitation.display_name_en}</span>
        ) : null}
        <span className="text-[11px] text-ink-dim">{invitation.email}</span>
        <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">
          {ROLE_LABEL_KO[invitation.role]}
        </span>
        <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-muted">
          {SECURITY_CLASS_LABEL_KO[invitation.max_security_class]}
        </span>
        {waiting ? (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
            회장 결재 대기
          </span>
        ) : null}
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

        <span className="ml-auto flex items-center gap-1.5">
          {settled ? (
            <span className="text-[10.5px] text-ink-muted tnum">
              {formatDateTime(invitation.invited_at)} 초대
            </span>
          ) : canManage ? (
            <>
              {waiting ? (
                <ApproveInvitation invitationId={invitation.invitation_id} label={invitation.email} />
              ) : null}
              <RevokeButton
                kind="invitation"
                id={invitation.invitation_id}
                label={invitation.email}
              />
            </>
          ) : (
            <span className="text-[10.5px] text-ink-muted">
              취소·승인은 회장만 할 수 있습니다
            </span>
          )}
        </span>
      </div>
      <p className="mt-0.5 text-[10.5px] text-ink-muted">
        {scopeText(invitation.business_ids, businesses, groupScope)}
        {' · '}
        초대: {inviterName ?? '—'}
        {' · '}
        들어갈 자리: {bossName ?? '—'} 아래
        {/*
         * '재발송'은 만들 수 없는 칸이라 '—'다. 이 앱은 메일을 보내지 못한다 —
         * 계정 생성과 초대 메일은 service_role을 요구하고 이 프로젝트에는 없다(DEFERRED D-15).
         * 버튼을 그려 두고 아무 일도 안 일어나게 하는 것보다, 어디서 보내야 하는지를 적는다.
         */}
        {' · '}
        재발송 — Supabase Dashboard → Authentication에서 보냅니다
      </p>
    </li>
  )
}
