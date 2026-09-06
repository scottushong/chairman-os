'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { signIn, type SignInState } from '@/app/actions/auth'
import { Icon } from '@/components/ui/icon'

/**
 * CH-049 로그인 폼.
 *
 * 입력값은 Server Action으로 바로 넘어간다 — 비밀번호를 브라우저 상태에 담지 않으려고
 * value/onChange로 붙들지 않고 uncontrolled로 둔다.
 */

const EMPTY: SignInState = {}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, EMPTY)

  return (
    <form action={action} className="mt-7 space-y-3">
      <input type="hidden" name="next" value={next} />

      <label className="block">
        <span className="text-[11px] text-ink-dim">이메일</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="chairman@example.com"
          className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent"
        />
      </label>

      <label className="block">
        <span className="text-[11px] text-ink-dim">비밀번호</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-[13px] text-ink outline-none focus:border-accent"
        />
      </label>

      {/* 실패 사유는 한 줄로만 말한다. 어느 쪽이 틀렸는지 알려 주면 계정 존재 여부가 새 나간다. */}
      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-[12px] leading-snug text-critical"
        >
          <Icon name="shield" className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}

/** 전송 중에는 버튼을 잠근다. 두 번 눌러 로그인 시도가 두 줄로 기록되면 안 된다(CH-051). */
function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2.5 text-[13px] font-semibold text-white transition-opacity disabled:opacity-50"
    >
      {pending ? '확인 중…' : '로그인'}
    </button>
  )
}
