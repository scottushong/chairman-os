import type { SessionUser } from '@/types'

/**
 * 자료 받는 입구(0058 · AI 분류)의 스위치 — 실제 AI 시험 전까지 **대표에게만** 연다(회장 지시 2026-10-11).
 *
 * 여기 한 곳만 바꾼다: true로 바꾸면 0058 RLS가 정한 사람 모두에게 열린다.
 * 꺼져 있으면 대표 외에는 회사 화면이 0058 전의 «첨부» 칸으로 돌아가고(intake-section.tsx),
 * 입구 Server Action은 전부 거부한다(app/actions/intake.ts who()). 입구 화면은 회사 화면 안의 칸뿐이라 따로 막을 주소는 없다.
 * DB는 그대로다 — 직원이 Supabase에 직접 RPC를 부르는 길은 0058 RLS가 판정한다(화면 스위치일 뿐).
 */
export const INTAKE_OPEN_TO_STAFF = false

export const intakeOpenFor = (user: Pick<SessionUser, 'role'> | null | undefined): boolean =>
  !!user && (user.role === 'Chairman' || INTAKE_OPEN_TO_STAFF)
