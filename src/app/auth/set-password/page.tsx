import { SetPasswordForm } from './set-password-form'

/**
 * /auth/set-password — 가입 인증 뒤 비밀번호 정하기 (Phase 6-2 블록 2). 세션이 있어야 온다(proxy).
 * 12자 이상, 유출된 비밀번호 목록에 있으면 거부(lib/password.ts).
 */
export default function SetPasswordPage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-app px-5 py-10">
      <div className="glass w-full max-w-[420px] rounded-glass p-5">
        <h1 className="text-[16px] font-bold">비밀번호 정하기</h1>
        <p className="mt-1 text-[12px] text-ink-dim">12자 이상. 다른 곳에서 유출된 적 있는 비밀번호는 쓸 수 없습니다.</p>
        <SetPasswordForm />
      </div>
    </main>
  )
}
