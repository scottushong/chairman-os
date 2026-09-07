import type { UserId } from '@/types'

/**
 * audit_log 역조회의 어휘 (DEFERRED D-12).
 *
 * decision-log.ts와 나란히 있지만 축이 다르다. 저쪽은 '결정 하나를 어떻게 처리했나'라
 * 네 가지 행동(승인·거절·수정요청·위임)만 다룬다. 이쪽은 '이 행에 무슨 일이 있었나'라
 * 테이블과 무관하게 audit_log 한 줄을 그대로 읽는다.
 *
 * 단건 화면(/tasks/[id], /projects/[id])이 쓰는 유일한 이력 원천이다.
 * 업무에는 별도의 이력 테이블이 없다 — 감사 기록이 곧 이력이다.
 */

/** 0001_init.sql의 audit_action enum. */
export const AUDIT_ACTIONS = [
  'read',
  'create',
  'update',
  'delete_request',
  'approve',
  'reject',
  'modify',
  'delegate',
  'permission_change',
  'export',
  'login',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ACTION_LABEL_KO: Record<AuditAction, string> = {
  read: '조회',
  create: '생성',
  update: '변경',
  delete_request: '삭제 요청',
  approve: '승인',
  reject: '거절',
  modify: '수정요청',
  delegate: '위임',
  permission_change: '권한 변경',
  export: '내보내기',
  login: '로그인',
}

/**
 * 이력에 이름을 붙일 수 있는 칸들.
 *
 * before/after의 키는 DB 컬럼명이다. 화면에 'chairman_needed'라고 뿌리면
 * 읽는 사람이 스키마를 알아야 이력을 읽는다. 모르는 키는 그대로 보여 준다 —
 * 나중에 칸이 늘었을 때 이력이 통째로 비는 것보다 낫다.
 */
export const AUDIT_FIELD_LABEL_KO: Record<string, string> = {
  status: '상태',
  chairman_needed: '회장 확인',
  blocked_since: '상태 진입일',
  progress_pct: '진행률',
  deadline: '마감',
  priority: '중요도',
  owner_user_id: '담당자',
  title: '제목',
  name: '이름',
}

/** audit_log에서 읽어 온 한 줄. 단건 화면의 '이력'이 이걸 그대로 그린다. */
export interface EntityAuditRecord {
  /** 정렬·키에 쓴다. audit_log는 append only라 id가 곧 시간 순서다. */
  id: number
  occurred_at: string
  action: AuditAction
  actor_user_id: UserId | null
  /**
   * 행위자의 표시 이름. 프로필을 못 찾으면 '미지정'이다(DEFERRED D-09 결정 B).
   * null인 actor_user_id는 사람이 아니라 시스템/야간 Job이다(0001 주석).
   */
  actor_name: string
  actor_role: string | null
  /** 바뀐 칸만 담긴다. 어댑터가 행 전체가 아니라 diff를 남긴다(supabase.ts updateTask). */
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  note: string | null
}

/** 화면에 뿌릴 수 있는 한 줄로 편다. 바뀐 칸이 없으면 빈 배열이다. */
export interface AuditFieldChange {
  field: string
  label: string
  before: string
  after: string
}

/** boolean·null을 사람 말로. 값 하나를 두 곳에서 다르게 쓰지 않으려고 여기 모은다. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '예' : '아니오'
  return String(value)
}

/**
 * before/after를 나란히 놓는다.
 *
 * after의 키를 기준으로 돈다. before에만 있는 키는 '지워진 칸'인데
 * 이 프로젝트에는 칸을 지우는 경로가 없어서 지금은 나오지 않는다.
 */
export function fieldChanges(record: EntityAuditRecord): AuditFieldChange[] {
  const after = record.after ?? {}
  const before = record.before ?? {}
  return Object.keys(after).map((field) => ({
    field,
    label: AUDIT_FIELD_LABEL_KO[field] ?? field,
    before: displayValue(before[field]),
    after: displayValue(after[field]),
  }))
}
