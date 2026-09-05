import type { SecurityClass } from './enums'
import type { BusinessId } from './primitives'

/** 02_기능명세 04_권한 시트. Default Deny / Least Privilege / Business Isolation. */

export const ROLE = [
  'Chairman',
  'GroupCFO',
  'BusinessCEO',
  'Executive',
  'TeamLead',
  'Member',
  'ExternalExpert',
  'Vendor',
  'AIAgent',
] as const
export type Role = (typeof ROLE)[number]

export const ROLE_LABEL_KO: Record<Role, string> = {
  Chairman: 'Chairman',
  GroupCFO: 'Group CFO',
  BusinessCEO: 'Business CEO',
  Executive: '임원',
  TeamLead: '팀장',
  Member: '직원',
  ExternalExpert: '외부전문가',
  Vendor: '외주 개발자',
  AIAgent: 'AI Agent',
}

export type PermissionAction = 'read' | 'write' | 'approve' | 'comment'

export interface RolePolicy {
  role: Role
  /** 'all'이면 전사. 아니면 명시된 Business만 본다. */
  business_scope: 'all' | BusinessId[]
  module_scope: 'all' | string[]
  actions: PermissionAction[]
  /** 접근 가능한 최고 보안등급. 여기 없는 등급은 값 자체를 내려보내지 않는다. */
  max_security_class: SecurityClass
}

export interface SessionUser {
  user_id: string
  name: string
  role: Role
  title_ko: string
}
