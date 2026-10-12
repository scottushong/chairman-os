'use server'

import { redirect } from 'next/navigation'

import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { ledgerPostError } from '@/lib/ledger/post-text'
import { getRepository } from '@/lib/repository'

/**
 * 0079 «원장 → 장부 반영» 서버 액션. 판정은 DB(ledger_post_* — 스위치 · can_keep_books · 마감 달 대표 · CFO)이고,
 * 여기서도 같은 문을 먼저 본다: 로그인 · 회사 모양 · 장부 쓰기 · 기능 스위치 'ledger_post'. 결과는 화면 주소의 msg / err.
 */

const BIZ = /^[a-z0-9_]{2,40}$/
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const UUID = /^[0-9a-f-]{36}$/i
const text = (v: FormDataEntryValue | null, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

async function guard(businessId: string, period: string) {
  const back = (k: 'msg' | 'err', m: string): never =>
    redirect(`/finance/${encodeURIComponent(businessId)}/ledger-post?period=${encodeURIComponent(PERIOD.test(period) ? period : '')}&${k}=${encodeURIComponent(m)}`)
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!BIZ.test(businessId) || !canKeepBooks(user, businessId)) back('err', '이 회사의 장부를 쓸 권한이 없습니다.')
  if (!(await featureOn(user, 'ledger_post', businessId))) back('err', '지금은 쓸 수 없는 기능입니다.')
  return back
}

/** 반영 대기 — 고른 원장 줄(같은 거래 same 묶음 줄은 DB가 함께 넣는다). */
export async function stageLedgerPost(businessId: string, form: FormData): Promise<void> {
  const period = text(form.get('period'), 7)
  const back = await guard(businessId, period)
  const lines = form.getAll('line').map((v) => Number(v)).filter((n) => Number.isSafeInteger(n) && n > 0)
  if (lines.length === 0) back('err', '반영할 줄을 고르세요.')
  const date = text(form.get('entry_date'), 10)
  let id = ''
  try {
    id = await (await getRepository()).ledgerPostStage(businessId, lines, text(form.get('counter'), 40) || null, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, text(form.get('reason')) || null)
  } catch (e) {
    back('err', ledgerPostError(e))
  }
  back('msg', `반영 대기에 넣었습니다 (${id.slice(0, 8)}).`)
}

/** 반영 / 무효 처리(한 건). */
export async function decideLedgerPost(businessId: string, form: FormData): Promise<void> {
  const period = text(form.get('period'), 7)
  const back = await guard(businessId, period)
  const post = text(form.get('post'), 36)
  const what = text(form.get('what'), 10)
  const reason = text(form.get('reason'))
  if (!UUID.test(post) || !['apply', 'void'].includes(what)) back('err', '반영 건을 다시 고르세요.')
  if (what === 'void' && reason.length < 2) back('err', '무효 이유를 2자 이상 적어 주세요.')
  let slip = ''
  try {
    const repo = await getRepository()
    slip = what === 'apply' ? await repo.ledgerPostApply(post, reason || null) : await repo.ledgerPostVoid(post, reason)
  } catch (e) {
    back('err', ledgerPostError(e))
  }
  back('msg', what === 'apply' ? `장부에 반영했습니다 (전표 ${slip}).` : `무효 처리했습니다 (${slip.startsWith('M') ? `역분개 ${slip}` : '대기 풀림'}).`)
}
