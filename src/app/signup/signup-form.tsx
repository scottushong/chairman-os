'use client'

import { useActionState } from 'react'

import { startSignup, type SignupState } from '@/app/actions/signup'

export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(startSignup, {})
  if (state.sent) {
    return (
      <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-raised px-3 py-2.5 text-[12.5px] leading-relaxed">
        인증 메일을 보냈습니다. 메일함(스팸함 포함)에서 링크를 눌러 주세요. 링크를 누르면 비밀번호를 정하는 화면이 열립니다.
      </p>
    )
  }
  return (
    <form action={action} className="mt-4 space-y-2">
      <label className="block text-[11px] text-ink-dim">
        회사 이메일
        <input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[13px]" />
      </label>
      {state.error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-raised px-2.5 py-1.5 text-[12px] text-critical">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
        {pending ? '확인 중…' : '인증 메일 받기'}
      </button>
    </form>
  )
}
