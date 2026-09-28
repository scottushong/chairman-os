import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { PhotoUpload } from '@/components/settings/photo-upload'
import { ProfileForm } from '@/components/settings/profile-form'
import { Icon } from '@/components/ui/icon'
import { decideChairmanTimezone } from '@/lib/chairman-timezone'
import { formatDateTime } from '@/lib/format'
import { getRepository } from '@/lib/repository'
import { mfaEnforced } from '@/lib/supabase/proxy'
import { ROLE_LABEL_KO, SECURITY_CLASS_LABEL_KO } from '@/types'

/**
 * /settings/profile — 내 프로필 (Phase 5-E 2절).
 *
 * 헤더 오른쪽의 이름을 누르면 여기로 온다. 전 사용자 공통 화면이다 —
 * 역할이 무엇이든 자기 이름은 자기가 고친다(0030 update_own_profile이 그 문이다).
 *
 * **프로필 사진(Storage)이 섰다(0032).** 5-E가 '준비 중'으로 남겨 둔 자리를 갚았다 —
 * 0018이 initiative-logos에 한 것과 같은 한 벌(비공개 버킷 + 정책 넷 + 서명 URL)이고,
 * 다른 것은 '누가'뿐이다: 올리는 것은 **본인만**, 보는 것은 **이름이 보이는 사람**이다.
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

  // 한 장짜리도 signProfilePhotos로 서명한다 — 별도의 단건 서명 API를 새로 만들지 않는다
  // (/initiatives/[id]가 로고 한 장에 signInitiativeLogos를 쓰는 것과 같다).
  const photoUrls = profile.photo_path ? await repo.signProfilePhotos([profile.photo_path]) : {}
  const photoUrl = profile.photo_path ? photoUrls[profile.photo_path] : undefined

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

      {/* Phase 6-2 블록 3 — 2단계 인증. MFA_ENFORCE=true면 임원 이상은 proxy가 필수로 보낸다. 나머지는 여기서 켠다. */}
      <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="shield" className="size-4 text-ink-dim" />
          2단계 인증
        </h2>
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
          인증 앱(Google Authenticator 등)의 6자리 코드로 한 번 더 확인합니다.
          {mfaEnforced() ? ' 임원 이상은 필수이고, 그 밖의 역할은 선택입니다.' : ''} 비밀번호는 12자 이상이어야 하며 유출된 비밀번호 목록에 있으면 쓸 수 없습니다.
        </p>
        <Link
          href="/mfa?next=/settings/profile"
          className="mt-2 inline-block rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          2단계 인증 설정 · 확인
        </Link>
      </section>

      <section className="mt-3.5 mb-6 rounded-xl border border-line-soft bg-panel p-3.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          <Icon name="eye" className="size-4 text-ink-dim" />
          프로필 사진
        </h2>
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
          조직도와 사람 목록에 이 사진이 뜹니다. <b className="font-semibold text-ink-dim">보이는
          범위는 이름이 보이는 범위와 같습니다</b> — 조직도에 이름이 안 보이는 사람에게는 얼굴도
          보이지 않고, 그 판정은 화면이 아니라 데이터베이스가 합니다.
          사진은 <b className="font-semibold text-ink-dim">본인만</b> 올리고 내립니다. 회장님도
          남의 사진은 바꾸지 못합니다. 올리지 않으면 이름의 첫 글자가 대신 섭니다.
        </p>
        <PhotoUpload name={profile.display_name} path={profile.photo_path} url={photoUrl} />
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
