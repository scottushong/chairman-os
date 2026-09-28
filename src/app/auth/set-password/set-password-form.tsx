'use client'

import { useActionState } from 'react'

import { setPassword, type SetPasswordState } from '@/app/actions/signup'

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, {})
  const input = 'mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-t13'
  return (
    <form action={action} className="mt-4 space-y-2">
      <label className="block text-t11 text-ink-dim">
        새 비밀번호
        <input name="password" type="password" minLength={12} required autoComplete="new-password" className={input} />
      </label>
      <label className="block text-t11 text-ink-dim">
        한 번 더
        <input name="confirm" type="password" minLength={12} required autoComplete="new-password" className={input} />
      </label>
      {state.error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-raised px-2.5 py-1.5 text-t12 text-critical">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 text-t13 font-semibold text-white disabled:opacity-50">
        {pending ? '확인 중…' : '비밀번호 정하고 시작하기'}
      </button>
    </form>
  )
}
