import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { AiUsagePanel } from '@/components/settings/ai-usage'
import { AccountSecurity } from '@/components/settings/account-security'
import { CityMotionSwitch, NotifySwitches, ThemePicker } from '@/components/settings/display-prefs'
import { WorldCitiesEditor } from '@/components/settings/world-cities-editor'
import { Icon, type IconName } from '@/components/ui/icon'
import { canEditChairmanRoutine, canManageUsers } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { boss } from '@/lib/boss'
import { formatDateTime } from '@/lib/format'
import { getRepository } from '@/lib/repository'
import { readSessionInfo } from '@/lib/session-info'
import { loadUiPrefs } from '@/lib/ui-prefs-server'
import { appVersion } from '@/lib/version'
import { ROLE_LABEL_KO } from '@/types'

/**
 * /settings — 설정 허브 (Phase 5-E 4절).
 *
 * ■ 기존 설정 라우트를 옮기지 않는다 ■
 * /settings/chairman · /settings/users · /settings/process-charts는 그 자리에 그대로 두고
 * 여기서 **링크만** 한다. 곧 올 Phase 7이 "기존 URL 전부 리다이렉트 유지(북마크가 깨지지
 * 않게)"를 명시했고, 그 앞에서 라우트를 옮기는 것은 이번 범위 밖의 것을 깨는 일이다.
 * (원문·브리프가 말한 `/settings/approvals`는 이 저장소에 없다 — 결재 화면의 주소는
 * `/approvals`다. 없는 주소를 만들지 않고 있는 주소로 잇는다.)
 *
 * ■ 권한 없는 절은 **렌더하지 않는다** ■
 * 회색으로 비활성만 해 두면 "왜 안 되지"가 남고, 그 회색 버튼은 죽은 버튼과 구별되지 않는다.
 * 각 절의 머리에 '전 사용자 공통 / 회장 전용'을 글자로 적어 둔다 — 안 보이는 절이 있다는
 * 사실 자체는 알 수 있어야 남의 화면과 다른 것을 고장으로 읽지 않는다.
 *
 * ■ '내 데이터 내보내기'는 없다 ■
 * 원문 4절에 있던 항목이지만 뒤따라온 `5-E 변경`이 취소했다("나가는 통로 없음.
 * 내보내기 관련 코드·버튼 만들지 않는다"). 같은 절의 감사 로그 열람만 남는다.
 */
/** /settings의 AI 비용 표가 거슬러 보는 날 수. */
const AI_USAGE_DAYS = 14

export default async function SettingsHubPage() {
  const user = await currentUser()
  // 세션이 없으면 개인 설정이라는 것도 없다. /settings/users·/settings/chairman과 같은 방식이다.
  if (!user) notFound()

  const repo = await getRepository()
  const [prefs, session, profile, kakao, aiUsage] = await Promise.all([
    loadUiPrefs(),
    readSessionInfo(),
    repo.getMyProfile(),
    // 카카오 연결 상태는 회장 것 하나뿐이다. 다른 역할에게는 아래에서 이 절을 아예 안 그린다.
    canEditChairmanRoutine(user) ? repo.getKakaoConnection() : Promise.resolve(null),
    // Phase 11 일별 AI 비용 — 회장만(0045 ai_usage_log_read). 다른 역할은 부르지도 않는다.
    canEditChairmanRoutine(user) ? repo.listAiUsageDays(AI_USAGE_DAYS).catch(() => []) : Promise.resolve([]),
  ])

  const version = appVersion()
  const isChairman = canEditChairmanRoutine(user)
  const isAdmin = canManageUsers(user)
  // 직원 화면 용어 원칙(CLAUDE.md): 회장 본인 = 회장, 그 외 = 대표.
  const bossName = boss(user.role)

  return (
    <div className="mx-auto max-w-[900px] px-6 py-5">
      <PageHeader
        icon="settings"
        title="설정"
        code="Phase 5-E"
        description="이 화면과 계정에 관한 것을 한자리에 모았습니다. 업무 데이터를 바꾸는 화면은 여기에 없습니다."
      />

      {/* ───────── 프로필 ───────── */}
      <Section icon="users" title="프로필" scope="전 사용자 공통">
        <p className="text-t11 text-ink-dim">
          {profile ? (
            <>
              <span className="font-semibold text-ink">{profile.display_name}</span>
              {profile.display_name_en ? ` · ${profile.display_name_en}` : ''}
              {` · ${profile.title_ko || ROLE_LABEL_KO[profile.role]}`}
              {profile.birth_date ? ` · ${profile.birth_date}` : ' · 생년월일 —'}
            </>
          ) : (
            '프로필을 읽지 못했습니다.'
          )}
        </p>
        <Go href="/settings/profile">이름·직함·생년월일·언어 고치기</Go>
      </Section>

      {/* ───────── 계정·보안 ───────── */}
      <Section icon="shield" title="계정·보안" scope="전 사용자 공통">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-t11h sm:grid-cols-4">
          <Cell label="마지막 로그인" value={session.lastSignInAt ? formatDateTime(session.lastSignInAt) : null} />
          <Cell label="지금 이 기기" value={session.device} />
          <Cell label="접속 위치" value={session.place} />
          <Cell label="접속 IP" value={session.ip} />
        </dl>

        {/*
         * 비어 있는 칸의 이유를 화면이 스스로 말한다. '—'만 남겨 두면 고장으로 읽힌다.
         * 여기 적힌 것이 실제 사정 그대로다(lib/session-info.ts 머리 주석).
         */}
        <ul className="mt-2 space-y-1 text-t10h text-ink-muted">
          <li>
            · <b className="font-semibold">지난 로그인 목록</b>을 보여 주는 화면은 아직
            없습니다. 블록 7부터 로그인 줄에 기기 요약과 도시가 같이 남지만(IP 원본은 남기지
            않습니다), 그것을 한 판에 늘어놓는 화면은 {isChairman ? '회장 전용 접속 현황' : '관리자 화면'}뿐입니다. 본인용
            목록 화면은 필요해지는 날 세웁니다 — 지금은 목록이 없다고 말하는 쪽이 맞습니다.
          </li>
          <li>
            · <b className="font-semibold">활성 세션 목록</b>도 지금 이 기기 한 줄이 전부입니다.
            세션 목록을 주는 API는 관리자 키로만 열리는데 이 프로젝트에는 그 키가 없습니다
            (service_role 없음). 끊는 것은 본인 권한으로 할 수 있어 아래 버튼은 실제로 동작합니다.
          </li>
          <li>
            · 위치·IP는 Vercel 엣지가 채우는 값입니다. 로컬에서 열면 비어 있는 것이 정상입니다.
          </li>
        </ul>

        <AccountSecurity live={session.live} />

        <div className="mt-2.5 rounded-lg bg-raised px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-t11h font-semibold text-ink">
            2단계 인증
            <span className="rounded bg-panel px-1.5 py-0.5 text-t9h font-normal text-ink-dim">
              준비 중
            </span>
          </p>
          <p className="mt-0.5 text-t10h text-ink-muted">
            Phase 6-3에서 붙습니다. 켜는 버튼을 미리 놓아 두지 않았습니다 — 눌러도 아무 일이
            없는 스위치는 보안 설정에서 특히 나쁜 종류의 거짓말입니다.
          </p>
        </div>
      </Section>

      {/* ───────── 알림 ───────── */}
      <Section icon="bell" title="알림" scope="전 사용자 공통">
        <p className="text-t11 text-ink-dim">앱 안의 알림(헤더 종)에서 무엇을 받을지 고릅니다.</p>
        <NotifySwitches value={prefs.app.notify} bossName={bossName} />
        {isChairman ? (
          <div className="mt-2.5 rounded-lg bg-raised px-3 py-2.5">
            <p className="text-t11h font-semibold text-ink">
              카카오 아침 브리핑 06:00 (현지 시간 자동)
            </p>
            <p className="mt-0.5 text-t10h text-ink-muted">
              연결·해제와 시간대 지정은 회장 루틴 화면에 있습니다. 같은 설정을 두 화면에서
              고칠 수 있게 하면 한쪽이 언젠가 낡은 값을 보여 줍니다.
            </p>
            <Go href="/settings/chairman">회장 루틴에서 설정</Go>
          </div>
        ) : null}
      </Section>

      {/* ───────── 화면 ───────── */}
      <Section icon="grid" title="화면" scope="전 사용자 공통">
        <p className="text-t11 text-ink-dim">테마</p>
        <ThemePicker value={prefs.app.theme} chairman={isChairman} />
        {/* 그룹 시티는 회장 전용 화면이다 — 그 스위치도 회장에게만(직원 화면 용어 원칙, CLAUDE.md). */}
        {isChairman ? <CityMotionSwitch value={prefs.app.city_motion} /> : null}

        <p className="mt-3 text-t11 text-ink-dim">관심 도시 · 세계시간</p>
        <WorldCitiesEditor value={prefs.app.world_cities} chairman={isChairman} />

        <div className="mt-3 space-y-1.5">
          <Row
            title="사이드바 항목"
            note={`지금 ${prefs.sidebar.hidden_items.length}개를 숨겨 두었습니다${
              prefs.sidebar.hide_not_ready ? ' (준비 중 항목 기본 숨김 켜짐)' : ''
            }.`}
            href="/settings/sidebar"
            cta="메뉴 고르기"
          />
          <Row
            title="대시보드 카드 순서·숨김"
            note="회사 카드의 핀·숨김·순서는 대시보드에서 카드를 직접 누르며 정합니다 — 설정에 같은 목록을 한 벌 더 두면 둘이 어긋납니다."
            href="/"
            cta="대시보드로"
          />
        </div>
      </Section>

      {/* ───────── 연결된 서비스 ───────── */}
      {isChairman ? (
        <Section icon="layers" title="연결된 서비스" scope="회장 전용">
          <div className="space-y-1.5">
            <Row
              title="카카오톡"
              note={
                kakao?.connected
                  ? `연결됨 · ${formatDateTime(kakao.updated_at)} 갱신`
                  : '연결되어 있지 않습니다. 아침 브리핑이 카카오톡으로 가지 않습니다.'
              }
              href="/settings/chairman"
              cta={kakao?.connected ? '연결 관리' : '연결하기'}
            />
            <Waiting title="Garmin" note="수면·컨디션 연동. 아직 붙지 않았습니다." />
            <Waiting title="Google" note="캘린더·드라이브 연동. 아직 붙지 않았습니다." />
          </div>
        </Section>
      ) : null}

      {/* ───────── 데이터 ───────── */}
      <Section icon="book" title="데이터" scope="전 사용자 공통">
        <p className="text-t11 text-ink-dim">
          문서·업무·결정의 변경 이력은 각 화면의 기록 줄에서 그 행만 시간 역순으로 볼 수
          있습니다.
        </p>
        {/*
          블록 7. 접속 현황은 회장 전용이라 이 줄도 회장에게만 그린다.
          권한 없는 절은 렌더하지 않는다는 이 화면의 규칙과 같다 — 회색 버튼을 두면
          "왜 안 되지"가 남고, 그 회색 버튼은 죽은 버튼과 구별되지 않는다.
        */}
        {isChairman ? (
          <div className="mt-2 space-y-1.5">
            <Row
              title="접속 현황"
              note="누가 언제 무엇을 열었는지. 현재 접속 중 · 오늘 로그인 · 30일 타임라인 · 이상 징후."
              href="/settings/activity"
              cta="열기"
            />
          </div>
        ) : null}
        <p className="mt-2 rounded-lg bg-raised px-3 py-2.5 text-t10h text-ink-muted">
          <b className="font-semibold text-ink-dim">내보내기는 없습니다.</b> 이 시스템에 나가는
          통로를 만들지 않는다는 것이 {bossName}님 지시입니다. 파일로 받아 가는 버튼도, 그 코드도
          두지 않았습니다.
        </p>
      </Section>

      {/* ───────── AI 사용량 (Phase 11 · 회장 전용) ───────── */}
      {isChairman ? (
        <Section icon="sparkles" title="AI 사용량 · 비용" scope="회장 전용">
          <AiUsagePanel rows={aiUsage} days={AI_USAGE_DAYS} />
        </Section>
      ) : null}

      {/* ───────── 관리 (권한 있는 사람에게만) ───────── */}
      {isAdmin || isChairman ? (
        <Section
          icon={isChairman ? 'crown' : 'shield'}
          title="관리"
          scope={isChairman ? '회장 전용' : `${bossName}·GroupCFO`}
        >
          <div className="space-y-1.5">
            {isAdmin ? (
              <Row
                title="사용자 · 권한"
                note="조직도, 초대, 권한 회수. 위계와 팀도 이 화면에서 고칩니다."
                href="/settings/users"
                cta="열기"
              />
            ) : null}
            {isChairman ? (
              <Row
                title="회장 루틴"
                note="장기 프로젝트, 선언문, 카카오 아침 알림, 시간대."
                href="/settings/chairman"
                cta="열기"
              />
            ) : null}
            <Row
              title="내 결정 사항"
              note="결재·승인을 기다리는 건. 대시보드 '내 결정 사항' 패널의 전체 화면입니다."
              href="/approvals"
              cta="열기"
            />
            <Row
              title="프로세스 차트"
              note="대시보드에 띄울 게시된 시트 링크를 등록합니다."
              href="/settings/process-charts"
              cta="열기"
            />
          </div>
        </Section>
      ) : null}

      {/* ───────── 이 웹에 대해 ───────── */}
      <Section icon="file-text" title="이 웹에 대해" scope="전 사용자 공통">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-t11h sm:grid-cols-4">
          <Cell label="커밋" value={version.commit} />
          <Cell label="환경" value={version.environment} />
          <Cell label="빌드 일시" value={version.builtAt ? formatDateTime(version.builtAt) : null} />
          <Cell label="마이그레이션" value={version.migration} />
        </dl>
        <p className="mt-1.5 text-t10 text-ink-muted">
          커밋과 환경은 Vercel이 배포할 때 채웁니다 — 로컬에서 열면 비어 있는 것이 정상입니다.
          마이그레이션 번호는 <b className="font-semibold">이 코드가 전제하는</b> 마지막
          번호이고, 그것이 실제 DB에 적용됐는지는 이 화면이 알 수 없습니다(운영 적용은 사람이
          확인합니다 — OPERATIONS 9절).
        </p>

        <div className="mt-2.5 space-y-1.5">
          {/* 블록 7이 세웠다. 이용약관은 아직 없다 — 없는 것을 있는 것처럼 적지 않는다. */}
          <Row
            title="개인정보 처리방침"
            note="무엇을 남기고, 왜 남기고, 누가 보고, 얼마나 두는지. 열람 기록 항목이 들어 있습니다. 로그인 없이도 열립니다."
            href="/privacy"
            cta="읽기"
          />
          <Waiting
            title="이용약관"
            note="아직 문서가 없습니다. 링크만 먼저 걸면 누르는 순간 404가 되고, 그것이 법적 문구에서는 가장 나쁜 모양입니다."
          />
          <div className="rounded-lg bg-raised px-3 py-2.5">
            <p className="text-t11h font-semibold text-ink">오픈소스</p>
            <p className="mt-0.5 text-t10h text-ink-muted">
              Next.js · React · Supabase · Tailwind CSS를 씁니다. 전체 목록과 각 라이선스는
              저장소의 <code>package.json</code>과 <code>node_modules</code>에 있습니다 —
              화면이 그 목록을 손으로 옮겨 적으면 의존성이 바뀌는 날 조용히 틀린 말이 됩니다.
            </p>
          </div>
          <div className="rounded-lg bg-raised px-3 py-2.5">
            <p className="text-t11h font-semibold text-ink">문의</p>
            <p className="mt-0.5 text-t10h text-ink-muted">
              화면이 이상하면 {bossName}님께 직접 말씀해 주세요. 별도의 문의 창구(메일 주소·티켓)는
              아직 정해지지 않았습니다 — 없는 주소를 적어 두지 않았습니다.
            </p>
          </div>
        </div>
      </Section>

      <div className="pb-6" />
    </div>
  )
}

/* ------------------------------------------------------------------ 조각들 */

/** 절 하나. 머리에 '누가 쓰는 절인가'를 반드시 적는다(원문 4절의 요구). */
function Section({
  icon,
  title,
  scope,
  children,
}: {
  icon: IconName
  title: string
  scope: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
      <h2 className="mb-2 flex items-baseline gap-1.5 text-t13 font-semibold">
        <Icon name={icon} className="size-4 text-ink-dim" />
        {title}
        <span className="rounded bg-raised px-1.5 py-0.5 text-t9h font-normal text-ink-dim">
          {scope}
        </span>
      </h2>
      {children}
    </section>
  )
}

/** 못 가져온 값은 '—'다. 그 자리에 그럴듯한 값을 지어내지 않는다. */
function Cell({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-t10h text-ink-muted">{label}</dt>
      <dd className={value ? 'mt-0.5 font-semibold text-ink' : 'mt-0.5 text-ink-muted'}>
        {value ?? '—'}
      </dd>
    </div>
  )
}

function Row({
  title,
  note,
  href,
  cta,
}: {
  title: string
  note: string
  href: string
  cta: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-raised px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-t11h font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-t10h text-ink-muted">{note}</span>
      </span>
      <Link
        href={href}
        className="shrink-0 rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
      >
        {cta}
      </Link>
    </div>
  )
}

/** 아직 없는 것. **누를 자리를 만들지 않는다** — 그것이 '준비 중'과 죽은 버튼의 차이다. */
function Waiting({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-lg bg-raised px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-t11h font-semibold text-ink">
        {title}
        <span className="rounded bg-panel px-1.5 py-0.5 text-t9h font-normal text-ink-dim">
          준비 중
        </span>
      </p>
      <p className="mt-0.5 text-t10h text-ink-muted">{note}</p>
    </div>
  )
}

/** 절 안에서 다른 화면으로 넘어가는 한 줄짜리 링크. */
function Go({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-2 inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
    >
      {children}
      <Icon name="chevron-right" className="size-3.5" />
    </Link>
  )
}
