import Link from 'next/link'

import {
  ACTIVITY_DEDUP_MINUTES,
  ACTIVITY_RETENTION_DAYS,
  ACTIVITY_TIMELINE_DAYS,
} from '@/lib/activity'
import { STAFF_BRAND } from '@/lib/brand'

/**
 * /privacy — 개인정보 처리방침 (블록 7).
 *
 * ■ 왜 블록 7이 이 문서를 세우는가 ■
 * 이 블록이 처음으로 **사람의 행동을 기록**하기 시작한다. 원문이 고지 문구와 이
 * 문서를 같이 시킨 이유가 그것이고, 둘은 옵션이 아니라 기능의 일부다.
 * 설정 허브는 이 자리를 '준비 중'으로 두고 "블록 7이 열람 기록 항목과 함께 세운다"고
 * 적어 두었다 — 그 약속의 이행이다.
 *
 * ■ 로그인 전에 열린다 ■ proxy.ts의 PUBLIC_PATHS에 있다. 로그인해야만 열리는
 * 처리방침은 고지가 아니다.
 *
 * ■ 여기 적힌 것은 전부 실제 동작이다 ■ 보관 기간도, IP를 안 남긴다는 것도,
 * 누가 보는지도 코드와 0031의 정책이 그대로 집행한다. 지키지 않을 문장을 적지 않았다.
 * 법률 자문을 받은 문서가 아니다 — 그 사실도 아래에 적었다.
 */
export const metadata = {
  // 루트 layout의 title.template이 서비스 이름(DY 그룹웨어)을 뒤에 붙인다.
  title: '개인정보 처리방침',
}

export default function PrivacyPage() {
  return (
    <main data-skin="simple" className="min-h-full bg-app px-5 py-10">
      <div className="mx-auto w-full max-w-[760px]">
        <Link href="/login" className="flex items-center gap-2">
          {/* 로그인 전 화면이라 직원 이름이 기본이다(lib/brand.ts). */}
          <span className="text-t16 font-bold tracking-tight">{STAFF_BRAND}</span>
        </Link>

        <h1 className="mt-6 text-t22 font-bold tracking-tight">개인정보 처리방침</h1>
        <p className="mt-1.5 text-t12 leading-relaxed text-ink-dim">
          {STAFF_BRAND}는 그룹 내부 업무 시스템입니다. 이 문서는 이 시스템이 무엇을 남기고,
          왜 남기며, 누가 보고, 얼마나 두는지를 적습니다. 지키지 않을 문장은 적지
          않았습니다 — 아래의 모든 항목은 코드와 데이터베이스 정책이 그대로 집행합니다.
        </p>

        {/* ───────── 1. 열람 기록 ───────── */}
        <Article title="1. 열람 기록 (접속 현황)">
          <P>
            로그인한 사람이 어떤 화면을 열었는지를 감사 기록(<Code>audit_log</Code>)에
            남깁니다. 시스템 안에서 무슨 일이 있었는지에 답할 수 없는 업무 시스템은
            감사를 받을 수 없기 때문입니다.
          </P>

          <H>무엇을 남기나</H>
          <Ul>
            <li>누가 — 계정 식별자와 그 시점의 역할</li>
            <li>언제 — 접속 시각</li>
            <li>무엇을 — 화면 경로, 그리고 문서를 열었다면 그 문서의 식별자</li>
            <li>어디서 — <b className="font-semibold text-ink">도시까지만</b> 남깁니다(예: &apos;Seoul, KR&apos;)</li>
            <li>무엇으로 — 기기 <b className="font-semibold text-ink">요약</b>(예: &apos;Chrome · Windows&apos;)과 브라우저가 알려 준 시간대</li>
          </Ul>

          <H>무엇을 남기지 않나</H>
          <Ul>
            <li>
              <b className="font-semibold text-ink">IP 주소 원본을 남기지 않습니다.</b> 기록을
              만드는 데이터베이스 함수에 IP를 받을 인자 자체가 없고, 도시 칸에 IP처럼 보이는
              값이 들어오면 데이터베이스가 버립니다. 한 번 새면 되돌릴 수 없는 종류의 값이라
              애초에 받지 않습니다.
            </li>
            <li>
              브라우저가 보내는 <b className="font-semibold text-ink">User-Agent 원문</b>을
              남기지 않습니다. 그 문자열은 글꼴·확장·빌드 번호까지 담은 지문입니다. 요약이
              아닌 값이 들어오면 데이터베이스가 버립니다.
            </li>
            <li>
              화면에 무엇이 쓰여 있었는지(본문·금액·첨부)는 남기지 않습니다. 어떤 화면을
              열었는가까지입니다.
            </li>
            <li>
              같은 화면에 {ACTIVITY_DEDUP_MINUTES}분 안에 다시 들어간 것은 한 줄로 셉니다.
              새로고침 횟수는 기록되지 않습니다 — 이 시스템은 사람의 손가락을 세지 않습니다.
            </li>
          </Ul>

          <H>누가 보나</H>
          <P>
            접속 현황은{' '}
            <b className="font-semibold text-ink">대표만 보는 관리자 화면</b>에 나옵니다. 그 화면에
            데이터를 내주는 데이터베이스 함수는 대표가 아닌 세션에는 0건을 돌려줍니다.
          </P>
          <P>
            그 밖에 본인은 자기 기록을 볼 수 있고, 조직 위계상 직속·간접 상사는 자기 아래
            사람의 감사 기록을 볼 수 있습니다(위계 정책). AI 작업은{' '}
            <b className="font-semibold text-ink">개별 기록을 한 줄도 읽지 못합니다</b> — 관리자용
            요약에는 건수만 집계된 숫자가 갑니다(사람도 경로도 도시도 없습니다).
          </P>

          <H>얼마나 두나</H>
          <P>
            <b className="font-semibold text-ink">{ACTIVITY_RETENTION_DAYS}일입니다.</b> 그
            기간이 지난 열람 기록은 대표에게도, 본인에게도, 상사에게도 보이지 않습니다 —
            읽을 수 있는 사람이 한 명도 없게 데이터베이스 정책이 막습니다.
          </P>
          <P>
            다만 <b className="font-semibold text-ink">행 자체를 삭제하지는 않습니다.</b> 감사
            기록은 고칠 수도 지울 수도 없게 만들어져 있고(append-only), 지울 수 있게 만드는
            순간 &apos;지워진 기록&apos;과 &apos;없었던 일&apos;을 구분할 방법이 사라져 감사
            기록이 아니게 됩니다. 그래서 <b className="font-semibold text-ink">지우는 대신
            아무도 읽을 수 없게</b> 합니다. 이 절충을 숨기지 않고 여기에 적어 둡니다.
          </P>
          <P>
            접속 현황 화면이 실제로 보여 주는 범위는 최근 {ACTIVITY_TIMELINE_DAYS}일입니다.
          </P>
        </Article>

        {/* ───────── 2. 로그인 기록 ───────── */}
        <Article title="2. 로그인 기록">
          <P>
            로그인 성공과 실패를 같은 감사 기록에 남깁니다. 실패를 남기지 않으면 남의 계정에
            들어가려는 시도를 알 방법이 없습니다.
          </P>
          <Ul>
            <li>
              실패 기록은 <b className="font-semibold text-ink">이미 존재하는 활성 계정</b>에
              대해서만 남습니다. 등록되지 않은 이메일로는 아무것도 기록되지 않습니다.
            </li>
            <li>
              비밀번호는 어떤 형태로도 기록에 남지 않습니다. 남는 것은 계정 식별자 · 시각 ·
              기기 요약 · 도시입니다.
            </li>
            <li>로그인 화면의 오류 문구는 어느 쪽이 틀렸는지 말하지 않습니다.</li>
          </Ul>
        </Article>

        {/* ───────── 3. 업무 데이터 ───────── */}
        {/* Phase 6-2 블록 2 · 3 — 접속 표시 · 새 기기 알림 · 원격 로그아웃 · 삭제 방식.
            로그인 전에도 열리는 화면이라 회장 전용 기능 이름(그룹 시티 등)을 쓰지 않는다 — CLAUDE.md 직원 화면 용어 원칙. */}
        <Article title="2-1. 접속 표시 · 새 기기 · 세션">
          <Ul>
            <li>
              <b className="font-semibold text-ink">접속 · 활동은 관리자 화면에 회사 단위로 표시됩니다.</b> 최근
              5분 안에 접속했는지, 진행 중인 업무와 결재가 몇 건인지가 소속 회사별로 그려집니다. 이 표시는
              대표만 볼 수 있고, <b className="font-semibold text-ink">이름도 그 관리자 화면에만</b> 붙습니다. 누가 어떤
              화면 · 문서를 열었는지는 그리지 않습니다.
            </li>
            <li>
              지난 90일 동안 쓴 적 없는 기기로 로그인하면 <b className="font-semibold text-ink">본인에게 알림</b>이
              가고, 대표에게도 보안 알림(카카오톡)이 갑니다. 알림에 담기는 것은 기기 요약과 도시뿐입니다.
            </li>
            <li>
              로그인은 7일 동안 유지되고 그 뒤에는 다시 로그인합니다. 대표는 특정 사용자의 모든 기기를 한 번에
              로그아웃시킬 수 있습니다. 임원 이상은 2단계 인증(인증 앱)이 필수입니다.
            </li>
            <li>
              업무 기록(결재 · 문서 · 할 일 등)은 <b className="font-semibold text-ink">지워도 행이 남습니다</b> —
              지운 표시가 붙어 화면에서 사라질 뿐 감사를 위해 보존됩니다.
            </li>
          </Ul>
        </Article>

        <Article title="3. 업무 데이터와 개인 설정">
          <P>
            이 시스템은 그룹의 업무 데이터(회사·재무·업무·문서·결정)를 다룹니다. 무엇이 누구에게
            보이는지는 역할 · 회사 · 조직 위계 · 보안등급 네 겹이 동시에 정하며, 그 판정은
            화면이 아니라 데이터베이스가 합니다. 권한이 없는 행은 &apos;가려지는&apos; 것이
            아니라 <b className="font-semibold text-ink">존재하지 않는 것처럼</b> 보입니다.
          </P>
          <P>
            프로필(이름 · 직함 · 생년월일 · 표기 언어)은 본인이 고칩니다. 역할과 보안등급은
            본인이 바꿀 수 없습니다 — 그것은 권한 그 자체이기 때문입니다.
          </P>
          <P>
            화면 설정(테마 · 사이드바 · 대시보드 배치)은 본인 외에 아무도 읽지 못합니다.
            대표도 읽지 못합니다 — 업무 데이터가 아니기 때문입니다.
          </P>
          <P>
            <b className="font-semibold text-ink">데이터를 내보내는 통로가 없습니다.</b> 파일로
            받아 가는 버튼도, 그 코드도 두지 않았습니다.
          </P>
        </Article>

        {/* ───────── 4. 외부로 나가는 것 ───────── */}
        <Article title="4. 외부로 나가는 것">
          <Ul>
            <li>
              <b className="font-semibold text-ink">위치 조회 서비스를 쓰지 않습니다.</b> 도시는
              배포 환경(Vercel)이 요청 헤더에 이미 넣어 주는 값을 그대로 읽을 뿐이고, IP를
              어딘가에 보내 도시를 되묻지 않습니다. 그 헤더가 없는 환경에서는 도시 칸이 비고,
              화면은 그것을 &apos;—&apos;로 그립니다. 비어 있는 것을 그럴듯하게 채우지
              않습니다.
            </li>
            <li>
              관리자용 요약을 만들 때 AI 모델을 부릅니다. 그때 나가는 것은 회사 단위 요약이며,
              개별 열람 기록은 나가지 않습니다.
            </li>
            <li>
              관리자용 요약은 대표 본인이 연결한 경우에만 대표의 카카오톡으로 갑니다. 직원에게는
              가지 않습니다.
            </li>
          </Ul>
        </Article>

        {/* ───────── 5. 문의 ───────── */}
        <Article title="5. 문의와 한계">
          <P>
            이 문서는 법률 자문을 받아 작성한 것이 아니라,{' '}
            <b className="font-semibold text-ink">이 시스템이 실제로 하는 일을 그대로 적은
            것</b>입니다. 법적 요건에 맞춘 문구가 필요해지는 시점에 전문가의 검토를 받아
            고쳐야 합니다.
          </P>
          <P>
            기록에 대한 문의는 대표님께 직접 말씀해 주세요. 별도의 문의 창구(메일 주소 ·
            티켓)는 아직 정해지지 않았습니다 — 없는 주소를 적어 두지 않았습니다.
          </P>
        </Article>

        <div className="mt-8 flex items-center gap-3 border-t border-line-soft pt-4">
          <Link
            href="/login"
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            로그인으로
          </Link>
          <span className="text-t10 text-ink-muted">
            마지막 개정: 2026-10 (표현 정리 — 관리자 화면 명칭)
          </span>
        </div>

        {/* ───────── 영문 요약 ───────── */}
        <section className="mt-6 rounded-xl border border-line-soft bg-panel p-4">
          <h2 className="text-t13 font-semibold">Privacy notice (English summary)</h2>
          <p className="mt-1.5 text-t11 leading-relaxed text-ink-dim">
            This system records which screens you open: your account, the time, the path, the
            document id if any, a short device summary (e.g. &quot;Chrome · Windows&quot;), the city
            (never the raw IP address) and your time zone. Repeat visits to the same screen within{' '}
            {ACTIVITY_DEDUP_MINUTES} minutes count as one. These records are kept for{' '}
            {ACTIVITY_RETENTION_DAYS} days, after which no one — not even the CEO — can read
            them; the rows are not deleted because the audit log is append-only by design. The
            activity screen is an administrator screen only the CEO can open. You can always see your own records. Failed sign-ins
            are recorded for existing accounts only; passwords never are. Your presence and activity
            appear on an administrator screen at company level only (never who opened what). Signing in from a device
            unused for 90 days notifies you and the CEO. Sessions last 7 days; Executives and above
            must use two-step verification. Deleted work records are hidden, not erased. There is no data export
            from this system.
          </p>
        </section>

        <div className="pb-8" />
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ 조각들 */

function Article({
  title,
  badge,
  children,
}: {
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-5 rounded-xl border border-line-soft bg-panel p-4">
      <h2 className="flex flex-wrap items-baseline gap-1.5 text-t14 font-semibold">
        {title}
        {badge ? (
          <span className="rounded bg-raised px-1.5 py-0.5 text-t9h font-normal text-ink-dim">
            {badge}
          </span>
        ) : null}
      </h2>
      <div className="mt-1.5 space-y-2">{children}</div>
    </section>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-2.5 text-t11h font-semibold text-ink">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-t11h leading-relaxed text-ink-dim">{children}</p>
}

function Ul({ children }: { children: React.ReactNode }) {
  return (
    <ul className="ml-4 list-disc space-y-1 text-t11h leading-relaxed text-ink-dim marker:text-ink-muted">
      {children}
    </ul>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-raised px-1 py-0.5 text-t10h text-ink-dim">{children}</code>
}
