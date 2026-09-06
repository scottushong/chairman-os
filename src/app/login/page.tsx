import { Icon } from '@/components/ui/icon'
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

  return (
    <main className="flex min-h-full items-center justify-center bg-app px-5 py-10">
      <div className="w-full max-w-[380px]">
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
