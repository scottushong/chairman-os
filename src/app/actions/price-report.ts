'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { canReadPriceReport, canRequestPriceReport, manualPerDay } from '@/lib/price-report/rules'
import { pollPriceReport, requestPriceReport, type PollResult } from '@/lib/price-report/request'
import { getRepository } from '@/lib/repository'

/** 0084 가격 리포트 서버 액션 — 판정은 DB(price_report_request · 표 RLS). 여기는 안내 문과 GitHub 호출뿐. */

const BIZ = /^[a-z0-9_]{2,40}$/
const UUID = /^[0-9a-f-]{36}$/i
const OFF = '지금은 쓸 수 없는 기능입니다.'

export async function requestPriceReportUpdate(businessId: unknown): Promise<{ runId?: string; error?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const biz = typeof businessId === 'string' ? businessId.trim() : ''
  if (!BIZ.test(biz)) return { error: '회사를 알 수 없습니다.' }
  if (!(await featureOn(user, 'purchase_price_report', biz))) return { error: OFF }
  if (!canRequestPriceReport(user, biz)) return { error: '이 회사의 가격 리포트를 업데이트할 권한이 없습니다(구매 입력 · 대표).' }
  const out = await requestPriceReport(await getRepository(), biz, manualPerDay())
  revalidatePath(`/purchasing/${biz}/price-report`)
  return out
}

export async function pollPriceReportUpdate(businessId: unknown, runId: unknown): Promise<PollResult & { error: string | null }> {
  const empty = { status: 'unknown' as const, error: null, reportId: null, newEvents: null, points: null }
  const user = await currentUser()
  const biz = typeof businessId === 'string' ? businessId.trim() : ''
  const id = typeof runId === 'string' ? runId.trim() : ''
  if (!user || !BIZ.test(biz) || !UUID.test(id) || !canReadPriceReport(user, biz)) return empty
  if (!(await featureOn(user, 'purchase_price_report', biz))) return empty
  return pollPriceReport(await getRepository(), biz, id)
}
