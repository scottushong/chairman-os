'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { CHAIRMAN_PROJECT_STATUS, type ChairmanProject, type ChairmanProjectStatus } from '@/types'

/**
 * Phase 3-B 회장 루틴 저장 (/settings/chairman).
 *
 * 권한 판정은 여기서 하지 않는다. 로그인한 본인 세션으로 DB에 붙고 0014의 RLS가
 * Chairman만 통과시킨다. 감사 기록은 어댑터가 남긴다(supabase.ts saveChairman*).
 */

export interface SaveChairmanState {
  error?: string
  project?: ChairmanProject
}

const TITLE_MAX = 200
const TEXT_MAX = 2000
/** 선언문은 길다. 그래도 끝은 있어야 한다 — 실수로 붙여 넣은 문서 전체가 브리핑 입력으로 가는 걸 막는다. */
const MANIFESTO_MAX = 50_000

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function permissionError(e: unknown, fallback: string): string {
  return e instanceof Error && /chairman_|42501|PGRST301/.test(e.message)
    ? '회장 루틴을 고칠 권한이 없습니다. (Chairman만 가능합니다)'
    : fallback
}

export async function saveChairmanProject(input: {
  projectId?: unknown
  title: unknown
  startDate: unknown
  targetDate: unknown
  note: unknown
  thisMonthAction: unknown
  status: unknown
}): Promise<SaveChairmanState> {
  const title = text(input.title)
  const start_date = text(input.startDate)
  const target_date = text(input.targetDate)
  const note = text(input.note)
  const this_month_action = text(input.thisMonthAction)
  const projectId = text(input.projectId)

  if (!title) return { error: '제목을 입력하세요.' }
  if (title.length > TITLE_MAX) return { error: `제목은 ${TITLE_MAX}자까지입니다.` }
  if (!isDate(start_date) || !isDate(target_date)) return { error: '시작일과 목표일을 확인하세요.' }
  if (target_date <= start_date) return { error: '목표일은 시작일보다 뒤여야 합니다.' }
  if (note.length > TEXT_MAX || this_month_action.length > TEXT_MAX) {
    return { error: `메모와 이번 달 액션은 각각 ${TEXT_MAX}자까지입니다.` }
  }
  if (!CHAIRMAN_PROJECT_STATUS.includes(input.status as ChairmanProjectStatus)) {
    return { error: '알 수 없는 상태입니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const project = await repo.saveChairmanProject(
      {
        ...(projectId ? { project_id: projectId } : {}),
        title,
        start_date,
        target_date,
        note,
        this_month_action,
        status: input.status as ChairmanProjectStatus,
      },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath('/settings/chairman')
    revalidatePath('/ai')
    revalidatePath('/')
    return { project }
  } catch (e) {
    console.error('[saveChairmanProject]', e)
    return { error: permissionError(e, '저장하지 못했습니다. 잠시 후 다시 시도하세요.') }
  }
}

export async function saveChairmanManifesto(body: unknown): Promise<SaveChairmanState> {
  // 앞뒤 공백만 걷는다. 안쪽 줄바꿈·빈 줄은 문단이라 그대로 둔다. CRLF는 LF로 맞춘다.
  const value = typeof body === 'string' ? body.replace(/\r\n?/g, '\n').trim() : ''
  if (value.length > MANIFESTO_MAX) {
    return { error: `${MANIFESTO_MAX.toLocaleString()}자를 넘길 수 없습니다. (현재 ${value.length.toLocaleString()}자)` }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.saveChairmanManifesto(value, { user_id: user.user_id, role: user.role })
  } catch (e) {
    console.error('[saveChairmanManifesto]', e)
    return { error: permissionError(e, '저장하지 못했습니다. 잠시 후 다시 시도하세요.') }
  }

  revalidatePath('/settings/chairman')
  revalidatePath('/ai')
  return {}
}
