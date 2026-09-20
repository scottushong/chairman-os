'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { EMBED_PROBLEM_KO, embedProblem } from '@/lib/process-chart'
import { getRepository } from '@/lib/repository'

/**
 * 프로세스차트 등록·수정·삭제 (Phase 5-D, 0021).
 *
 * 링크 검증을 **여기서도** 한다. 0021의 check 제약이 마지막 문이지만, DB가 거부하면
 * 'violates check constraint'라는 말이 돌아올 뿐이라 회장이 무엇을 고쳐야 하는지 모른다.
 * 여기서 먼저 보고 사람 말로 알려 준다 — 특히 **편집 링크**는 따로 집어내 안내가 다르다.
 */

export interface ProcessChartState {
  error?: string
  id?: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function saveProcessChart(input: {
  id?: unknown
  businessId: unknown
  teamName: unknown
  title: unknown
  embedUrl: unknown
  sortOrder?: unknown
}): Promise<ProcessChartState> {
  const business_id = text(input.businessId)
  const team_name = text(input.teamName)
  const title = text(input.title)
  const embed_url = text(input.embedUrl)

  if (!business_id) return { error: '회사를 고르세요.' }
  if (!team_name) return { error: '팀 이름을 넣으세요.' }
  if (!title) return { error: '제목을 넣으세요.' }

  const problem = embedProblem(embed_url)
  if (problem) return { error: EMBED_PROBLEM_KO[problem] }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  const rawId = Number(input.id)
  const rawOrder = Number(input.sortOrder)

  try {
    const repo = await getRepository()
    const id = await repo.saveProcessChart(
      {
        id: Number.isFinite(rawId) && rawId > 0 ? rawId : undefined,
        business_id,
        team_name,
        title,
        embed_url,
        sort_order: Number.isFinite(rawOrder) ? rawOrder : 0,
      },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath('/settings/process-charts')
    revalidatePath('/')
    revalidatePath(`/process/${id}`)
    return { id }
  } catch (e) {
    console.error('[saveProcessChart]', e)
    const message = e instanceof Error ? e.message : ''
    if (/invalid_embed_url|check constraint|embed_url/.test(message)) {
      return { error: EMBED_PROBLEM_KO.not_published }
    }
    if (/duplicate key|unique/.test(message)) {
      return { error: '이 회사에 같은 팀 이름이 이미 있습니다.' }
    }
    if (/42501|PGRST301|row-level security/.test(message)) {
      return { error: '프로세스차트를 고칠 권한이 없습니다. (Chairman · Group CFO)' }
    }
    return { error: '프로세스차트를 저장하지 못했습니다.' }
  }
}

export async function deleteProcessChart(id: unknown): Promise<ProcessChartState> {
  const chartId = Number(id)
  if (!Number.isFinite(chartId)) return { error: '지울 대상을 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    // 링크만 지운다. 시트는 구글에 그대로 남으므로 되돌릴 수 있다 —
    // 그래서 이 삭제에는 되돌릴 수 없는 삭제에 붙는 확인 절차를 두지 않는다.
    await repo.deleteProcessChart(chartId, { user_id: user.user_id, role: user.role })
    revalidatePath('/settings/process-charts')
    revalidatePath('/')
    return {}
  } catch (e) {
    console.error('[deleteProcessChart]', e)
    return { error: '프로세스차트를 지우지 못했습니다.' }
  }
}
