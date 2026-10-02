import Link from 'next/link'

import { ACTIVITY_RETENTION_DAYS } from '@/lib/activity'
import { STAFF_BRAND } from '@/lib/brand'

import { LoginForm } from './login-form'

/**
 * CH-049 로그인 화면.
 *
 * 관제 셸(사이드바·헤더) 밖에 있다. 로그인 전에는 회사도 숫자도 보이면 안 된다 —
 * 화면에 뭐가 떠 있는지 자체가 정보다.
 *
 * 이미 로그인한 사람이 여기로 오면 proxy가 /로 되돌린다. 이 파일은 그 판정을 하지 않는다.
 */
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams
  const raw = params.next
  const candidate = Array.isArray(raw) ? raw[0] : raw
  // 열린 리다이렉트를 막는다. 서버 액션 쪽에서 한 번 더 검사한다.
  const next = candidate?.startsWith('/') && !candidate.startsWith('//') ? candidate : '/'
  // Phase 6-2 블록 3 — proxy가 세션을 끊고 보낸 까닭(7일 만료 · 회장의 원격 로그아웃).
  const reasonRaw = Array.isArray(params.reason) ? params.reason[0] : params.reason
  const reason = reasonRaw === 'expired' ? '로그인한 지 7일이 지나 다시 로그인해야 합니다.' : reasonRaw === 'revoked' ? '관리자가 모든 기기에서 로그아웃했습니다. 다시 로그인하세요.' : reasonRaw === 'confirm' ? '인증 링크가 만료되었거나 이미 쓰였습니다. «가입하기»에서 메일을 다시 받으세요.' : null

  return (
    // 로그인 전 화면은 전원 심플 스킨(globals.css 끝 블록) — 단색 바탕 위 카드 한 장. 회장도 같은 화면을 쓴다(2026-10-02).
    <main data-skin="simple" className="flex min-h-full items-center justify-center bg-app px-5 py-10">
      <div className="glass w-full max-w-[420px] rounded-glass p-6">
        <div className="flex items-center gap-2">
          {/* 로그인 전에는 누구인지 모르므로 직원 이름이 기본이다(lib/brand.ts). 왕관은 회장 화면에만 둔다(사이드바와 같은 규칙). */}
          <span className="text-t19 font-bold tracking-tight">{STAFF_BRAND}</span>
        </div>
        <p className="mt-2 text-t12 leading-relaxed text-ink-muted">
          그룹 내부 업무 시스템입니다. 계정이 있는 분만 열 수 있습니다.
        </p>

        <div className="mt-6">
          <h1 className="text-t15 font-semibold">로그인</h1>

          {reason ? (
            <p role="status" className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-t11h text-ink">
              {reason}
            </p>
          ) : null}

          <LoginForm next={next} />

          {/* Phase 6-2 블록 2 — 가입. 초대(등록)된 이메일만 인증 메일을 받는다. */}
          <p className="mt-4 text-center text-t11h text-ink-dim">
            처음이세요?{' '}
            <Link href="/signup" className="font-semibold text-accent underline underline-offset-2">
              가입하기
            </Link>
            <span className="text-ink-muted"> · First time? Sign up</span>
          </p>
        </div>

        {/*
          접속 기록 고지 (블록 7). 원문이 "로그인 화면 하단에 고지 문구 (ko/en)"를 시켰다.
          고지와 /privacy는 이 기능의 일부이지 옵션이 아니다 — 사람의 행동을 기록하면서
          그 사실을 말하지 않는 것이 이 기능의 유일한 진짜 위험이다.

          **담담하게 쓴다. 겁주지 않는다.** "감시됩니다"도 "모든 활동이 추적됩니다"도
          아니다. 남기는 것과 안 남기는 것과 보관 기간을 한 문장씩 적고, 자세한 것은
          문서로 넘긴다. 로그인 전에 읽을 수 있어야 고지라서 /privacy는 로그인 없이 열린다.

          ko/en 둘 다인 것도 원문의 요구다. 새 i18n 체계를 만들지 않는다 —
          이 저장소가 지금까지 해 온 방식대로 두 문단을 나란히 둔다.
        */}
        <div className="mt-6 rounded-lg bg-raised px-3.5 py-3">
          <p className="text-t10h leading-relaxed text-ink-dim">
            로그인하면 접속 기록이 남습니다. 남기는 것은 계정 · 시각 · 열어 본 화면 · 기기 요약 ·
            도시까지이고, IP 주소 원본은 남기지 않습니다. 기록은 {ACTIVITY_RETENTION_DAYS}일 뒤
            아무도 볼 수 없게 됩니다. 접속 · 활동 기록은 관리자 화면에 표시됩니다.
          </p>
          <p className="mt-1.5 text-t10h leading-relaxed text-ink-muted">
            Signing in is recorded: your account, the time, the screens you open, a short device
            summary and the city — never the raw IP address. Records become unreadable to everyone
            after {ACTIVITY_RETENTION_DAYS} days. Access and activity records are shown on the administrator screen.
          </p>
          <Link
            href="/privacy"
            className="mt-1.5 inline-block text-t10h text-ink-dim underline underline-offset-2 transition-colors hover:text-ink"
          >
            개인정보 처리방침 · Privacy notice
          </Link>
        </div>
      </div>
    </main>
  )
}
