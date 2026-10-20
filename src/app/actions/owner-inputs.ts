'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { moduleKey } from '@/lib/module-grants'
import { checkServiceAccount, isInventoryMethod, MEMO_MAX, OWNER_INPUT_ERROR, ownerInputLogWord, ownerInputMessage, SA_MAX_BYTES } from '@/lib/owner-inputs'
import { getRepository } from '@/lib/repository'

/**
 * /settings «받을 것» 카드의 서버 액션(0089 5절). 결정: docs/decisions/2026-10-20-intake-items.md
 *
 * 문은 DB다(owner_input_* — 대표 · 활성 · 스위치). 여기 판정은 파일을 펼치기 전의 안내(대표가 아니면 읽지도 않는다).
 * **AI 금지** — 이 파일은 어떤 AI 함수도 부르지 않는다(check:intake-items가 import를 잰다).
 * **구글 키 본문은 로그 · 오류 · 응답에 싣지 않는다** — 로그는 낱말 하나(ownerInputLogWord), 응답은 이메일 · 프로젝트 id만.
 */

export interface OwnerInputResult {
  ok?: string
  error?: string
}

const BIZ = /^[a-z0-9_]{2,40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HUMAN_STAFF = new Set(['GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member'])

async function boss() {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' } as const
  if (user.role !== 'Chairman' || !(await featureOn(user, 'owner_inputs'))) return { error: OWNER_INPUT_ERROR.owner_input_denied } as const
  return { user } as const
}

/** 세무사 재고평가방법 — 0075 월별 손익 설정은 바꾸지 않는다(나란히 두는 «세무사 확인값»). */
export async function saveInventoryMethodAction(input: { businessId: unknown; method: unknown; memo: unknown }): Promise<OwnerInputResult> {
  const g = await boss()
  if ('error' in g) return { error: g.error }
  const businessId = typeof input.businessId === 'string' ? input.businessId.trim() : ''
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  if (!isInventoryMethod(input.method)) return { error: '평가방법을 고르세요.' }
  const memo = typeof input.memo === 'string' ? input.memo.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim() : ''
  if (memo.length > MEMO_MAX) return { error: `메모는 ${MEMO_MAX}자까지입니다.` }
  try {
    await (await getRepository()).markOwnerInput('inventory_method', businessId, memo ? { method: input.method, memo } : { method: input.method })
  } catch (e) {
    console.error('[owner-inputs] inventory_method', ownerInputLogWord(e))
    return { error: ownerInputMessage(e) }
  }
  revalidatePath('/settings')
  return { ok: '저장했습니다.' }
}

/**
 * 구글 서비스 계정 JSON 올리기 → 모양 검사 → Vault(정의자 함수 owner_input_google_sa_save). 파일은 서버 메모리에서만 지나간다(디스크 · 스토리지 · 로그 없음).
 */
export async function uploadGoogleServiceAccountAction(form: FormData): Promise<OwnerInputResult & { email?: string; project?: string }> {
  const g = await boss()
  if ('error' in g) return { error: g.error }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > SA_MAX_BYTES) return { error: OWNER_INPUT_ERROR.sa_size }
  if (!/\.json$/i.test(file.name)) return { error: OWNER_INPUT_ERROR.sa_json }
  let text = ''
  try {
    text = await file.text()
  } catch {
    return { error: OWNER_INPUT_ERROR.sa_json }
  }
  const c = checkServiceAccount(text)
  if (!c.ok) {
    console.warn('[owner-inputs] google_sa 모양', c.error)
    return { error: OWNER_INPUT_ERROR[c.error] }
  }
  try {
    const saved = await (await getRepository()).saveGoogleServiceAccount(text)
    revalidatePath('/settings')
    return { ok: '받았습니다 — 키는 Vault에만 저장했습니다.', email: saved.client_email, project: saved.project_id }
  } catch (e) {
    console.error('[owner-inputs] google_sa', ownerInputLogWord(e))
    return { error: ownerInputMessage(e) }
  } finally {
    text = ''
  }
}

/**
 * 원가 관리 권한자 — 기존 원가 권한('/costing/<회사>' 쓰기 · 0061 회사마다 셋까지)을 주고(0002 module_access_admin_write — 대표만)
 * «받음»을 적는다(owner_input_mark가 그 줄이 있는지 다시 본다). 권한을 빼는 것은 /settings/users에서.
 */
export async function setCostManagerAction(input: { businessId: unknown; userId: unknown }): Promise<OwnerInputResult> {
  const g = await boss()
  if ('error' in g) return { error: g.error }
  const businessId = typeof input.businessId === 'string' ? input.businessId.trim() : ''
  const userId = typeof input.userId === 'string' ? input.userId.trim() : ''
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  if (!UUID.test(userId)) return { error: '사람을 고르세요.' }
  try {
    const repo = await getRepository()
    const [people, businesses] = await Promise.all([repo.listUserAccounts(), repo.listBusinesses()])
    if (!businesses.some((b) => b.business_id === businessId)) return { error: '없는 회사입니다.' }
    const person = people.find((p) => p.user_id === userId)
    if (!person || person.revoked_at || !HUMAN_STAFF.has(person.role)) return { error: '고를 수 없는 사람입니다.' }
    if (!(person.role === 'GroupCFO' || person.business_ids.includes(businessId))) return { error: '그 회사에 접근이 없는 사람입니다 — 회사 범위를 먼저 주세요(/settings/users).' }
    await repo.setModuleGrant(userId, { module: moduleKey('/costing', businessId), can_write: true, can_approve: false }, { user_id: g.user.user_id, role: g.user.role })
    await repo.markOwnerInput('cost_manager', businessId, { user_id: userId })
  } catch (e) {
    console.error('[owner-inputs] cost_manager', ownerInputLogWord(e))
    return { error: ownerInputMessage(e) }
  }
  revalidatePath('/settings')
  return { ok: '원가 관리 권한을 주었습니다.' }
}
