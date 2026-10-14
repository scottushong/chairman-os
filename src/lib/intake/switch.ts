import { featureOnFor } from '@/lib/features'
import type { SessionUser } from '@/types'

/**
 * 자료 받는 입구(0058 · AI 분류)의 스위치 — 0073부터 기능 스위치 «intake»(lib/features.ts)로 옮겼다.
 * 기본값은 그대로 **대표에게만**(회장 지시 2026-10-11). 바꾸는 곳은 /settings/features(대표만 · 이유 필수 · 감사).
 *
 * 이 함수는 옛 호출을 깨지 않으려고 남긴 얇은 껍데기다 — DB를 읽지 않고 기본값만 본다.
 * 화면 · Server Action은 DB 스위치를 읽는 `featureOn(user, 'intake')`(lib/features-server.ts)를 쓴다.
 * DB는 그대로다 — 직원이 Supabase에 직접 RPC를 부르는 길은 0058 RLS가 판정한다(화면 스위치일 뿐).
 */
export const intakeOpenFor = (user: Pick<SessionUser, 'role'> | null | undefined): boolean => featureOnFor(null, 'intake', user?.role)
