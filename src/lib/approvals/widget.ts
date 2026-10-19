import 'server-only'

import { eaStore } from './store'
import type { EaListRow } from './types'

/**
 * 0087 전자결재 — 개인 홈(0086 직원 홈) 위젯이 쓸 조회 함수. 전자결재 메뉴(/e-approval)와 **같은 함수 · 같은 권한**(ea_list · ea_counts)을 부른다.
 * 그래서 위젯의 «내 결재 대기» 숫자 = 메뉴의 «결재할 문서» 건수다(결재 예정은 들어가지 않는다 · 최종 승인과 후속 상태를 섞지 않는다).
 * 스위치(approvals)가 꺼진 회사 문서는 DB가 이미 뺀다. 0087이 없는 DB · 오류면 null(위젯이 칸을 숨긴다 — 0을 지어내지 않는다).
 * 문서: docs/onboarding/release-approvals.md «홈 위젯 연결».
 */

/** 링크 — 숫자를 누르면 결재할 문서로, 문서를 누르면 그 상세로. */
export const eaTodoHref = '/e-approval?box=todo'
export const eaDocHref = (box: 'todo' | 'mine', docId: string) => `/e-approval?box=${box}&doc=${docId}`

/** 내 결재 대기 건수(= «결재할 문서» 탭 숫자). */
export async function myApprovalPendingCount(): Promise<number | null> {
  try {
    return (await (await eaStore()).counts()).todo
  } catch {
    return null
  }
}

/** 내 결재 대기 목록(최근 상신 순 · limit건). */
export async function myApprovalPendingList(limit = 5): Promise<EaListRow[] | null> {
  try {
    return (await (await eaStore()).list('todo')).slice(0, limit)
  } catch {
    return null
  }
}

/** 내가 올린 문서(임시저장 빼고 · 최근 순 · limit건). 상태(진행 중 · 반려 · 승인 완료 · 회수)와 지금 담당자(current_label)가 같이 온다. */
export async function mySubmittedApprovals(limit = 5): Promise<EaListRow[] | null> {
  try {
    return (await (await eaStore()).list('mine')).slice(0, limit)
  } catch {
    return null
  }
}
