import { checkServiceAccount, isInventoryMethod, MEMO_MAX, type OwnerInputRow } from '@/lib/owner-inputs'
import type { UserAccount } from '@/types'

import { DUMMY_UID } from './dummy-org'
import type { ChairmanRepository } from './types'

/**
 * 0089 5절 «받을 것»의 dummy 자리 — 메모리 줄(globalThis: webpack dev의 화면 층 · 액션 층이 한 벌을 보게).
 * **DB가 막는 것을 여기서도 막는다**: 대표(활성)만 · 스위치 owner_inputs · 항목마다 모양 · 원가 권한 줄이 먼저 · 구글은 모양 검사.
 * **구글 키 본문은 저장하지 않는다** — dummy에는 Vault가 없다. 이메일 · 프로젝트 id만 남기고 본문은 버린다.
 *
 * DUMMY_OWNER_INPUTS=filled — 화면 시험 손잡이(dummy만): «진짜 BOM 받음»(biz_dy · 가짜 3판) 한 줄을 처음부터 둔다.
 * 진짜 BOM 받음은 기존 넣기 흐름(진짜 BOM 받기 스위치 · 0063 키)을 지나야 적히는데, dummy 화면 사진에서 그 흐름을 다시 돌리지 않으려고.
 */

type Methods = Pick<ChairmanRepository, 'listOwnerInputs' | 'markOwnerInput' | 'saveGoogleServiceAccount'>

export interface DummyOwnerInputDeps {
  viewer(): UserAccount
  featureOn(): Promise<boolean>
  businesses(): Promise<string[]>
  /** '/costing/<biz>' 쓰기 줄이 있는가(0061 거울). */
  hasCostGrant(userId: string, businessId: string): boolean
}

const g = globalThis as { __dummyOwnerInputs?: OwnerInputRow[] }
function store(): OwnerInputRow[] {
  if (!g.__dummyOwnerInputs) {
    g.__dummyOwnerInputs = []
    if (process.env.DUMMY_OWNER_INPUTS === 'filled') {
      g.__dummyOwnerInputs.push({
        item_key: 'real_bom',
        scope: 'biz_dy',
        summary: { rows: 3 },
        received_by: DUMMY_UID.chair,
        received_at: '2026-10-20T01:00:00.000Z',
      })
    }
  }
  return g.__dummyOwnerInputs
}

/** 시험용 — 저장소 비우기. */
export function resetDummyOwnerInputs(): void {
  delete g.__dummyOwnerInputs
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function dummyOwnerInputs(deps: DummyOwnerInputDeps): Methods {
  const gate = async () => {
    const v = deps.viewer()
    if (v.role !== 'Chairman' || v.revoked_at || !(await deps.featureOn())) throw new Error('owner_input_denied')
    return v
  }
  const put = (row: OwnerInputRow) => {
    const s = store()
    const i = s.findIndex((r) => r.item_key === row.item_key && r.scope === row.scope)
    if (i >= 0) s[i] = row
    else s.push(row)
  }
  return {
    async listOwnerInputs() {
      const v = deps.viewer()
      if (v.role !== 'Chairman' || v.revoked_at || !(await deps.featureOn())) return []
      return store().map((r) => ({ ...r, summary: { ...r.summary } }))
    },
    async markOwnerInput(item, scope, summary) {
      const v = await gate()
      const keys = Object.keys(summary)
      const bad = () => new Error('owner_input_shape')
      if (!(['real_bom', 'inventory_method', 'cost_manager'] as string[]).includes(item)) throw bad()
      if (!(await deps.businesses()).includes(scope) || JSON.stringify(summary).length > 2000) throw bad()
      if (item === 'real_bom') {
        const n = summary.rows
        if (keys.some((k) => k !== 'rows') || typeof n !== 'number' || n < 0 || !Number.isInteger(n)) throw bad()
      }
      if (item === 'inventory_method') {
        if (keys.some((k) => k !== 'method' && k !== 'memo') || !isInventoryMethod(summary.method)) throw bad()
        if ('memo' in summary && (typeof summary.memo !== 'string' || summary.memo.length > MEMO_MAX)) throw bad()
      }
      if (item === 'cost_manager') {
        const u = summary.user_id
        if (keys.some((k) => k !== 'user_id') || typeof u !== 'string' || !UUID.test(u)) throw bad()
        if (!deps.hasCostGrant(u, scope)) throw new Error('owner_input_no_grant')
      }
      put({ item_key: item, scope, summary: { ...summary }, received_by: v.user_id, received_at: new Date().toISOString() })
    },
    async saveGoogleServiceAccount(json) {
      const v = await gate()
      const c = checkServiceAccount(json)
      if (!c.ok) throw new Error('owner_input_sa_shape')
      // 본문(json)은 여기서 끝난다 — 저장하지 않는다(dummy에는 Vault가 없다).
      const summary = { client_email: c.summary.client_email, project_id: c.summary.project_id, secret: 'google_sheets_sa' }
      put({ item_key: 'google_sa', scope: 'group', summary, received_by: v.user_id, received_at: new Date().toISOString() })
      return { ...c.summary }
    },
  }
}
