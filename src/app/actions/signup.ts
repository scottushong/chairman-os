'use server'

import { randomBytes } from 'node:crypto'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { passwordProblem } from '@/lib/password'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * 가입 (Phase 6-2 블록 2). /login «처음이세요?» → 이메일 → (초대된 이메일만) Supabase signUp → 인증 메일 →
 * /auth/confirm → 비밀번호 정하기 → 첫 화면. 팀 · 역할 · 상사 연결은 auth.users가 생기는 순간 0028
 * apply_user_invitation()이 한다(이 파일이 아니다).
 *
 * **초대 안 된 이메일은 signUp을 부르지 않는다** — «관리자에게 문의». 누가 API로 signUp을 직접 불러도
 * 프로필이 생기지 않아 로그인에서 막힌다(auth.ts) — 두 겹이다.
 *
 * signUp에는 비밀번호가 필요해서 **버리는 무작위 값**을 넣는다. 사람은 인증 메일을 거친 뒤에야 자기
 * 비밀번호를 정한다(원문 순서: 인증 메일 → 비밀번호).
 */

export interface SignupState {
  error?: string
  sent?: boolean
}

export async function startSignup(_prev: SignupState, form: FormData): Promise<SignupState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: '이메일 형식이 맞지 않습니다.' }

  const sb = await createSupabaseServerClient()
  const { data: open, error: openError } = await sb.rpc('invitation_open', { p_email: email })
  if (openError) {
    console.error('[signup] invitation_open', openError.code)
    return { error: '지금은 가입을 확인할 수 없습니다. 잠시 후 다시 시도하세요.' }
  }
  if (open !== true) {
    return { error: '등록되지 않은 이메일입니다. 관리자에게 문의하세요.' }
  }

  const h = await headers()
  const origin = process.env.APP_BASE_URL?.replace(/\/+$/, '') || `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`
  const { error } = await sb.auth.signUp({
    email,
    password: randomBytes(24).toString('base64url'),
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  })
  if (error) {
    console.error('[signup] signUp', error.code ?? error.status)
    // 메일 한도(over_email_send_rate_limit)는 사람에게 그대로 말한다 — 기다리면 되는 일이다.
    if (/rate_limit/.test(error.code ?? '')) return { error: '인증 메일을 너무 많이 보냈습니다. 한 시간쯤 뒤 다시 시도하세요.' }
    return { error: '가입 메일을 보내지 못했습니다. 관리자에게 문의하세요.' }
  }
  return { sent: true }
}

export interface SetPasswordState {
  error?: string
}

/** 인증 메일을 거친 세션에서만 — 비밀번호를 정하고 첫 화면으로. 12자 · 유출 목록 검사. */
export async function setPassword(_prev: SetPasswordState, form: FormData): Promise<SetPasswordState> {
  const password = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')
  if (password !== confirm) return { error: '두 비밀번호가 다릅니다.' }
  const problem = await passwordProblem(password)
  if (problem) return { error: problem }

  const sb = await createSupabaseServerClient()
  const { data: userData } = await sb.auth.getUser()
  if (!userData.user) return { error: '인증이 만료되었습니다. 가입 메일의 링크를 다시 눌러 주세요.' }
  const { error } = await sb.auth.updateUser({ password })
  if (error) {
    console.error('[signup] updateUser', error.code ?? error.status)
    return { error: '비밀번호를 정하지 못했습니다.' }
  }
  const { data: profile } = await sb.from('user_profiles').select('role').eq('user_id', userData.user.id).maybeSingle<{ role: string }>()
  redirect(profile?.role === 'Member' || profile?.role === 'TeamLead' ? '/me' : '/')
}
