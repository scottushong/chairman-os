'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { WORK_PRIORITY, type Decision, type WorkPriority } from '@/types'

/**
 * CH-041 결재 기안 (DEFERRED D-10 선택지 A).
 *
 * 0006이 decisions.attachment_url을 만들었지만 값을 넣는 화면이 없었다. 첨부는 결재를
 * '올릴 때' 거는 값이라 상세 패널이 아니라 여기에 붙는다 — 선택지 B(결재자가 나중에 붙인다)는
 * '결재 내용을 결재자가 고친다'가 되어 감사 기록의 뜻이 흐려진다.
 *
 * 파일은 받지 않는다. 사내 스토리지 링크 한 줄만이다(CLAUDE.md 데이터 원칙).
 * CH-042 문서 등록과 같은 규칙이라 이 프로젝트에는 파일 업로드 경로가 한 군데도 없다.
 *
 * 권한은 여기서 보지 않는다. 0002의 decisions_create가
 * has_business(business_id) and can_module('/chairman/decisions', true)를 본다.
 */

export interface DraftDecisionState {
  error?: string
  decision?: Decision
}

function isWorkPriority(value: unknown): value is WorkPriority {
  return WORK_PRIORITY.includes(value as WorkPriority)
}

/** documents.ts의 isStorageLink와 같은 규칙이다. 첨부의 뜻이 두 화면에서 달라지면 안 된다. */
function isStorageLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 0001의 decisions.deadline은 date다. 'YYYY-MM-DD'가 아닌 문자열은 보내지 않는다. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export async function draftDecision(input: {
  title: unknown
  businessId: unknown
  options: unknown
  impact: unknown
  deadline: unknown
  attachmentUrl: unknown
}): Promise<DraftDecisionState> {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const businessId = typeof input.businessId === 'string' ? input.businessId.trim() : ''
  const deadline = typeof input.deadline === 'string' ? input.deadline.trim() : ''
  const attachmentUrl =
    typeof input.attachmentUrl === 'string' ? input.attachmentUrl.trim() : ''

  /**
   * 화면은 여러 줄 상자 하나를 받고 줄마다 선택안 하나로 읽는다.
   * 02_데이터필드에서 options는 필수다 — 무엇을 고를지 없는 결재는 결재가 아니라 보고다.
   */
  const options =
    typeof input.options === 'string'
      ? input.options
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      : []

  if (!title) return { error: '제목을 입력하세요.' }
  if (!businessId) return { error: '회사를 고르세요.' }
  if (options.length === 0) {
    return { error: '선택안을 한 줄에 하나씩 적어 주세요. 고를 것이 없으면 결재가 아닙니다.' }
  }
  if (!isWorkPriority(input.impact)) return { error: '알 수 없는 긴급도입니다.' }
  if (!isIsoDate(deadline)) return { error: '마감일을 고르세요.' }
  // 빈 칸은 통과시킨다. 첨부가 없는 결재는 흔하다 — 0006도 이 칸을 선택으로 두었다.
  if (attachmentUrl && !isStorageLink(attachmentUrl)) {
    return { error: '첨부 링크는 http:// 또는 https:// 로 시작해야 합니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  let decision: Decision
  try {
    const repo = await getRepository()
    decision = await repo.createDecision(
      {
        business_id: businessId,
        title,
        options,
        impact: input.impact,
        deadline,
        attachment_url: attachmentUrl || undefined,
      },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    // 어댑터가 만든 문장에는 RLS 정책 이름 같은 실마리가 들어 있다. 서버 로그에는 그대로 남긴다.
    console.error('[draftDecision]', e)
    return {
      error:
        e instanceof Error && /decisions_create|42501|PGRST301/.test(e.message)
          ? '이 회사에 결재를 올릴 권한이 없습니다. (/chairman/decisions 쓰기 권한이 필요합니다)'
          : '결재를 올리지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  // 같은 결정이 두 곳에 뜬다 — 대시보드 '내 결정 사항'(CH-015)과 이 화면(CH-041).
  revalidatePath('/')
  revalidatePath('/approvals')
  revalidatePath(`/business/${businessId}`)
  return { decision }
}
