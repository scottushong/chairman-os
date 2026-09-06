'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository, type TaskPatch } from '@/lib/repository'
import { TASK_STATUS, type TaskStatus } from '@/types'

/**
 * CH-040 업무 상태 변경 / 회장확인 토글.
 *
 * 권한 판정은 여기서 하지 않는다. 로그인한 본인의 세션으로 DB에 붙고,
 * 담당자도 승인권자도 아니면 0002의 tasks_write 정책이 거부한다.
 */

export interface TaskActionState {
  error?: string
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUS.includes(value as TaskStatus)
}

async function apply(taskId: unknown, patch: TaskPatch): Promise<TaskActionState> {
  if (typeof taskId !== 'string' || !taskId) return { error: '잘못된 요청입니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.updateTask(taskId, patch, { user_id: user.user_id, role: user.role })
  } catch (e) {
    console.error('[tasks]', e)
    return {
      error:
        e instanceof Error && /tasks_write|42501|PGRST301/.test(e.message)
          ? '이 업무를 바꿀 권한이 없습니다.'
          : '변경하지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  // 상태 탭의 개수와 대시보드 Waiting on Me가 같이 움직인다. 둘 다 서버가 다시 그려야 보인다.
  revalidatePath('/tasks')
  revalidatePath('/')
  return {}
}

export async function setTaskStatus(taskId: unknown, status: unknown): Promise<TaskActionState> {
  if (!isTaskStatus(status)) return { error: '알 수 없는 상태입니다.' }
  return apply(taskId, { status })
}

export async function setChairmanNeeded(
  taskId: unknown,
  needed: unknown,
): Promise<TaskActionState> {
  if (typeof needed !== 'boolean') return { error: '잘못된 요청입니다.' }
  return apply(taskId, { chairman_needed: needed })
}
