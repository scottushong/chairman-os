'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { BLUEPRINT_OFF, blueprintErrorKey } from '@/lib/blueprint/format'
import { costEngineError } from '@/lib/costs/errors'
import { getRepository } from '@/lib/repository'

/**
 * 0081 청사진 뼈대 Server Action — Forecast 설정 · 시장 전망 · 경쟁사 가정 · 작업지시.
 * 권한의 문은 DB다(0081 RPC 첫 줄 feature_on · cost_can · 대표만). 여기서는 입력의 모양을 거르고 DB의 거부를 사람의 말로 바꾼다.
 * 폼은 components/blueprint/action-form.tsx(useActionState) — 결과 문장은 폼 아래, 값은 다시 그린 화면이 보여 준다.
 */

export interface BlueprintState {
  error?: string
  ok?: boolean
}

const BIZ = /^[a-z0-9_]{1,60}$/
const EXPIRED = { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

const str = (v: FormDataEntryValue | null, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function num(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function why(e: unknown, chairman: boolean): string {
  const k = blueprintErrorKey(e)
  if (k === 'off') return BLUEPRINT_OFF
  if (k === 'unavailable') return '이 기능은 준비 중입니다.'
  return costEngineError(e, chairman, '저장하지 못했습니다. 칸을 확인하고 다시 시도하세요.')
}

/** ① Forecast 설정 — 대표만(DB cost_forecast_setting_set). fx_manual은 «USD=1380, EUR=1500» 한 줄. */
export async function forecastSettingAction(_prev: BlueprintState, form: FormData): Promise<BlueprintState> {
  const businessId = str(form.get('businessId'), 60)
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const blend = num(form.get('blend'))
  if (blend === null || blend < 0 || blend > 100) return { error: '구매가 비중은 0~100(%)으로 적으세요.' }
  const mode = str(form.get('fxMode'), 10) === 'manual' ? 'manual' : 'today'
  const manual: Record<string, number> = {}
  for (const part of str(form.get('fxManual'), 300).split(/[,\n]/)) {
    const m = /^\s*([A-Za-z]{3})\s*=\s*([\d.,]+)\s*$/.exec(part)
    if (!part.trim()) continue
    if (!m) return { error: '수동 환율은 «USD=1380, EUR=1500»처럼 적으세요.' }
    const v = Number(m[2].replace(/,/g, ''))
    if (!(v > 0 && v <= 1e6)) return { error: '수동 환율 값을 확인하세요.' }
    manual[m[1].toUpperCase()] = v
  }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    await (await getRepository()).setCostForecastSetting(businessId, blend, mode, manual)
    revalidatePath(`/costs/${businessId}`)
    return { ok: true }
  } catch (e) {
    console.error('[blueprint] forecast setting', e instanceof Error ? e.message : String(e))
    return { error: why(e, user.role === 'Chairman') }
  }
}

/** ① 다음 달 시장 전망 — 구매(쓰기) · 대표(DB cost_outlook_set). */
export async function outlookAction(_prev: BlueprintState, form: FormData): Promise<BlueprintState> {
  const businessId = str(form.get('businessId'), 60)
  const materialId = str(form.get('materialId'), 80)
  const month = str(form.get('month'), 7)
  const price = num(form.get('price'))
  const currency = str(form.get('currency'), 3).toUpperCase() || 'KRW'
  const fx = num(form.get('fx'))
  if (!BIZ.test(businessId) || !materialId) return { error: '원료를 고르세요.' }
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: '달을 고르세요.' }
  if (price === null || price <= 0 || price > 1e9) return { error: '전망 가격(kg당)을 0보다 크게 적으세요.' }
  if (!/^[A-Z]{3}$/.test(currency)) return { error: '통화는 KRW · USD처럼 세 글자로 적으세요.' }
  if (fx !== null && !(fx > 0 && fx <= 1e6)) return { error: '환율을 확인하세요.' }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    await (await getRepository()).setCostOutlook({ material_id: materialId, month: `${month}-01`, price, currency, fx_rate: currency === 'KRW' ? null : fx, note: str(form.get('note'), 300) })
    revalidatePath(`/purchasing/${businessId}/market`)
    return { ok: true }
  } catch (e) {
    console.error('[blueprint] outlook', e instanceof Error ? e.message : String(e))
    return { error: why(e, user.role === 'Chairman') }
  }
}

/** ⑤ 경쟁사 가정 — 원가 관리(쓰기) · 대표(DB competitor_assumption_set). 빈 칸 = 우리 값. */
export async function competitorAssumptionAction(_prev: BlueprintState, form: FormData): Promise<BlueprintState> {
  const businessId = str(form.get('businessId'), 60)
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const productRaw = str(form.get('productId'), 70)
  const productId = productRaw && productRaw !== '*' ? productRaw : null
  const mfg = num(form.get('mfg'))
  const logi = num(form.get('logi'))
  const margin = num(form.get('margin'))
  if ((mfg !== null && (mfg < 0 || mfg > 1e9)) || (logi !== null && (logi < 0 || logi > 1e9))) return { error: '제조 · 물류는 0 이상 원/kg로 적으세요(비우면 우리 값).' }
  if (margin !== null && (margin < 0 || margin > 60)) return { error: '경쟁사 마진은 0~60%로 적으세요(비우면 15%).' }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    await (await getRepository()).setCompetitorAssumption(businessId, { product_id: productId, mfg_krw_per_kg: mfg, logi_krw_per_kg: logi, margin_pct: margin, note: str(form.get('note'), 300) })
    revalidatePath(`/costs/${businessId}/competitor`)
    return { ok: true }
  } catch (e) {
    console.error('[blueprint] competitor', e instanceof Error ? e.message : String(e))
    return { error: why(e, user.role === 'Chairman') }
  }
}

/** ⑥ 작업지시 탱크 · 순서 · 담당 · 이름 가림 — 대표만(DB work_order_set). */
export async function workOrderAction(_prev: BlueprintState, form: FormData): Promise<BlueprintState> {
  const businessId = str(form.get('businessId'), 60)
  const orderId = str(form.get('orderId'), 80)
  if (!BIZ.test(businessId) || !orderId) return { error: '어느 작업지시인지 알 수 없습니다.' }
  const tank = str(form.get('tank'), 40) || null
  const seq = num(form.get('seq'))
  if (seq !== null && !(Number.isInteger(seq) && seq >= 0 && seq <= 1_000_000)) return { error: '순서는 0 이상 정수로 적으세요.' }
  const assignee = str(form.get('assignee'), 40) || null
  if (assignee && !/^[0-9a-f-]{36}$/i.test(assignee)) return { error: '담당자를 다시 고르세요.' }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    await (await getRepository()).setWorkOrder({ order_id: orderId, tank, seq, assignee, hide_names: form.get('hideNames') === 'on' })
    revalidatePath(`/production/${businessId}/orders/${orderId}`)
    revalidatePath(`/production/${businessId}`)
    return { ok: true }
  } catch (e) {
    console.error('[blueprint] work order', e instanceof Error ? e.message : String(e))
    return { error: why(e, user.role === 'Chairman') }
  }
}
