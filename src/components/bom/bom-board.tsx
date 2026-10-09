'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { bomBreakdownAction, bomRealAllowAction, bomSaveAction, bomVoidAction } from '@/app/actions/bom'
import { Alert, BTN, BTN_PRIMARY, FIELD, LABEL, LINK_BTN, Notice, VoidButton, VoidTag } from '@/components/purchasing/shared'
import { NumberInput } from '@/components/ui/number-input'
import { groupDigits } from '@/lib/number-input'
import { krw } from '@/lib/sales/cost'
import type { BomCurrent, BomStatus, BomVersionRow, CostMaterial, CostProduct, ProductBreakdownRow } from '@/types'

/**
 * 대표 BOM(0063 암호문 판) — 회장 전용 화면(서버가 대표 외는 /me로 돌린다).
 *
 * 키 · «진짜 BOM 받기» 스위치 상태 · 제품마다 지금 판(원료 · kg/kg 원래 값) · 원료별 분해(Market · Current, 기여는 1원 표시) · 판 이력 · 새 판 저장.
 * 진짜 BOM은 스위치가 켜졌을 때만(회장 결정 — 운영 반영 · 암호화 확인 뒤). 켜기는 확인 한 번을 더 거친다.
 * **BOM 값은 이 화면과 DB 사이만 오간다** — AI 코드(src/lib/ai)를 부르지 않고, 로그에 싣지 않는다.
 */

const KEY_DOC = 'docs/onboarding/bom-key-setup.md'

/** kg/kg 원래 값(소수 8자리까지 그대로). */
const ratio = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 8 })

interface Row {
  materialId: string
  kg: string
}

export function BomBoard({
  businessId,
  today,
  status,
  statusError,
  products,
  materials,
  current,
  currentErrors,
  versions,
}: {
  businessId: string
  today: string
  status: BomStatus | null
  statusError: string | null
  products: CostProduct[]
  materials: CostMaterial[]
  current: Record<string, BomCurrent | null>
  currentErrors: Record<string, string>
  versions: BomVersionRow[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmReal, setConfirmReal] = useState(false)
  const realAllowed = status?.real_allowed === true

  const activeProducts = products.filter((p) => p.active)
  const [productId, setProductId] = useState(activeProducts[0]?.product_id ?? '')
  const [validFrom, setValidFrom] = useState(today)
  const [yieldPct, setYieldPct] = useState('100')
  const [rows, setRows] = useState<Row[]>([{ materialId: '', kg: '' }])
  const [note, setNote] = useState('')
  const [real, setReal] = useState(false)

  async function run(fn: () => Promise<{ error?: string }>, ok: string) {
    if (busy) return false
    setBusy(true)
    setError(null)
    setNotice(null)
    const r = await fn()
    setBusy(false)
    if (r.error) {
      setError(r.error)
      return false
    }
    setNotice(ok)
    router.refresh()
    return true
  }

  function loadCurrent(pid: string) {
    const c = current[pid]
    setProductId(pid)
    if (!c) return
    setYieldPct(String(c.yield_pct))
    setRows(c.lines.map((l) => ({ materialId: l.material_id, kg: groupDigits(String(l.kg_per_kg), 'number') })))
    setNote('')
  }

  const pName = new Map(products.map((p) => [p.product_id, p.name]))
  const activeMaterials = materials.filter((m) => m.active)

  return (
    <div className="mt-4 space-y-3">
      <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="키 · 스위치">
        {statusError ? (
          <p className="text-t12 text-critical">{statusError}</p>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 text-t12">
              <p>
                BOM 암호 키:{' '}
                {status?.key_ready ? (
                  <b className="text-ok">준비됨</b>
                ) : (
                  <>
                    <b className="text-critical">없음</b> <span className="text-ink-dim">— {KEY_DOC} 순서로 키를 먼저 만드세요</span>
                  </>
                )}
              </p>
              <p>
                진짜 BOM 받기: <b className={realAllowed ? 'text-warning' : 'text-ink-dim'}>{realAllowed ? '켜짐' : '꺼짐'}</b>
                {status?.changed_at ? <span className="text-t10h text-ink-muted"> · 바꾼 때 {status.changed_at.slice(0, 16).replace('T', ' ')}</span> : null}
              </p>
              <p className="text-t10h text-ink-muted">진짜 BOM 입력은 운영 반영 · 암호화 확인 뒤(회장 결정). 꺼져 있으면 가짜 판만 저장됩니다.</p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {realAllowed ? (
                <button type="button" className={BTN} disabled={busy} onClick={() => void run(() => bomRealAllowAction(businessId, false), '진짜 BOM 받기를 껐습니다.')}>
                  진짜 BOM 받기 끄기
                </button>
              ) : confirmReal ? (
                <>
                  <span className="text-t11 text-warning">운영 DB에서 암호화가 확인됐습니까?</span>
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    disabled={busy || !status?.key_ready}
                    onClick={async () => {
                      await run(() => bomRealAllowAction(businessId, true), '진짜 BOM 받기를 켰습니다.')
                      setConfirmReal(false)
                    }}
                  >
                    확인 — 켜기
                  </button>
                  <button type="button" className={LINK_BTN} disabled={busy} onClick={() => setConfirmReal(false)}>
                    취소
                  </button>
                </>
              ) : (
                <button type="button" className={BTN} disabled={busy || !status?.key_ready} onClick={() => setConfirmReal(true)}>
                  진짜 BOM 받기 켜기…
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <Alert text={error} />
      <Notice text={notice} />

      {products.map((p) => (
        <ProductBom
          key={p.product_id}
          businessId={businessId}
          product={p}
          current={current[p.product_id] ?? null}
          currentError={currentErrors[p.product_id] ?? null}
          versions={versions.filter((v) => v.product_id === p.product_id)}
          busy={busy}
          onLoad={() => loadCurrent(p.product_id)}
          onVoid={async (versionId, reason) => {
            const r = await bomVoidAction(businessId, versionId, reason)
            if (!r.error) router.refresh()
            return r.error
          }}
        />
      ))}

      <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="새 판 저장">
        <h2 className="text-t12h font-semibold">새 판 저장</h2>
        <p className="mt-0.5 text-t10h text-ink-muted">
          kg/kg = 제품 1kg에 드는 원료 kg(수율 반영 전). 같은 제품 · 같은 시작일 판이 있으면 그 판을 무효로 하고 새로 씁니다(이력은 남습니다).
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <label className={LABEL}>
            제품
            <select className={`${FIELD} mt-0.5`} value={productId} disabled={busy} onChange={(e) => setProductId(e.target.value)}>
              <option value="">고르세요</option>
              {activeProducts.map((x) => (
                <option key={x.product_id} value={x.product_id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            적용 시작일
            <input type="date" className={`${FIELD} mt-0.5`} value={validFrom} disabled={busy} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
          <label className={LABEL}>
            수율
            <NumberInput kind="number" unit="%" reading={false} className={`${FIELD} mt-0.5`} value={yieldPct} onChange={setYieldPct} disabled={busy} />
          </label>
          <label className={LABEL}>
            메모 (선택)
            <input className={`${FIELD} mt-0.5`} value={note} maxLength={300} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <ul className="mt-2 space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[1fr_10rem_auto] items-end gap-2">
              <label className={LABEL}>
                원료 {i + 1}
                <select
                  className={`${FIELD} mt-0.5`}
                  value={r.materialId}
                  disabled={busy}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)))}
                >
                  <option value="">고르세요</option>
                  {activeMaterials.map((m) => (
                    <option key={m.material_id} value={m.material_id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                kg/kg
                <NumberInput
                  kind="number"
                  reading={false}
                  className={`${FIELD} mt-0.5`}
                  value={r.kg}
                  onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, kg: v } : x)))}
                  disabled={busy}
                  placeholder="예: 0.35"
                />
              </label>
              <button type="button" className={LINK_BTN} disabled={busy || rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                빼기
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} disabled={busy || rows.length >= 200} onClick={() => setRows([...rows, { materialId: '', kg: '' }])}>
            원료 줄 더하기
          </button>
          {realAllowed ? (
            <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink-dim lg:min-h-0">
              <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={real} disabled={busy} onChange={(e) => setReal(e.target.checked)} />
              진짜 BOM
            </label>
          ) : (
            <span className="text-t10h text-ink-muted">가짜 판으로 저장됩니다(진짜 BOM 받기 꺼짐).</span>
          )}
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy || !productId || !validFrom || !yieldPct || !status?.key_ready}
            onClick={async () => {
              const ok = await run(
                () =>
                  bomSaveAction({
                    businessId,
                    productId,
                    validFrom,
                    yieldPct,
                    lines: rows.map((r) => ({ material_id: r.materialId, kg_per_kg: r.kg })),
                    note,
                    isFake: !(realAllowed && real),
                  }),
                `${pName.get(productId) ?? ''} ${validFrom}부터 쓰는 ${realAllowed && real ? '진짜' : '가짜'} 판을 저장했습니다.`,
              )
              if (ok) setReal(false)
            }}
          >
            {busy ? '저장 중…' : '판 저장'}
          </button>
        </div>
      </section>
    </div>
  )
}

function ProductBom({
  businessId,
  product,
  current,
  currentError,
  versions,
  busy,
  onLoad,
  onVoid,
}: {
  businessId: string
  product: CostProduct
  current: BomCurrent | null
  currentError: string | null
  versions: BomVersionRow[]
  busy: boolean
  onLoad: () => void
  onVoid: (versionId: number, reason: string) => Promise<string | undefined>
}) {
  const [kind, setKind] = useState<'market' | 'current' | null>(null)
  const [rows, setRows] = useState<ProductBreakdownRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  async function breakdown(k: 'market' | 'current') {
    if (kind === k) {
      setKind(null)
      return
    }
    setKind(k)
    setRows(null)
    setErr(null)
    const r = await bomBreakdownAction(product.product_id, k)
    if (r.error) setErr(r.error)
    else setRows(r.rows ?? [])
  }

  const total = rows && rows.every((r) => r.contribution_krw_per_kg !== null) ? rows.reduce((t, r) => t + r.contribution_krw_per_kg!, 0) : null

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label={`${product.name} BOM`} data-business={businessId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-t13 font-semibold">
          {product.name}
          {current ? (
            <span
              className={`ml-2 inline-flex rounded-full border px-2 py-0.5 text-t10h font-semibold ${current.is_fake ? 'border-line bg-raised text-ink-dim' : 'border-warning/40 bg-warning/10 text-warning'}`}
            >
              {current.is_fake ? '가짜' : '진짜'}
            </span>
          ) : null}
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={BTN} disabled={busy || !current} aria-pressed={kind === 'market'} onClick={() => void breakdown('market')}>
            분해 · Market
          </button>
          <button type="button" className={BTN} disabled={busy || !current} aria-pressed={kind === 'current'} onClick={() => void breakdown('current')}>
            분해 · Current
          </button>
          <button type="button" className={LINK_BTN} disabled={busy || !current} onClick={onLoad}>
            이 판으로 새 판 쓰기
          </button>
        </div>
      </div>
      {currentError ? (
        <p className="mt-1 text-t12 text-critical">{currentError}</p>
      ) : !current ? (
        <p className="mt-1 text-t12 text-ink-muted">오늘 쓰는 판이 없습니다.</p>
      ) : (
        <>
          <p className="mt-0.5 text-t11 text-ink-dim">
            지금 판 #{current.version_id} · {current.valid_from}부터 · 수율 {current.yield_pct}%
          </p>
          {kind === null ? (
            <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {current.lines.map((l) => (
                <li key={l.material_id} className="flex justify-between gap-3 rounded border border-line-soft px-2 py-1 text-t12">
                  <span>{l.material_name}</span>
                  <span className="tnum font-semibold">{ratio(l.kg_per_kg)} kg/kg</span>
                </li>
              ))}
            </ul>
          ) : err ? (
            <p className="mt-2 text-t12 text-critical">{err}</p>
          ) : rows === null ? (
            <p className="mt-2 text-t11 text-ink-muted">불러오는 중…</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="m-cards w-full text-t12 sm:min-w-[640px]">
                <thead>
                  <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                    <th className="px-2 py-1.5 font-normal">원료</th>
                    <th className="px-2 py-1.5 text-right font-normal">kg/kg</th>
                    <th className="px-2 py-1.5 text-right font-normal">수율 반영 kg</th>
                    <th className="px-2 py-1.5 text-right font-normal">{kind === 'market' ? 'Market 단가' : 'Current 단가'} (원/kg)</th>
                    <th className="px-2 py-1.5 text-right font-normal">기여 (원/kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.material_id} className="border-t border-line-soft">
                      <td className="px-2 py-1.5 font-semibold">{r.material_name}</td>
                      <td className="px-2 py-1.5 text-right tnum" data-label="kg/kg">
                        {ratio(r.kg_per_kg)}
                      </td>
                      <td className="px-2 py-1.5 text-right tnum text-ink-dim" data-label="수율 반영 kg">
                        {ratio(r.qty_kg_per_kg)}
                      </td>
                      <td className="px-2 py-1.5 text-right tnum" data-label="단가">
                        {krw(r.unit_krw_per_kg)}
                      </td>
                      <td className="px-2 py-1.5 text-right tnum font-semibold" data-label="기여">
                        {krw(r.contribution_krw_per_kg)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-line-soft">
                    <td colSpan={4} className="px-2 py-1.5 text-right text-ink-dim">
                      원료비 합(원래 값끼리 더한 뒤 1원)
                    </td>
                    <td className="px-2 py-1.5 text-right tnum font-bold" data-label="합">
                      {krw(total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="mt-2">
        <button type="button" className={LINK_BTN} aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
          판 이력 {versions.length}개 {showHistory ? '접기' : '보기'}
        </button>
        {showHistory ? (
          <ul className="mt-1 space-y-0.5">
            {versions.map((v) => (
              <li key={v.version_id} className={`flex flex-wrap items-center justify-between gap-2 text-t11 ${v.voided_at ? 'text-ink-muted line-through decoration-ink-muted/50' : ''}`}>
                <span>
                  #{v.version_id} · <span className="tnum">{v.valid_from}</span>부터 · 수율 {v.yield_pct}% · {v.is_fake ? '가짜' : '진짜'}
                  {v.note ? ` · ${v.note}` : ''}
                  {v.voided_at ? <VoidTag reason={v.void_reason} /> : null}
                </span>
                {!v.voided_at ? <VoidButton onVoid={(reason) => onVoid(v.version_id, reason)} /> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
