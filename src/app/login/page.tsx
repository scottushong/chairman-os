import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { ACTIVITY_RETENTION_DAYS } from '@/lib/activity'
import { citySrc, citySrcSet } from '@/lib/city'
import { cityPhase } from '@/lib/city-phase'
import { DATA_MODE } from '@/lib/env'

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
  const phase = await cityPhase()

  return (
    <main className="relative flex min-h-full items-center justify-center bg-app px-5 py-10">
      {/*
        Phase 8 G-1 — 전경을 배경으로 깐다(현지 시각으로 낮/저녁). **라벨 없는 전경만 쓴다.**
        로그인 전에는 회사도 숫자도 보이면 안 된다(머리 주석) — 5개사 그림은 영문 회사명이
        박혀 있어서 여기 걸지 않는다. 글자는 전부 유리 카드 위에 둔다(globals.css '유리 없이
        글자를 놓지 마라'). 그림은 장식이라 alt를 비운다.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- 폭 셋을 미리 만들어 두었다(scripts/city-assets.mjs). */}
      <img
        src={citySrc(phase)}
        srcSet={citySrcSet(phase)}
        sizes="100vw"
        alt=""
        className="pointer-events-none fixed inset-0 size-full object-cover"
      />
      <div className="glass relative w-full max-w-[420px] rounded-glass p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <Icon name="crown" className="size-6 text-gold" filled />
          <span className="text-[19px] font-bold tracking-tight">CHAIRMAN OS</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
          그룹 통합 관제 화면입니다. 계정이 있는 분만 열 수 있습니다.
        </p>

        <div className="mt-6 rounded-xl border border-line-soft bg-panel p-5">
          <h1 className="text-[15px] font-semibold">로그인</h1>
          <p className="mt-1 text-[11px] text-ink-muted">
            Supabase Auth로 인증합니다. 접근 범위는 로그인한 계정의 역할이 정합니다.
          </p>

          <LoginForm next={next} />
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
        <div className="mt-5 rounded-lg border border-line-soft bg-panel/60 px-3.5 py-3">
          <p className="text-[10.5px] leading-relaxed text-ink-dim">
            로그인하면 접속 기록이 남습니다. 남기는 것은 계정 · 시각 · 열어 본 화면 · 기기 요약 ·
            도시까지이고, IP 주소 원본은 남기지 않습니다. 기록은 {ACTIVITY_RETENTION_DAYS}일 뒤
            아무도 볼 수 없게 됩니다.
          </p>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-muted">
            Signing in is recorded: your account, the time, the screens you open, a short device
            summary and the city — never the raw IP address. Records become unreadable to everyone
            after {ACTIVITY_RETENTION_DAYS} days.
          </p>
          <Link
            href="/privacy"
            className="mt-1.5 inline-block text-[10.5px] text-ink-dim underline underline-offset-2 transition-colors hover:text-ink"
          >
            개인정보 처리방침 · Privacy notice
          </Link>
        </div>

        {/* 이 화면에 무슨 데이터가 붙어 있는지 로그인 전에 말한다. 뱃지와 같은 약속이다. */}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] tracking-[0.08em] text-ink-muted">
          <span
            className={`size-1.5 rounded-full ${DATA_MODE === 'live' ? 'bg-ok' : 'bg-warning'}`}
          />
          {DATA_MODE === 'live' ? 'LIVE DATA' : 'DUMMY DATA'}
        </p>
      </div>
    </main>
  )
}
