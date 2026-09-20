'use client'

import { useActionState, useState, useTransition } from 'react'

import {
  changePassword,
  signOutOtherDevices,
  type AccountState,
} from '@/app/actions/account'

/**
 * 계정·보안의 손이 닿는 두 가지 (Phase 5-E 4절).
 *
 * 읽기만 하는 칸(마지막 로그인·기기·위치)은 서버가 그린다 — 이 파일은 **바꾸는 것**만 맡는다.
 *
 * 'live'가 false면(dummy 개발, Supabase 키 없음) 둘 다 실제로 할 수 없다.
 * 그때는 입력칸을 열어 두고 누르면 실패 문구를 띄우는 대신 **아예 안 그리고 이유를 적는다** —
 * 눌러야만 안 된다는 걸 알 수 있는 버튼은 죽은 버튼과 구별되지 않는다.
 */
export function AccountSecurity({ live }: { live: boolean }) {
  if (!live) {
    return (
      <p className="mt-2 rounded-lg bg-raised px-3 py-2.5 text-[11px] text-ink-dim">
        지금은 dummy 모드라 로그인이라는 개념이 없습니다. 비밀번호 변경과 기기 로그아웃은
        실제 계정으로 접속했을 때 이 자리에 나타납니다.
      </p>
    )
  }
  return (
    <div className="mt-2.5 space-y-3">
      <PasswordForm />
      <OtherDevices />
    </div>
  )
}

function PasswordForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(changePassword, {})

  return (
    <form action={action} className="rounded-lg bg-raised px-3 py-2.5">
      <p className="text-[11.5px] font-semibold text-ink">비밀번호 변경</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="새 비밀번호 (8자 이상)"
          minLength={8}
          required
          className={INPUT}
        />
        <input
          type="password"
          name="password_confirm"
          autoComplete="new-password"
          placeholder="한 번 더"
          minLength={8}
          required
          className={INPUT}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
        >
          {pending ? '바꾸는 중…' : '바꾸기'}
        </button>
      </div>
      <Result state={state} />
      <p className="mt-1 text-[10px] text-ink-muted">
        지금 비밀번호를 다시 묻지 않습니다 — 이 세션이 이미 본인 것임을 Supabase가 확인한
        상태이고, 재확인 여부는 앱이 아니라 프로젝트의 인증 설정이 정합니다.
      </p>
    </form>
  )
}

function OtherDevices() {
  const [state, setState] = useState<AccountState>({})
  const [pending, start] = useTransition()

  return (
    <div className="rounded-lg bg-raised px-3 py-2.5">
      <p className="text-[11.5px] font-semibold text-ink">다른 기기 모두 로그아웃</p>
      <p className="mt-0.5 text-[10.5px] text-ink-muted">
        지금 보고 있는 이 창은 그대로 남고, 다른 기기·다른 브라우저의 로그인만 끊깁니다.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setState(await signOutOtherDevices()))}
        className="mt-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-critical hover:text-critical disabled:opacity-50"
      >
        {pending ? '끊는 중…' : '다른 기기 모두 로그아웃'}
      </button>
      <Result state={state} />
    </div>
  )
}

function Result({ state }: { state: AccountState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-1.5 text-[11px] text-critical">
        {state.error}
      </p>
    )
  }
  if (state.done) return <p className="mt-1.5 text-[11px] text-ok">{state.done}</p>
  return null
}

const INPUT =
  'w-[190px] rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors focus:border-accent'
