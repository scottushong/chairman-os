'use server'

import { createHash, randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { canWritePurchasing } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { boss } from '@/lib/boss'
import { isImageDoc, PURCHASE_DOC_MAX_BYTES, purchaseDocMime, safeDocFileName, storageDocName } from '@/lib/purchasing/doc-rules'
import { mixRejectMessage, screenPurchaseDoc } from '@/lib/purchasing/doc-screen'
import { purchasingError } from '@/lib/purchasing/errors'
import { getRepository } from '@/lib/repository'
import {
  MATERIAL_CATEGORIES,
  PURCHASE_DOC_KINDS,
  type CostMaterial,
  type CostSupplier,
  type MarketPrice,
  type MaterialCategory,
  type PurchaseDoc,
  type PurchaseDocKind,
  type PurchaseLot,
} from '@/types'

/**
 * 0061 원가 엔진 · 구매 Server Action.
 *
 * 권한의 문은 DB다(cost_can · RLS · 트리거). 여기서는 입력의 모양을 거르고 DB의 거부를 사람의 말로 바꾼다(lib/purchasing/errors.ts).
 * 예외 하나 — 첨부 올리기는 바이트를 읽고 배합비 검사를 돌리기 **전에** 세션 안내(canWritePurchasing)로 한 번 거른다:
 * 권한 없는 사람의 파일을 서버 메모리에서 펼쳐 볼 이유가 없다. 첨부는 어떤 AI에도 보내지 않는다.
 */

export interface PurchasingState {
  error?: string
}

const BIZ = /^[a-z0-9_]{1,60}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CURRENCY = /^[A-Z]{3}$/

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** «1,234.5» 같은 화면 값 → number. 비었거나 숫자가 아니면 null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function done(businessId: string) {
  revalidatePath(`/purchasing/${businessId}`, 'layout')
}

async function session() {
  return currentUser()
}

const EXPIRED = { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

// ── 원료 ─────────────────────────────────────────────────────────────

export async function saveMaterialAction(input: Record<string, unknown>): Promise<PurchasingState & { material?: CostMaterial }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const name = str(input.name, 120)
  if (!name) return { error: '원료 이름을 적으세요.' }
  const category = input.category as MaterialCategory
  if (!MATERIAL_CATEGORIES.includes(category)) return { error: '분류를 고르세요.' }
  const materialId = typeof input.materialId === 'string' && /^mat_[a-z0-9_]{4,60}$/.test(input.materialId) ? input.materialId : undefined
  if (!(await session())) return EXPIRED
  try {
    const material = await (await getRepository()).saveCostMaterial(
      businessId,
      { name, spec: str(input.spec, 200), category, active: input.active !== false, note: str(input.note, 500) },
      materialId,
    )
    done(businessId)
    return { material }
  } catch (e) {
    console.error('[purchasing] material', e)
    return { error: purchasingError(e) }
  }
}

// ── 공급처 ───────────────────────────────────────────────────────────

export async function saveSupplierAction(input: Record<string, unknown>): Promise<PurchasingState & { supplier?: CostSupplier }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const name = str(input.name, 120)
  if (!name) return { error: '공급처 이름을 적으세요.' }
  const currency = str(input.currency_default, 3).toUpperCase()
  if (!CURRENCY.test(currency)) return { error: '기본 통화를 고르세요(KRW · USD 같은 세 글자).' }
  const supplierId = typeof input.supplierId === 'string' && /^sup_[a-z0-9_]{4,60}$/.test(input.supplierId) ? input.supplierId : undefined
  if (!(await session())) return EXPIRED
  try {
    const supplier = await (await getRepository()).saveCostSupplier(
      businessId,
      {
        name,
        country: str(input.country, 60),
        currency_default: currency,
        contact: str(input.contact, 500),
        terms: str(input.terms, 500),
        active: input.active !== false,
        note: str(input.note, 500),
      },
      supplierId,
    )
    done(businessId)
    return { supplier }
  } catch (e) {
    console.error('[purchasing] supplier', e)
    return { error: purchasingError(e) }
  }
}

// ── 시장가 ───────────────────────────────────────────────────────────

export async function addMarketPriceAction(input: Record<string, unknown>): Promise<PurchasingState & { price?: MarketPrice }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const material_id = str(input.material_id, 70)
  if (!material_id) return { error: '원료를 고르세요.' }
  const observed_on = str(input.observed_on, 10)
  if (!DATE.test(observed_on)) return { error: '날짜를 고르세요.' }
  const price = num(input.price)
  if (price === null || price <= 0) return { error: '가격(kg당)을 0보다 크게 넣으세요.' }
  const currency = str(input.currency, 3).toUpperCase()
  if (!CURRENCY.test(currency)) return { error: '통화를 고르세요.' }
  const fx = num(input.fx_rate)
  if (fx !== null && fx <= 0) return { error: '환율은 0보다 커야 합니다.' }
  const source_name = str(input.source_name, 120)
  if (!source_name) return { error: '출처를 적으세요(예: 거래처 시세 문자 · 구매팀 조사).' }
  const source_url = str(input.source_url, 1000)
  if (source_url && !/^https?:\/\//i.test(source_url)) return { error: '출처 주소는 http:// 또는 https://로 시작해야 합니다.' }
  if (!(await session())) return EXPIRED
  try {
    const row = await (await getRepository()).addMarketPrice(businessId, {
      material_id,
      observed_on,
      price,
      currency,
      fx_rate: currency === 'KRW' ? null : fx,
      source_name,
      source_url: source_url || null,
      note: str(input.note, 500),
    })
    done(businessId)
    return { price: row }
  } catch (e) {
    console.error('[purchasing] market', e)
    return { error: purchasingError(e) }
  }
}

export async function voidMarketPriceAction(businessId: string, priceId: number, reason: string): Promise<PurchasingState> {
  if (!BIZ.test(businessId) || !Number.isInteger(priceId)) return { error: '찾을 수 없거나 권한이 없습니다.' }
  const why = str(reason, 300)
  if (!why) return { error: '무효 이유를 적으세요.' }
  if (!(await session())) return EXPIRED
  try {
    await (await getRepository()).voidMarketPrice(businessId, priceId, why)
    done(businessId)
    return {}
  } catch (e) {
    console.error('[purchasing] void market', e)
    return { error: purchasingError(e, '무효로 하지 못했습니다.') }
  }
}

// ── 환율 ─────────────────────────────────────────────────────────────

/** 미리보기용 환율(0061 cost_fx — 그 날짜 이하 최신). 저장 때는 DB가 같은 함수로 다시 찾는다. */
export async function lookupFxAction(currency: string, onDate: string): Promise<{ rate: number | null }> {
  if (!CURRENCY.test(currency) || !DATE.test(onDate)) return { rate: null }
  if (!(await session())) return { rate: null }
  try {
    return { rate: await (await getRepository()).lookupCostFx(currency, onDate) }
  } catch (e) {
    console.error('[purchasing] fx', e)
    return { rate: null }
  }
}

// ── 구매 LOT ─────────────────────────────────────────────────────────

export async function addLotAction(input: Record<string, unknown>): Promise<PurchasingState & { lot?: PurchaseLot }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const material_id = str(input.material_id, 70)
  const supplier_id = str(input.supplier_id, 70)
  if (!material_id) return { error: '원료를 고르세요.' }
  if (!supplier_id) return { error: '공급처를 고르세요.' }
  const received_on = str(input.received_on, 10)
  if (!DATE.test(received_on)) return { error: '입고일을 고르세요.' }
  const ordered_on = str(input.ordered_on, 10)
  if (ordered_on && !DATE.test(ordered_on)) return { error: '발주일이 날짜가 아닙니다.' }
  const qty = num(input.qty_kg)
  if (qty === null || qty <= 0) return { error: '수량(kg)을 0보다 크게 넣으세요.' }
  const unit = num(input.unit_price)
  if (unit === null || unit <= 0) return { error: '단가(kg당)를 0보다 크게 넣으세요.' }
  const currency = str(input.currency, 3).toUpperCase()
  if (!CURRENCY.test(currency)) return { error: '통화를 고르세요.' }
  const fx = num(input.fx_rate)
  if (fx !== null && fx <= 0) return { error: '환율은 0보다 커야 합니다.' }
  const extras = ['freight_krw', 'duty_krw', 'other_krw'].map((k) => num(input[k]) ?? 0)
  if (extras.some((x) => x < 0)) return { error: '부대비는 0 이상이어야 합니다.' }
  const source = input.source === 'approval' ? 'approval' : 'manual'
  const source_ref = source === 'approval' ? str(input.source_ref, 80) : null
  if (source === 'approval' && !source_ref) return { error: '어느 결재에서 왔는지 알 수 없습니다.' }
  if (!(await session())) return EXPIRED
  try {
    const lot = await (await getRepository()).addPurchaseLot(businessId, {
      material_id,
      supplier_id,
      received_on,
      ordered_on: ordered_on || null,
      supplier_lot_no: str(input.supplier_lot_no, 80),
      qty_kg: qty,
      unit_price: unit,
      currency,
      fx_rate: currency === 'KRW' ? null : fx,
      freight_krw: extras[0],
      duty_krw: extras[1],
      other_krw: extras[2],
      source,
      source_ref,
      note: str(input.note, 500),
    })
    done(businessId)
    return { lot }
  } catch (e) {
    console.error('[purchasing] lot', e)
    return { error: purchasingError(e) }
  }
}

export async function voidLotAction(businessId: string, lotId: string, reason: string): Promise<PurchasingState> {
  if (!BIZ.test(businessId) || !/^PL-[0-9]{8}-[0-9A-F]{6}$/.test(lotId)) return { error: '찾을 수 없거나 권한이 없습니다.' }
  const why = str(reason, 300)
  if (!why) return { error: '무효 이유를 적으세요.' }
  if (!(await session())) return EXPIRED
  try {
    await (await getRepository()).voidPurchaseLot(businessId, lotId, why)
    done(businessId)
    return {}
  } catch (e) {
    console.error('[purchasing] void lot', e)
    return { error: purchasingError(e, '무효로 하지 못했습니다.') }
  }
}

export async function dismissCandidateAction(businessId: string, decisionId: string): Promise<PurchasingState> {
  if (!BIZ.test(businessId) || !/^[A-Za-z0-9_-]{1,80}$/.test(decisionId)) return { error: '찾을 수 없거나 권한이 없습니다.' }
  if (!(await session())) return EXPIRED
  try {
    await (await getRepository()).dismissPurchaseCandidate(businessId, decisionId)
    done(businessId)
    return {}
  } catch (e) {
    console.error('[purchasing] dismiss', e)
    return { error: purchasingError(e, '무시하지 못했습니다.') }
  }
}

// ── 첨부(견적서 · 단가표) ─────────────────────────────────────────────

export interface UploadDocState extends PurchasingState {
  doc?: PurchaseDoc
  /** 배합비로 보여 저장하지 않았다. */
  mix?: boolean
  /** 글자층이 없어 «배합비 아님» 확인이 필요하다. */
  needsAttest?: boolean
}

/**
 * 견적서 · 단가표 올리기. 순서: 형식 · 크기 → 권한 안내 → 바이트 → **배합비 검사(AI 없음)** → 줄 → 파일(0061 5절: 줄이 먼저).
 * 배합비로 보이면 줄도 파일도 만들지 않는다. 사진 · 스캔본(글자층 없음)은 «배합비 · 레시피가 아닙니다» 확인이 있어야 받는다.
 */
export async function uploadPurchaseDocAction(businessId: string, form: FormData): Promise<UploadDocState> {
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const file = form.get('file')
  if (!(file instanceof File)) return { error: '파일이 없습니다.' }
  const mime = purchaseDocMime(file.name, file.type)
  if (!mime) return { error: 'PDF · Excel · Word · CSV · PNG · JPG만 받습니다.' }
  if (file.size < 1 || file.size > PURCHASE_DOC_MAX_BYTES) return { error: '4MB까지 올릴 수 있습니다.' }
  const kind = (PURCHASE_DOC_KINDS as readonly string[]).includes(String(form.get('kind'))) ? (String(form.get('kind')) as PurchaseDocKind) : 'quote'
  const supplierRaw = String(form.get('supplier_id') ?? '')
  const supplier_id = /^sup_[a-z0-9_]{4,60}$/.test(supplierRaw) ? supplierRaw : null
  const attested = form.get('mix_attested') === '1'

  const user = await session()
  if (!user) return EXPIRED
  if (!canWritePurchasing(user, businessId)) return { error: '권한이 없습니다. (구매 입력 권한이 있는 사람만 올릴 수 있습니다)' }

  const bytes = await file.arrayBuffer()
  const screened = await screenPurchaseDoc(bytes, mime)
  if (screened.kind === 'mix') {
    // 근거(열 이름 · 합계)는 로그에도 남기지 않는다 — 배합비 표의 모양 자체가 단서다.
    console.warn(`[purchasing] 배합비로 보여 저장하지 않음 — ${businessId} · ${screened.verdict.rule}`)
    return { error: mixRejectMessage(boss(user.role)), mix: true }
  }
  if (screened.kind === 'unreadable') return { error: screened.message }
  if (screened.kind === 'no_text' && !attested) {
    return {
      error: `${isImageDoc(mime) ? '사진' : '스캔본'}은 글자를 읽지 못해 배합비 검사를 할 수 없습니다 — «배합비 · 레시피가 아닙니다»에 체크해야 올라갑니다.`,
      needsAttest: true,
    }
  }

  const doc_id = randomUUID()
  const file_name = safeDocFileName(file.name)
  const storage_path = `${businessId}/${doc_id}/${storageDocName(file.name)}`
  const repo = await getRepository()
  let doc: PurchaseDoc
  try {
    doc = await repo.createPurchaseDoc(businessId, {
      doc_id,
      kind,
      file_name,
      mime,
      size_bytes: file.size,
      sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
      storage_path,
      supplier_id,
      lot_id: null,
      mix_checked: screened.kind === 'clean',
      mix_attested: screened.kind === 'no_text' && attested,
    })
  } catch (e) {
    console.error('[purchasing] doc row', e)
    return { error: purchasingError(e) }
  }
  try {
    await repo.putPurchaseDocObject(storage_path, bytes, mime)
  } catch (e) {
    console.error('[purchasing] doc bytes', e)
    // 지울 수 없는 표다(0061 — delete 권한 없음). 파일 없는 줄은 무효로 가린다.
    await repo.voidPurchaseDoc(businessId, doc_id, '파일 올리기 실패 — 자동 무효').catch((x) => console.error('[purchasing] doc void', x))
    return { error: '파일을 올리지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
  done(businessId)
  return { doc }
}

export async function voidDocAction(businessId: string, docId: string, reason: string): Promise<PurchasingState> {
  if (!BIZ.test(businessId) || !/^[0-9a-f-]{36}$/.test(docId)) return { error: '찾을 수 없거나 권한이 없습니다.' }
  const why = str(reason, 300)
  if (!why) return { error: '무효 이유를 적으세요.' }
  if (!(await session())) return EXPIRED
  try {
    await (await getRepository()).voidPurchaseDoc(businessId, docId, why)
    done(businessId)
    return {}
  } catch (e) {
    console.error('[purchasing] void doc', e)
    return { error: purchasingError(e, '무효로 하지 못했습니다.') }
  }
}

/** 내려받기 — live는 10분 서명 URL, dummy는 바이트. */
export async function downloadDocAction(
  businessId: string,
  docId: string,
): Promise<PurchasingState & { url?: string; file?: { file_name: string; mime: string; base64: string } }> {
  if (!BIZ.test(businessId) || !/^[0-9a-f-]{36}$/.test(docId)) return { error: '찾을 수 없거나 권한이 없습니다.' }
  if (!(await session())) return EXPIRED
  try {
    const got = await (await getRepository()).downloadPurchaseDoc(businessId, docId)
    if (!got) return { error: '파일을 열 수 없습니다(없거나 볼 권한이 없습니다).' }
    return 'url' in got ? { url: got.url } : { file: got }
  } catch (e) {
    console.error('[purchasing] download', e)
    return { error: purchasingError(e, '파일을 열지 못했습니다.') }
  }
}
