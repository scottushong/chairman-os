'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { isStrategyField } from '@/lib/strategy-fields'

/**
 * CH-024 전략 좌표 편집 (DEFERRED D-13 결정 A).
 *
 * 한 번에 한 칸이다. 열한 칸을 통째로 보내지 않는 이유가 두 가지 있다.
 *   1) audit_log의 before/after가 '무엇이 바뀌었나'만 담는다. 행 전체를 남기면
 *      읽는 사람이 열한 칸을 눈으로 비교해야 한다.
 *   2) Bottleneck 한 줄을 고치려고 폼 전체를 여는 건 DEFERRED D-13의 선택지 B다.
 *      매달 바뀌는 값이라 그 마찰이 그대로 '안 고침'이 된다.
 *
 * 권한 판정은 여기서 하지 않는다. 로그인한 본인의 세션으로 DB에 붙고,
 * 0008의 business_strategy_write가 can_approve()로 Chairman·BusinessCEO만 통과시킨다.
 * 화면이 승인권자에게만 연필을 보여 주는 건 안내지 판정이 아니다.
 */

export interface SaveStrategyState {
  error?: string
}

/** 0008의 열한 칸은 전부 not null이라 어떤 값도 문자열이어야 한다. 길이는 화면과 같은 한계를 쓴다. */
const MAX_LENGTH = 500

export async function saveStrategyField(
  businessId: unknown,
  field: unknown,
  value: unknown,
): Promise<SaveStrategyState> {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  if (!id) return { error: '어느 회사의 좌표인지 알 수 없습니다.' }

  // 화면이 뭘 보내든 0008에 없는 칸 이름은 DB로 못 간다.
  if (!isStrategyField(field)) return { error: '알 수 없는 항목입니다.' }

  // trim만 하고 빈 문자열은 통과시킨다. '지운다'가 이 화면에서 유효한 동작이다 —
  // 해소된 Bottleneck은 틀린 문장으로 남아 있는 것보다 비어 있는 편이 낫다.
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > MAX_LENGTH) {
    return { error: `${MAX_LENGTH}자를 넘길 수 없습니다. (현재 ${text.length}자)` }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.updateBusinessStrategy(
      id,
      { [field]: text },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[saveStrategyField]', e)
    return {
      error:
        e instanceof Error && /business_strategy_write|42501|PGRST301/.test(e.message)
          ? '전략 좌표를 고칠 권한이 없습니다. (Chairman / Business CEO만 가능합니다)'
          : '저장하지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  // 이 값을 그리는 화면은 회사 상세 하나다. 대시보드 4카드(CH-011~014)는 다른 표를 본다.
  revalidatePath(`/business/${id}`)
  return {}
}
