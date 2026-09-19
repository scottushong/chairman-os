'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import type { ChairmanCheckin, ChairmanCondition } from '@/types'

/**
 * Phase 5 회장 체크인 저장 (/ai 상단 3칸 중 셋째 칸, 0019_chairman_checkins).
 *
 * 권한 판정은 여기서 하지 않는다 — chairman.ts와 같다. 로그인한 본인 세션으로 DB에 붙고
 * 0019의 chairman_checkins_all이 Chairman만 통과시킨다. 감사 기록은 어댑터가 쓰기 전에 남긴다.
 *
 * 숫자 칸은 비워 둘 수 있다. 체중을 안 잰 날과 0kg인 날은 다르므로 빈 값은 null로 보낸다 —
 * 0으로 채워 보내면 야간 브리핑이 '체중 0'을 읽는다.
 */

export interface SaveCheckinState {
  error?: string
  checkin?: ChairmanCheckin
}

/** 식사 메모는 한 줄 기록이다. 길어지면 그건 메모가 아니라 일지고, 브리핑 입력으로도 과하다. */
const MEAL_MAX = 500

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/**
 * 빈 칸은 null, 숫자면 소수 첫째 자리까지. 범위를 벗어나거나 숫자가 아니면 undefined로 돌려
 * 호출부가 '검증 실패'와 '기록 없음'을 구분하게 한다.
 * 상한은 DB 열 정의(numeric(3,1) / numeric(4,1))가 아니라 사람의 값 범위로 잡았다 —
 * 오타 한 번이 브리핑의 '수면 88시간'이 되는 것을 여기서 막는다.
 */
function optionalNumber(value: unknown, max: number): number | null | undefined {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value.trim() : value
  if (text === '') return null
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0 || n > max) return undefined
  return Math.round(n * 10) / 10
}

export async function saveCheckin(input: {
  checkinDate: unknown
  condition: unknown
  sleepHours: unknown
  weightKg: unknown
  mealNote: unknown
}): Promise<SaveCheckinState> {
  const checkin_date = typeof input.checkinDate === 'string' ? input.checkinDate.trim() : ''
  if (!isDate(checkin_date)) return { error: '날짜를 확인하세요.' }

  const condition = Number(input.condition)
  // 1~5는 DB에서도 막는다(0019 chairman_checkins_condition). 여기서도 같은 조건을 쓴다.
  if (!Number.isInteger(condition) || condition < 1 || condition > 5) {
    return { error: '컨디션을 1~5 중에서 고르세요.' }
  }

  const sleep_hours = optionalNumber(input.sleepHours, 24)
  if (sleep_hours === undefined) return { error: '수면 시간은 0~24 사이로 적으세요.' }

  const weight_kg = optionalNumber(input.weightKg, 300)
  if (weight_kg === undefined) return { error: '체중은 0~300 사이로 적으세요.' }

  const meal_note = typeof input.mealNote === 'string' ? input.mealNote.trim() : ''
  if (meal_note.length > MEAL_MAX) return { error: `식사 메모는 ${MEAL_MAX}자까지입니다.` }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const checkin = await repo.saveCheckin(
      {
        checkin_date,
        condition: condition as ChairmanCondition,
        sleep_hours,
        weight_kg,
        meal_note,
      },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath('/ai')
    return { checkin }
  } catch (e) {
    console.error('[saveCheckin]', e)
    const denied =
      e instanceof Error && /chairman_checkins|42501|PGRST301/.test(e.message)
    return {
      error: denied
        ? '체크인을 기록할 권한이 없습니다. (Chairman만 가능합니다)'
        : '저장하지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }
}
