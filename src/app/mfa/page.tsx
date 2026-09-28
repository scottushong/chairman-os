import { mfaEnforced } from '@/lib/supabase/proxy'

import { MfaPanel } from './mfa-panel'

/**
 * /mfa — 2단계 인증(TOTP) (Phase 6-2 블록 3). MFA_ENFORCE=true면 Executive 이상은 필수라 proxy가
 * 여기로 보낸다(세션이 aal2가 아니면). 그 밖에는 선택 — /settings/profile에서 들어온다.
 * 관제 셸 밖에 둔다: 2단계를 마치기 전에는 회사도 숫자도 보이면 안 된다.
 */
export default async function MfaPage({ searchParams }: PageProps<'/mfa'>) {
  const params = await searchParams
  const raw = Array.isArray(params.next) ? params.next[0] : params.next
  const next = raw?.startsWith('/') && !raw.startsWith('//') ? raw : '/'
  const enforced = mfaEnforced()
  return (
    <main className="flex min-h-full items-center justify-center bg-app px-5 py-10">
      <div className="glass w-full max-w-[420px] rounded-glass p-5">
        <h1 className="text-t16 font-bold">2단계 인증</h1>
        <p className="mt-1 text-t12 leading-relaxed text-ink-dim">
          인증 앱(Google Authenticator · 1Password · Authy 등)의 6자리 코드로 한 번 더 확인합니다.
          {enforced ? ' 임원 이상은 필수입니다.' : ''}
        </p>
        <p className="mt-0.5 text-t11 text-ink-muted">
          Two-step verification with an authenticator app.{enforced ? ' Required for Executives and above.' : ''}
        </p>
        <MfaPanel next={next} />
      </div>
    </main>
  )
}
