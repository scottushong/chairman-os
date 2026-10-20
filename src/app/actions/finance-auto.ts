'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'

import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { processRecalc } from '@/lib/finance-overview/recalc'
import { getRepository } from '@/lib/repository'
import type { FinAutoAction, FinAutoRule } from '@/types'

/**
 * 0091 «자동으로 정한 것» 고치기 — 평가금액 고치기 · 귀속월 달 고치기 · 원래 날짜로 · 중복 되살리기 · 자동으로 돌리기.
 * 판단 단추 · 확인 단추가 아니다 — 시스템이 이미 정했고, 틀렸을 때만 사람이 고친다. 판정은 DB(fin_auto_fix — 장부 쓰기 · 스위치).
 * 원장 원본은 고치지 않는다. 고친 뒤 그 달부터 다시 계산(큐 + 응답 뒤 이 사람 세션).
 */

const BIZ = /^[a-z0-9_]{2,40}$/
const YM = /^\d{4}-(0[1-9]|1[0-2])$/
const PAIRS: Record<FinAutoRule, FinAutoAction[]> = { valuation: ['value', 'auto'], period: ['month', 'keep_date', 'auto'], duplicate: ['restore', 'auto'] }

export interface AutoFixInput {
  businessId: unknown
  rule: unknown
  key: unknown
  period: unknown
  action: unknown
  /** value: 금액 · month: 'YYYY-MM' */
  value?: unknown
  /** 고치기 전 화면 값(전값 기록 — 글 · 숫자만) */
  prev?: unknown
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function saveAutoFix(input: AutoFixInput): Promise<{ ok?: true; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const biz = text(input.businessId, 40)
  const rule = text(input.rule, 20) as FinAutoRule
  const action = text(input.action, 20) as FinAutoAction
  const key = text(input.key, 200)
  const period = text(input.period, 7)
  if (!BIZ.test(biz) || !PAIRS[rule]?.includes(action) || key.length < 3 || !YM.test(period)) return { error: '고칠 자리를 알 수 없습니다.' }
  if (!(await featureOn(user, 'finance_auto', biz))) return { error: '지금은 쓸 수 없는 기능입니다.' }
  if (!canKeepBooks(user, biz)) return { error: '이 회사의 재무를 넣을 권한이 없습니다.' }
  let value: { amount?: number; to?: string } | null = null
  if (action === 'value') {
    const n = Number(String(input.value ?? '').replace(/[,\s원]/g, ''))
    if (!Number.isFinite(n) || n < 0 || n >= 1e12) return { error: '금액(0 이상 숫자)을 적어 주세요.' }
    value = { amount: Math.round(n) }
  } else if (action === 'month') {
    const to = text(input.value, 7)
    if (!YM.test(to)) return { error: '달(YYYY-MM)을 골라 주세요.' }
    value = { to }
  }
  const prev =
    input.prev && typeof input.prev === 'object'
      ? Object.fromEntries(
          Object.entries(input.prev as Record<string, unknown>)
            .slice(0, 6)
            .map(([k, v]) => [k.slice(0, 20), typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? v.slice(0, 80) : null]),
        )
      : null
  try {
    const repo = await getRepository()
    await repo.saveFinAutoFix({ business_id: biz, rule, item_key: key, period, action, value, prev })
    try {
      after(async () => {
        await processRecalc(repo, { businessId: biz, limit: 1 }).catch((e) => console.error('[finance-auto] recalc', e))
      })
    } catch {
      // after 밖(검사 스크립트) — 큐에는 이미 들어 있다.
    }
    revalidatePath('/finance')
    return { ok: true }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (/fin_auto_denied/.test(m)) return { error: '이 회사의 재무를 넣을 권한이 없습니다.' }
    if (/fin_auto_off/.test(m)) return { error: '지금은 쓸 수 없는 기능입니다.' }
    if (/fin_auto_shape/.test(m)) return { error: '고칠 값의 모양이 맞지 않습니다.' }
    if (/fin_upload_unavailable/.test(m)) return { error: '이 기능의 DB가 아직 준비되지 않았습니다(0091 반영 전).' }
    console.error('[saveAutoFix]', e)
    return { error: '고치지 못했습니다.' }
  }
}
