import 'server-only'

import { notFound, redirect } from 'next/navigation'

import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { getRepository } from '@/lib/repository'
import type { SessionUser } from '@/types'

import type { LinkTargetType, MemoryDirectory } from './types'

/**
 * 기억 화면의 문(0086) — 대표가 아니면 /me로(화면의 존재를 알리지 않는다 · CLAUDE.md «회장 전용 기능»),
 * 대표인데 스위치가 꺼졌으면 404. 판정은 DB(memory_me)가 한 번 더 한다.
 */
export async function memoryViewer() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (user.role !== 'Chairman') redirect('/me')
  if (!(await featureOn(user, 'memory_engine'))) notFound()
  return { user: user as SessionUser, repo: await getRepository() }
}

/** 대표가 아니거나 꺼졌으면 null(다른 화면에 끼우는 칸 — 아무것도 그리지 않는다). */
export async function memoryPanelAllowed(): Promise<boolean> {
  const user = await currentUser()
  return !!user && user.role === 'Chairman' && (await featureOn(user, 'memory_engine'))
}

export const seoulDay = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
export const seoulDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export interface TargetOption {
  target_type: LinkTargetType
  target_id: string
  label: string
}

/** 검토함 «기존 대상에 잇기» 고르기 목록 — 회사 · 프로젝트 · 사람 · 바깥 인물. */
export function targetOptions(dir: MemoryDirectory): TargetOption[] {
  return [
    ...dir.businesses.map((b) => ({ target_type: 'business' as const, target_id: b.business_id, label: `회사 · ${b.name}` })),
    ...dir.projects.map((p) => ({ target_type: 'project' as const, target_id: p.project_id, label: `프로젝트 · ${p.name}` })),
    ...dir.people.map((p) => ({ target_type: 'person' as const, target_id: p.user_id, label: `사람 · ${p.display_name}${p.title_ko ? ` ${p.title_ko}` : ''}` })),
    ...dir.entities.map((e) => ({ target_type: 'entity' as const, target_id: e.entity_id, label: `바깥 · ${e.display_name}${e.status === 'pending' ? ' (확인 전)' : ''}` })),
  ]
}
