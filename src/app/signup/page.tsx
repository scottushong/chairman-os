import Link from 'next/link'

import { SignupForm } from './signup-form'

/**
 * /signup — «처음이세요?» (Phase 6-2 블록 2). 로그인 전 화면이라 회사도 숫자도 없다.
 * 초대(등록)된 이메일만 가입 메일을 받는다. 나머지는 «관리자에게 문의».
 */
export default function SignupPage() {
  return (
    <main data-skin="simple" className="flex min-h-full items-center justify-center bg-app px-5 py-10">
      <div className="glass w-full max-w-[420px] rounded-glass p-6">
        <h1 className="text-t16 font-bold">처음이세요?</h1>
        <p className="mt-1 text-t12 leading-relaxed text-ink-dim">
          회사에서 등록해 둔 이메일을 넣으면 인증 메일을 보내 드립니다. 메일의 링크를 누르고 비밀번호를 정하면
          바로 시작합니다. 팀 · 역할은 등록된 대로 연결됩니다.
        </p>
        <p className="mt-1 text-t11 leading-relaxed text-ink-muted">
          First time? Enter the email your company registered. We’ll send a confirmation link; then you set a password.
        </p>
        <SignupForm />
        <Link href="/login" className="mt-4 inline-block text-t12 text-ink-dim underline underline-offset-2 hover:text-ink">
          로그인으로 돌아가기
        </Link>
      </div>
    </main>
  )
}
