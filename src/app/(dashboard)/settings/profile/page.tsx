import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { ProfileForm } from '@/components/settings/profile-form'
import { Icon } from '@/components/ui/icon'
import { decideChairmanTimezone } from '@/lib/chairman-timezone'
import { formatDateTime } from '@/lib/format'
import { getRepository } from '@/lib/repository'
import { ROLE_LABEL_KO, SECURITY_CLASS_LABEL_KO } from '@/types'

/**
 * /settings/profile — 내 프로필 (Phase 5-E 2절).
 *
 * 헤더 오른쪽의 이름을 누르면 여기로 온다. 전 사용자 공통 화면이다 —
 * 역할이 무엇이든 자기 이름은 자기가 고친다(0030 update_own_profile이 그 문이다).
 *
 * **프로필 사진(Storage)은 아직 없다.** 원문 4절이 요구한 항목이지만 아바타 버킷과
 * 그 정책이 서지 않았다 — 0018이 initiative-logos에 한 것과 같은 한 벌이 필요하고,
 * 그것은 이번 범위 밖이다. 자리를 만들어 두고 '준비 중'이라고 말한다.
 * 회색으로 비활성만 해 둔 버튼을 놓지 않는다(DEFERRED.md Phase 5-E).
 */
export default async function ProfileSettingsPage() {
  const repo = await getRepository()
  const [profile, briefTz, events] = await Promise.all([
    repo.getMyProfile(),
    repo.getBriefTimezone(),
    repo.listEvents(),
  ])

  // 세션이 없으면 프로필도 없다. 로그인 단계에서 걸러야 할 상태라 여기서는 404다
  // (/settings/users·/settings/chairman과 같은 방식 — 403이 아닌 이유도 같다).
  if (!profile) notFound()

  /**
   * 시간대는 여기서 **고치지 않는다.** 아침 알림의 시간대(③ 수동값)는 Phase 3-C가
   * /settings/chairman에 세운 화면이 주인이고, 같은 값을 두 화면에서 고칠 수 있게 만들면
   * 둘 중 하나는 언젠가 낡은 값을 보여 준다. 여기서는 '지금 어디로 판정되나'만 읽고 링크한다.
   */
  const tz = decideChairmanTimezone({
    manualTz: briefTz.brief_tz,
    trips: events.filter((e) => e.kind === 'Trip'),
    deviceTz: briefTz.current_tz,
    now: new Date(),
  })
  const chairman = profile.role === 'Chairman'

  return (
    <div className="mx-auto max-w-[900px] px-6 py-5">
      <PageHeader
        icon="users"
        title="내 프로필"
        code="Phase 5-E"
        description="이름·직함·생년월일은 본인이 고칩니다. 역할과 보안등급은 회장님만 바꿀 수 있습니다."
      >
        <Link
          href="/settings"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          설정으로
        </Link>
      </PageHeader>

      <section className="mt-4 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="pencil" className="size-4 text-ink-dim" />
          기본 정보
        </h2>
        <ProfileForm profile={profile} />
      </section>

      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="shield" className="size-4 text-ink-dim" />
          바꿀 수 없는 것
        </h2>
        <p className="mt-1 mb-2 text-[10.5px] text-ink-muted">
          역할과 보안등급은 권한 그 자체입니다. 본인이 올릴 수 있으면 권한 체계가 아니게
          되므로, 이 두 칸은 회장님의 사용자·권한 화면에서만 바뀝니다.
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-4">
          <Readonly label="역할" value={ROLE_LABEL_KO[profile.role]} />
          <Readonly label="보안등급" value={SECURITY_CLASS_LABEL_KO[profile.max_security_class]} />
          <Readonly label="계정 생성" value={formatDateTime(profile.created_at)} />
          <Readonly label="사용자 ID" value={profile.user_id.slice(0, 8)} />
        </dl>
      </section>

      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="clock" className="size-4 text-ink-dim" />
          시간대
          <span className="text-[11px] font-normal text-ink-muted">{tz.timezone}</span>
        </h2>
        <p className="mt-1 text-[10.5px] text-ink-muted">
          {chairman
            ? '아침 브리핑이 갈 시간대입니다. 수동으로 지정하거나 자동(출장 → 마지막 접속 기기)으로 둘 수 있고, 그 설정은 회장 루틴 화면에 있습니다 — 같은 값을 두 화면에서 고칠 수 있게 하면 한쪽이 낡습니다.'
            : '지금 이 기기가 보낸 시간대입니다. 아침 브리핑의 시각 판정은 회장님 설정만 씁니다.'}
        </p>
        {chairman ? (
          <Link
            href="/settings/chairman"
            className="mt-2 inline-block rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            회장 루틴에서 시간대 설정
          </Link>
        ) : null}
      </section>

      <section className="mt-3.5 mb-6 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="eye" className="size-4 text-ink-dim" />
          프로필 사진
          <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">준비 중</span>
        </h2>
        <p className="mt-1 text-[10.5px] text-ink-muted">
          아직 올릴 수 없습니다. 사진을 담을 Storage 버킷과 그 접근 정책이 서야 하고(이니셔티브
          로고가 쓰는 것과 같은 한 벌입니다), 그것은 다음 블록의 일입니다. 지금 화면 곳곳의
          동그라미는 이름의 첫 글자입니다.
        </p>
      </section>
    </div>
  )
}

function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
    </div>
  )
}
