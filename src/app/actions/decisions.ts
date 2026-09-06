'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { isDecisionAction, type DecisionAction } from '@/lib/decision-log'
import { getRepository } from '@/lib/repository'

/**
 * CH-016 결정 처리(승인/거절/수정요청/위임).
 *
 * Server Action이라 브라우저는 '무엇을 눌렀다'만 보내고, 기록은 서버가 남긴다.
 * 예전에는 이 기록이 브라우저 localStorage에 있었다 — CH-051이 '삭제 불가'를 요구하는
 * 자료를 사용자가 언제든 지울 수 있는 곳에 둔 셈이라 그 경로를 없앴다(DEFERRED D-05).
 *
 * 권한 판정은 여기서 하지 않는다. 로그인한 본인의 세션으로 DB에 붙고,
 * 승인권이 없으면 0002의 decisions_decide 정책이 거부한다 —
 * 판정을 애플리케이션으로 옮기면 우회 경로가 하나 더 생긴다.
 */

export interface DecisionActionState {
  error?: string
}

export async function decide(
  decisionId: string,
  businessId: string,
  action: string,
): Promise<DecisionActionState> {
  if (!isDecisionAction(action)) return { error: '알 수 없는 처리 방식입니다.' }

  // 세션이 없으면 애초에 이 화면을 못 연다(proxy). 여기 걸리면 세션이 중간에 끊긴 것이다.
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.recordDecisionAction({
      decision_id: decisionId,
      action: action as DecisionAction,
      actor_user_id: user.user_id,
      actor_role: user.role,
      business_id: businessId,
    })
  } catch (e) {
    // 어댑터가 만든 문장에는 RLS 정책 이름 같은 실마리가 들어 있다. 서버 로그에는 그대로 남긴다.
    console.error('[decide]', e)
    return {
      error:
        e instanceof Error && /decisions_decide|42501|PGRST301/.test(e.message)
          ? '이 결정을 처리할 권한이 없습니다.'
          : '처리에 실패했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  // 목록에서 빠지고 '오늘 처리' 카운터가 오르는 건 서버가 다시 그려야 보인다.
  revalidatePath('/')
  return {}
}
