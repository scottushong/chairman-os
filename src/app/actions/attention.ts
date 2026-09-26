'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { EXCEPTION_TRIAGE, RULE_KIND, type ExceptionTriage } from '@/types'

/**
 * 주의(ATTENTION) 쓰기 — Phase 7 블록 B-3. §18의 회장 액션 셋과 규칙 편집.
 *
 * ■ **권한을 여기서 판정하지 않는다** ■ 로그인한 본인 세션으로 DB에 붙고 0035의 RLS가
 * 판정한다 — 예외 처리는 `exceptions_triage`(= `can_approve() and has_business()`),
 * 규칙 편집은 `exception_rules_write`(Chairman). 여기서 역할을 한 번 더 보면 판정하는 자리가
 * 두 곳으로 갈라지고, 둘이 어긋나는 날 어느 쪽이 맞는지 알 수 없다(HANDOVER §2 ①).
 * 대신 거부당했을 때 사람이 읽을 수 있는 문장으로 바꿔 준다(`permissionError`).
 *
 * ■ 감사 기록은 어댑터가 남긴다 — **기록이 먼저다**(HANDOVER §2 ③) ■
 * 그래서 «기록은 남고 상태는 안 바뀜»이 가능하고 그쪽을 일부러 택했다. 어댑터가 그 상태를
 * 문장으로 돌려주므로 화면은 «저장됐다»고 말하지 않는다.
 *
 * ■ 여기서 하는 검사는 **입력의 모양**뿐이다 ■ «이 사람이 해도 되나»가 아니라 «이 글자가
 * 계약의 값인가»다. URL과 폼은 사람이 손으로 고칠 수 있는 입력이고, 모르는 값을 그대로
 * 보내면 0035의 check 제약이 23514로 거절한다 — 그 거절은 옳지만 회장에게는 읽을 수 없는 말이다.
 */

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function permissionError(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : String(e)
  if (/42501|PGRST301|exceptions_triage|can_approve|affected 0 rows|권한이 없습니다/.test(message)) {
    return '이 예외를 처리할 권한이 없습니다. (회장 · 그 회사의 대표만 가능합니다)'
  }
  if (/exception_rules_write|규칙은 회장만/.test(message)) {
    return '규칙은 회장만 고칠 수 있습니다.'
  }
  return `${fallback} (${message})`
}

/**
 * 감사 기록에 남을 행위자. 세션이 없으면 아무것도 못 한다 — 익명이 예외를 닫는 경로는
 * 만들지 않는다(RLS도 막지만 여기서 먼저 멈춘다).
 */
async function actor() {
  const user = await currentUser()
  if (!user) return null
  return { user_id: user.user_id, role: user.role }
}

export interface AttentionActionState {
  error?: string
  ok?: boolean
}

/**
 * §18 회장 액션 — 승인 · 관찰 14일 · CEO에게 위임.
 *
 * `monitor_until`을 화면이 보내지 않는다 — 어댑터가 `action`에서 낸다. 그래야 «관찰인데
 * 기한이 없는» 입력이 이 경로에 존재할 수 없고, 0035의 check 제약이 막는 그 상태를
 * **앱에서도 만들 수 없다.**
 */
export async function triageException(input: {
  exceptionId: unknown
  businessId: unknown
  action: unknown
  note?: unknown
}): Promise<AttentionActionState> {
  const exception_id = Number(text(input.exceptionId))
  const business_id = text(input.businessId)
  const action = text(input.action)
  if (!Number.isInteger(exception_id) || exception_id <= 0) {
    return { error: '어느 예외인지 알 수 없습니다.' }
  }
  if (!business_id) return { error: '어느 회사의 예외인지 알 수 없습니다.' }
  if (!(EXCEPTION_TRIAGE as readonly string[]).includes(action)) {
    return { error: '회장 액션은 승인 · 관찰 · 위임 중 하나입니다.' }
  }

  const who = await actor()
  if (!who) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.triageException(
      {
        exception_id,
        business_id,
        action: action as ExceptionTriage,
        note: text(input.note) || null,
      },
      who,
    )
  } catch (e) {
    return { error: permissionError(e, '예외를 처리하지 못했습니다.') }
  }
  // 대시보드 카드와 목록이 같은 사실을 그리므로 둘 다 다시 읽는다.
  revalidatePath('/')
  revalidatePath('/attention')
  return { ok: true }
}

/**
 * §18 규칙 한 줄의 회장 편집. **보낸 칸만 바꾼다.**
 *
 * `manual` 규칙에는 임계도 창도 **없다.** 화면이 그 칸을 그리지 않고 여기서도 받지 않는다 —
 * 받아서 0으로 채우면 «임계 0»이라는 없는 규칙이 생기고, 0035의 `kind_shape_check`가
 * 그것을 거절한다. 그 거절이 옳으므로 애초에 보내지 않는다.
 *
 * **임계에 범위를 걸지 않는다.** 0035가 일부러 걸지 않았고(걸면 회장의 편집을 스키마가
 * 막는다), 여기서 새 범위를 만들면 그 판정이 앱에만 있는 두 번째 규칙이 된다. 다만
 * **임계 0은 뜻을 잃는다** — `financialImpactAxis()`가 «임계를 얼마나 넘어섰나»의 비율을
 * 세울 수 없어 그 규칙의 예외는 그 뒤로 등급을 못 받는다(score.ts). 막지 않고 **화면이
 * 경고로 적는다**(/attention/rules).
 */
export async function saveExceptionRule(input: {
  ruleKey: unknown
  kind: unknown
  enabled?: unknown
  threshold?: unknown
  windowDays?: unknown
}): Promise<AttentionActionState> {
  const rule_key = text(input.ruleKey)
  const kind = text(input.kind)
  if (!rule_key) return { error: '어느 규칙인지 알 수 없습니다.' }
  if (!(RULE_KIND as readonly string[]).includes(kind)) {
    return { error: '규칙의 종류를 알 수 없습니다.' }
  }

  const patch: { rule_key: string; enabled?: boolean; threshold?: number; window_days?: number | null } =
    { rule_key }
  if (input.enabled !== undefined) patch.enabled = input.enabled === true || input.enabled === 'on'

  if (kind === 'metric') {
    if (input.threshold !== undefined) {
      const threshold = Number(text(input.threshold))
      if (!Number.isFinite(threshold)) return { error: '임계값은 숫자로 적습니다.' }
      patch.threshold = threshold
    }
    if (input.windowDays !== undefined) {
      const raw = text(input.windowDays)
      if (raw === '') {
        // 빈 칸은 «창이 없다»다(0035는 수치 규칙에 창을 요구하지 않는다). 0이 아니다.
        patch.window_days = null
      } else {
        const days = Number(raw)
        // 0035의 `window_check`가 «null이거나 0보다 크다»를 요구한다. 그 제약의 글자다.
        if (!Number.isInteger(days) || days <= 0) return { error: '창은 1일 이상의 정수입니다.' }
        patch.window_days = days
      }
    }
  }

  if (Object.keys(patch).length === 1) return { error: '바꾼 것이 없습니다.' }

  const who = await actor()
  if (!who) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.saveExceptionRule(patch, who)
  } catch (e) {
    return { error: permissionError(e, '규칙을 저장하지 못했습니다.') }
  }
  revalidatePath('/attention/rules')
  // 임계가 바뀌면 «재지 못한 회사»의 판정도 바뀐다 — 그 줄을 그리는 두 화면도 다시 읽는다.
  revalidatePath('/attention')
  revalidatePath('/')
  return { ok: true }
}
