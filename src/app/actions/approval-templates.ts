'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import {
  APPROVAL_TEMPLATE_KEY,
  TEMPLATE_FIELD_TYPES,
  type ApprovalTemplateKey,
  type TemplateField,
  type TemplateFieldType,
} from '@/types'

/**
 * /settings/approvals — 결재 양식의 항목과 «대표까지 올라가는» 규칙을 고친다 (2026-10-06 첫 직원 피드백).
 *
 * 규칙은 원래부터 DB 표(0038 approval_templates)에 있었고 회장만 고칠 수 있었다 — 고칠 화면이 없었을 뿐이다.
 * 판정(회장인가)은 DB(approval_templates_write)가 한 번 더 한다. 여기서 먼저 막는 이유는 감사 기록이 update보다
 * 먼저 들어가서다 — 거부될 사람의 기록을 남기지 않는다.
 *
 * 금액 규칙이 보는 칸의 key는 'amount'로 고정이다(0038 트리거). 그래서 기준 금액을 두려면 금액 칸이 있어야 한다.
 */

export interface ApprovalTemplateState {
  error?: string
  saved?: boolean
}

const KEY = /^[a-z][a-z0-9_]{0,30}$/

export async function saveApprovalTemplate(input: {
  templateKey: unknown
  fields: unknown
  chairmanAlways: unknown
  chairmanOver: unknown
}): Promise<ApprovalTemplateState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (user.role !== 'Chairman') return { error: '결재 양식은 회장만 고칠 수 있습니다.' }

  const key = (typeof input.templateKey === 'string' ? input.templateKey : '') as ApprovalTemplateKey
  if (!APPROVAL_TEMPLATE_KEY.includes(key)) return { error: '알 수 없는 양식입니다.' }
  if (typeof input.chairmanAlways !== 'boolean') return { error: '«항상 회장 결재» 값을 읽을 수 없습니다.' }

  let chairmanOver: number | null = null
  if (input.chairmanOver !== null && input.chairmanOver !== '' && input.chairmanOver !== undefined) {
    const n = Number(String(input.chairmanOver).replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(n) || n < 0) return { error: '기준 금액은 0 이상의 숫자로 넣으세요.' }
    chairmanOver = n
  }

  if (!Array.isArray(input.fields) || input.fields.length === 0) return { error: '항목이 하나 이상 있어야 합니다.' }
  if (input.fields.length > 20) return { error: '항목은 20개까지입니다.' }
  const fields: TemplateField[] = []
  const used = new Set<string>()
  for (const raw of input.fields as Record<string, unknown>[]) {
    const label = typeof raw?.label_ko === 'string' ? raw.label_ko.trim() : ''
    if (!label) return { error: '이름이 빈 항목이 있습니다.' }
    if (label.length > 30) return { error: `«${label.slice(0, 10)}…» 이름이 너무 깁니다(30자).` }
    const type = raw.type as TemplateFieldType
    if (!TEMPLATE_FIELD_TYPES.includes(type)) return { error: `«${label}»의 종류를 고르세요.` }
    // 새 항목은 key가 없다 — 겹치지 않는 'f_<n>'을 준다. 이미 있는 항목의 key는 그대로 둔다(옛 결재의 값이 그 key에 있다).
    let k = typeof raw.key === 'string' ? raw.key.trim() : ''
    if (k && !KEY.test(k)) return { error: `«${label}»의 내부 이름이 잘못됐습니다.` }
    if (!k) {
      let i = 1
      while (used.has(`f_${i}`) || (input.fields as Record<string, unknown>[]).some((f) => f?.key === `f_${i}`)) i++
      k = `f_${i}`
    }
    if (used.has(k)) return { error: `«${label}» 항목이 두 번 들어 있습니다.` }
    if (k === 'amount' && type !== 'money') return { error: '금액 칸(amount)은 종류가 «금액»이어야 합니다.' }
    used.add(k)
    const labelEn = typeof raw.label_en === 'string' && raw.label_en.trim() ? raw.label_en.trim() : label
    fields.push({ key: k, label_ko: label, label_en: labelEn, type, required: raw.required === true })
  }
  if (chairmanOver !== null && !fields.some((f) => f.key === 'amount')) {
    return { error: '기준 금액을 두려면 금액 칸이 있어야 합니다. 금액 칸을 지웠다면 기준 금액도 비우세요.' }
  }

  try {
    const repo = await getRepository()
    await repo.updateApprovalTemplate(
      key,
      { fields, chairman_always: input.chairmanAlways, chairman_over: chairmanOver },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[saveApprovalTemplate]', e)
    const message = e instanceof Error ? e.message : ''
    if (/42501|row-level security|affected 0 rows/.test(message)) return { error: '결재 양식은 회장만 고칠 수 있습니다.' }
    return { error: '양식을 저장하지 못했습니다.' }
  }

  revalidatePath('/settings/approvals')
  revalidatePath('/approvals/new')
  revalidatePath('/me')
  return { saved: true }
}
