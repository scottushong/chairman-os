'use server'

import { redirect } from 'next/navigation'

import { canWriteCosts } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { candidateError } from '@/lib/costs/candidates'
import { featureOn } from '@/lib/features-server'
import { getRepository } from '@/lib/repository'
import type { CandidateAction, CandidateSource } from '@/types'

/**
 * 0078 «원가 후보 승인» 서버 액션. 판정은 DB(cost_fin_candidate_decide — 스위치 · 대표 · 원가 관리 쓰기 · 원래 입력 문)이고,
 * 여기서도 같은 문을 먼저 본다(화면만 막지 않는다): 로그인 · 회사 모양 · 원가 관리 쓰기(대표) · 기능 스위치 'cost_candidates' · 이유 필수.
 * 결과는 화면 주소의 msg / err로 돌려준다(폼 하나 = 결정 하나).
 */

const BIZ = /^[a-z0-9_]{2,40}$/
const SOURCES: readonly CandidateSource[] = ['fin_purchase_in_lines', 'fin_import_lines', 'fin_sales_lines']
const ACTIONS: readonly CandidateAction[] = ['lot', 'ignore', 'later']
const text = (v: FormDataEntryValue | null, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const opt = (v: FormDataEntryValue | null) => text(v, 80) || null

export async function decideCostCandidate(businessId: string, form: FormData): Promise<void> {
  const back = (k: 'msg' | 'err', m: string) => redirect(`/costs/${encodeURIComponent(businessId)}/candidates?${k}=${encodeURIComponent(m)}`)
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!BIZ.test(businessId) || !canWriteCosts(user, businessId)) back('err', '찾을 수 없거나 권한이 없습니다.')
  if (!(await featureOn(user, 'cost_candidates', businessId))) back('err', '지금은 쓸 수 없는 기능입니다.')
  const source = text(form.get('source'), 40) as CandidateSource
  const action = text(form.get('action'), 10) as CandidateAction
  const line = Number(text(form.get('line'), 20))
  const reason = text(form.get('reason'))
  if (!SOURCES.includes(source) || !ACTIONS.includes(action) || !Number.isSafeInteger(line) || line <= 0) back('err', '후보를 다시 고르세요.')
  if (reason.length < 2) back('err', '이유를 2자 이상 적어 주세요.')
  const on = text(form.get('on'), 10)
  let result = ''
  try {
    result = await (await getRepository()).decideCostCandidate(businessId, {
      source, line_id: line, action, reason,
      material_id: opt(form.get('material')), supplier_id: opt(form.get('supplier')), on: /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null,
      lot_id: opt(form.get('lot')), product_id: opt(form.get('product')),
    })
  } catch (e) {
    back('err', candidateError(e, user.role === 'Chairman'))
  }
  back('msg', action === 'lot' ? `넣었습니다 (${result})` : action === 'ignore' ? '무시로 정했습니다.' : '나중에로 두었습니다.')
}
