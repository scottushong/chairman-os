/**
 * 입구 화면의 «누가 무엇을 누를 수 있나» — 0058 정책을 **안내용으로** 옮긴 것. 최종 판정은 DB다(RLS · stamp · RPC).
 * 화면은 이 함수로 버튼을 그릴지만 정하고, 서버 액션이 DB 거부를 사람의 말로 바꾼다.
 */
import { canWriteDocuments } from '@/lib/auth/roles'
import type { SessionUser } from '@/types'
import { INTAKE_DOCUMENT_KINDS, type IntakeItem, type IntakeKind } from '@/types/intake'

export type IntakeFilter = 'all' | 'waiting' | 'mine' | 'loaded'

export const INTAKE_FILTER_LABEL_KO: Record<IntakeFilter, string> = {
  all: '전체',
  waiting: '확인 기다림',
  mine: '내가 올린 것',
  loaded: '적재됨',
}

/** «확인 기다림» — 아직 어디에도 넣지 않았고 사람이 볼 차례인 줄. */
export const isWaiting = (i: Pick<IntakeItem, 'status'>) => ['uploaded', 'reading', 'proposed', 'failed', 'no_ai'].includes(i.status)

export function matchesFilter(i: Pick<IntakeItem, 'status' | 'created_by'>, f: IntakeFilter, userId: string): boolean {
  if (f === 'waiting') return isWaiting(i)
  if (f === 'mine') return i.created_by === userId
  if (f === 'loaded') return i.status === 'loaded'
  return true
}

/** 확인 권한자 — 지금 적재 대상은 문서뿐이라 0048 문서 쓰기(intake_can_confirm과 같은 판정). */
export const canConfirmIntake = (user: SessionUser | null, businessId: string) => canWriteDocuments(user, businessId)

/** 종류 바꾸기 · 다시 읽기 — 올린 사람 · 확인 권한자 · 회장(0058 intake_can_edit). */
export function canEditIntake(user: SessionUser | null, item: Pick<IntakeItem, 'created_by' | 'business_id'>): boolean {
  if (!user || user.role === 'AIAgent' || user.role === 'Integration') return false
  return user.role === 'Chairman' || item.created_by === user.user_id || canConfirmIntake(user, item.business_id)
}

/** «이 메뉴에 초안 만들기»가 서는 종류(이 블록은 문서뿐). */
export const isDocumentKind = (k: IntakeKind | null | undefined): boolean => !!k && INTAKE_DOCUMENT_KINDS.includes(k)

/** AI 차단을 이 사람이 풀 수 있나 — 이유와 무관하게 대표, not_attested는 올린 사람의 확인으로. */
export function canLiftBlock(user: SessionUser | null, item: Pick<IntakeItem, 'ai_blocked_reason' | 'created_by'>): 'chairman' | 'attest' | null {
  if (!user || !item.ai_blocked_reason) return null
  if (user.role === 'Chairman') return 'chairman'
  if (item.ai_blocked_reason === 'not_attested' && item.created_by === user.user_id) return 'attest'
  return null
}

/** «되돌리기»(문서 soft delete) — 적재한 사람 · 회장(0048 고치기 규칙). */
export const canUndoLoad = (user: SessionUser | null, item: Pick<IntakeItem, 'loaded_by' | 'status'>) =>
  !!user && item.status === 'loaded' && (user.role === 'Chairman' || item.loaded_by === user.user_id)

/** 같은 파일 알림 한 줄 — «이미 ‹날짜›에 ‹메뉴›로 넣은 파일입니다». 넣지 않은 같은 파일은 «이미 입구에 있는 파일입니다». */
export function sameFileNotice(others: { status: string; loaded_table: string | null; loaded_at: string | null; created_at: string }[]): string | null {
  const loaded = others.find((o) => o.status === 'loaded' && o.loaded_at)
  if (loaded) return `이미 ${loaded.loaded_at!.slice(0, 10)}에 ${loaded.loaded_table === 'documents' ? '문서' : '다른 메뉴'}로 넣은 파일입니다.`
  if (others.length) return `같은 파일이 이미 입구에 있습니다(${others[0].created_at.slice(0, 10)} 올림).`
  return null
}

/** 0058 — 입구에서 온 문서의 storage_url(앱 안 문서 화면). 바깥 링크가 아니라 앱 안 링크로 그린다. */
export const isInAppDocLink = (url: string): boolean => /^\/documents\/[A-Za-z0-9_-]{1,64}$/.test(url)
