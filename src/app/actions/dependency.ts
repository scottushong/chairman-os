'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository, type ChairmanDirectionInput } from '@/lib/repository'
import {
  ABSENCE_DAYS,
  ABSENCE_RESULT,
  AUTONOMY_LEVEL,
  DEPENDENCY_LEVEL,
  TRANSFER_STATUS,
  type AbsenceDays,
  type AbsenceResult,
  type AutonomyLevel,
  type DependencyLevel,
  type TransferStatus,
} from '@/types'

/**
 * 블록 A 승계 자료 저장 (/dependency/[id]).
 *
 * **권한을 여기서 판정하지 않는다.** 로그인한 본인 세션으로 DB에 붙고 0033의 RLS
 * (can_write_succession → Chairman·GroupCFO)가 판정한다. 여기서 역할을 한 번 더 보면
 * 판정이 두 곳이 되고, 언젠가 한쪽만 고쳐진다. 대신 거부당했을 때 사람이 읽을 수 있는
 * 문장으로 바꿔 준다(permissionError).
 *
 * 감사 기록은 어댑터가 남긴다(supabase.ts writeAudit) — **기록이 먼저다.**
 *
 * 빈 값은 null로 보낸다. **''(빈 문자열)로 보내지 않는다** — check 제약이 ''를 거부하고,
 * 무엇보다 '고르지 않음'과 '빈 글자'는 다른 사실이다. 이 블록의 화면은 그 차이 위에 서 있다.
 */

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullable(value: unknown): string | null {
  const t = text(value)
  return t === '' ? null : t
}

/** 줄바꿈으로 나눈 목록. 빈 줄은 버린다 — 빈 항목은 화면에서 빈 점으로만 보인다. */
function lines(value: unknown): string[] {
  return text(value)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function permissionError(e: unknown, fallback: string): string {
  return e instanceof Error && /succession|42501|PGRST301|Chairman/.test(e.message)
    ? '승계 자료를 고칠 권한이 없습니다. (회장 · 그룹 CFO만 가능합니다)'
    : fallback
}

/**
 * 감사 기록에 남을 행위자. 세션이 없으면 아무것도 못 한다 —
 * 익명이 승계 자료를 고치는 경로는 만들지 않는다(RLS도 막지만 여기서 먼저 멈춘다).
 */
async function actor() {
  const user = await currentUser()
  if (!user) return null
  return { user_id: user.user_id, role: user.role }
}

export interface SaveState {
  error?: string
  ok?: boolean
}

/** §7+§11 의존 영역 한 줄. level·transfer_status는 '고르지 않음'이 정상값이다. */
export async function saveDependencyArea(input: {
  businessId: unknown
  area: unknown
  level: unknown
  transferStatus: unknown
  targetDate: unknown
  note: unknown
}): Promise<SaveState> {
  const business_id = text(input.businessId)
  const area = text(input.area)
  if (!business_id) return { error: '회사를 알 수 없습니다.' }
  if (!area) return { error: '영역 이름을 입력하세요.' }
  if (area.length > 60) return { error: '영역 이름은 60자까지입니다.' }

  const level = nullable(input.level)
  if (level !== null && !(DEPENDENCY_LEVEL as readonly string[]).includes(level)) {
    return { error: '의존도는 높음 · 보통 · 낮음 중에서 고릅니다.' }
  }
  const transfer = nullable(input.transferStatus)
  if (transfer !== null && !(TRANSFER_STATUS as readonly string[]).includes(transfer)) {
    return { error: '이양 상태는 완료 · 진행 중 · 미이양 중에서 고릅니다.' }
  }
  const target = nullable(input.targetDate)
  if (target !== null && !isDate(target)) return { error: '목표일 형식을 확인하세요.' }

  const who = await actor()
  if (!who) return { error: '로그인이 필요합니다.' }

  try {
    const repo = await getRepository()
    await repo.saveDependencyArea(
      {
        business_id,
        area,
        level: level as DependencyLevel | null,
        transfer_status: transfer as TransferStatus | null,
        target_date: target,
        note: nullable(input.note),
      },
      who,
    )
  } catch (e) {
    return { error: permissionError(e, '의존 영역을 저장하지 못했습니다.') }
  }
  revalidatePath(`/dependency/${business_id}`)
  revalidatePath('/dependency')
  return { ok: true }
}

/** §9 분기 자율성 평가. 등급은 판단이라 누가 언제 매겼는지가 같이 남는다. */
export async function saveAutonomyAssessment(input: {
  businessId: unknown
  quarter: unknown
  level: unknown
  note: unknown
}): Promise<SaveState> {
  const business_id = text(input.businessId)
  const quarter = text(input.quarter)
  const level = text(input.level)
  if (!business_id) return { error: '회사를 알 수 없습니다.' }
  if (!/^\d{4}-Q[1-4]$/.test(quarter)) return { error: '분기는 2026-Q3 형식으로 적습니다.' }
  if (!(AUTONOMY_LEVEL as readonly string[]).includes(level)) {
    return { error: '자율성 등급은 L1~L5 중에서 고릅니다.' }
  }

  const who = await actor()
  if (!who) return { error: '로그인이 필요합니다.' }

  try {
    const repo = await getRepository()
    await repo.saveAutonomyAssessment(
      { business_id, quarter, level: level as AutonomyLevel, note: nullable(input.note) },
      who,
    )
  } catch (e) {
    return { error: permissionError(e, '자율성 평가를 저장하지 못했습니다.') }
  }
  revalidatePath(`/dependency/${business_id}`)
  revalidatePath('/dependency')
  return { ok: true }
}

/** §12 부재 테스트. 결과는 치른 뒤에 적는다 — 기본값이 '예정'인 이유다. */
export async function saveAbsenceTest(input: {
  businessId: unknown
  days: unknown
  scheduledOn: unknown
  result: unknown
  note: unknown
}): Promise<SaveState> {
  const business_id = text(input.businessId)
  const days = Number(text(input.days))
  const scheduled_on = text(input.scheduledOn)
  const result = text(input.result)
  if (!business_id) return { error: '회사를 알 수 없습니다.' }
  if (!(ABSENCE_DAYS as readonly number[]).includes(days)) {
    return { error: '부재 기간은 7 · 30 · 90 · 365일 중에서 고릅니다.' }
  }
  if (!isDate(scheduled_on)) return { error: '시작 예정일을 확인하세요.' }
  if (!(ABSENCE_RESULT as readonly string[]).includes(result)) {
    return { error: '결과는 통과 · 실패 · 예정 중에서 고릅니다.' }
  }

  const who = await actor()
  if (!who) return { error: '로그인이 필요합니다.' }

  try {
    const repo = await getRepository()
    await repo.saveAbsenceTest(
      {
        business_id,
        days: days as AbsenceDays,
        scheduled_on,
        result: result as AbsenceResult,
        note: nullable(input.note),
      },
      who,
    )
  } catch (e) {
    return { error: permissionError(e, '부재 테스트를 저장하지 못했습니다.') }
  }
  revalidatePath(`/dependency/${business_id}`)
  revalidatePath('/dependency')
  return { ok: true }
}

/**
 * §20 Direction + §21 Letter. **보낸 칸만 바꾼다.**
 * 화면이 절마다 따로 저장하므로, 안 보낸 칸까지 덮으면 다른 절이 조용히 지워진다.
 */
export async function saveChairmanDirection(input: {
  businessId: unknown
  fiveYear?: unknown
  priorities?: unknown
  doNot?: unknown
  contactWhen?: unknown
  whyOwn?: unknown
  capitalPhilosophy?: unknown
  caresAbout?: unknown
  notManaged?: unknown
  redLines?: unknown
  letter?: unknown
}): Promise<SaveState> {
  const business_id = text(input.businessId)
  if (!business_id) return { error: '회사를 알 수 없습니다.' }

  const patch: ChairmanDirectionInput = { business_id }
  const set = patch as unknown as Record<string, unknown>
  if (input.fiveYear !== undefined) set.five_year = nullable(input.fiveYear)
  if (input.whyOwn !== undefined) set.why_own = nullable(input.whyOwn)
  if (input.capitalPhilosophy !== undefined) set.capital_philosophy = nullable(input.capitalPhilosophy)
  if (input.letter !== undefined) set.letter = nullable(input.letter)
  if (input.priorities !== undefined) set.priorities = lines(input.priorities)
  if (input.doNot !== undefined) set.do_not = lines(input.doNot)
  if (input.contactWhen !== undefined) set.contact_when = lines(input.contactWhen)
  if (input.caresAbout !== undefined) set.cares_about = lines(input.caresAbout)
  if (input.notManaged !== undefined) set.not_managed = lines(input.notManaged)
  if (input.redLines !== undefined) set.red_lines = lines(input.redLines)

  if ((patch.letter ?? '').length > 20_000) return { error: 'Letter는 20,000자까지입니다.' }

  const who = await actor()
  if (!who) return { error: '로그인이 필요합니다.' }

  try {
    const repo = await getRepository()
    await repo.saveChairmanDirection(patch, who)
  } catch (e) {
    return { error: permissionError(e, 'Direction을 저장하지 못했습니다.') }
  }
  revalidatePath(`/dependency/${business_id}`)
  return { ok: true }
}
