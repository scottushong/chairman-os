'use client'

import { useState } from 'react'

import { saveMaterialAction } from '@/app/actions/purchasing'
import { Icon } from '@/components/ui/icon'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL_KO, type CostMaterial, type MaterialCategory } from '@/types'

import { Alert, BTN, BTN_PRIMARY, FIELD, LABEL, LINK_BTN, Notice } from './shared'

/**
 * 원료 마스터 — 이름 · 규격 · 분류 · 사용 · 메모(0061 cost_materials). **배합 · 투입 비율 칸은 없다** — 넣을 자리 자체가 없다.
 * canEdit은 안내다. 문은 0061 cost_materials_insert/update(구매 입력).
 */

interface Draft {
  id?: string
  name: string
  spec: string
  category: MaterialCategory
  active: boolean
  note: string
}

const EMPTY: Draft = { name: '', spec: '', category: 'main', active: true, note: '' }

export function MaterialsManager({
  businessId,
  materials,
  canEdit,
  bossWord,
}: {
  businessId: string
  materials: CostMaterial[]
  canEdit: boolean
  /** 보는 사람의 호칭(직원 = 대표). */
  bossWord: string
}) {
  const [list, setList] = useState(materials)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const inactive = list.filter((m) => !m.active).length
  const visible = list.filter((m) => showInactive || m.active)

  async function save() {
    if (!draft || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const r = await saveMaterialAction({ businessId, materialId: draft.id, ...draft })
    setBusy(false)
    if (r.error || !r.material) {
      setError(r.error ?? '저장하지 못했습니다.')
      return
    }
    const saved = r.material
    setList((l) => [...l.filter((m) => m.material_id !== saved.material_id), saved].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    setNotice(`${saved.name} — 저장했습니다.`)
    setDraft(null)
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-t11h text-ink-dim">
          <span className="tnum">{list.length - inactive}</span>개 사용 중
          {inactive > 0 ? (
            <>
              {' '}· <span className="tnum">{inactive}</span>개 사용 안 함{' '}
              <button type="button" className={LINK_BTN} onClick={() => setShowInactive((v) => !v)}>
                {showInactive ? '숨기기' : '보기'}
              </button>
            </>
          ) : null}
        </p>
        {canEdit && !draft ? (
          <button type="button" className={BTN} onClick={() => setDraft(EMPTY)}>
            <Icon name="plus" className="size-3" />
            원료 추가
          </button>
        ) : null}
      </div>

      <Alert text={error} />
      <Notice text={notice} />

      {draft ? (
        <section className="rounded-xl border border-line-soft bg-panel p-3">
          <h2 className="text-t12h font-semibold">{draft.id ? '원료 고치기' : '새 원료'}</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <label className={LABEL}>
              이름
              <input
                className={`${FIELD} mt-0.5`}
                value={draft.name}
                maxLength={120}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              규격
              <input
                className={`${FIELD} mt-0.5`}
                value={draft.spec}
                maxLength={200}
                placeholder="예: 분말 · 25kg 포대"
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, spec: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              분류
              <select
                className={`${FIELD} mt-0.5`}
                value={draft.category}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as MaterialCategory })}
              >
                {MATERIAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {MATERIAL_CATEGORY_LABEL_KO[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-1.5 self-end text-t12 lg:min-h-0 lg:pb-1">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={draft.active}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              사용
            </label>
          </div>
          <label className={`${LABEL} mt-2`}>
            메모
            <textarea
              className={`${FIELD} mt-0.5 min-h-16`}
              value={draft.note}
              maxLength={500}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <p className="mt-1 text-t10h text-ink-muted">
            배합 · 투입 비율은 여기 적지 않습니다 — {bossWord}만 다루는 비공개 원가 장부에 있습니다.
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={save}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" className={LINK_BTN} disabled={busy} onClick={() => setDraft(null)}>
              취소
            </button>
          </div>
        </section>
      ) : null}

      {list.length === 0 ? (
        <section className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center">
          <p className="text-t13 text-ink-dim">원료가 아직 없습니다.</p>
          {canEdit ? <p className="mt-1 text-t11h text-ink-muted">«원료 추가»로 넣으면 시장가 · 구매 LOT에서 고를 수 있습니다.</p> : null}
        </section>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent">
          <table className="m-cards w-full text-t12 sm:min-w-[680px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                <th className="px-3 py-2 font-normal">이름</th>
                <th className="px-3 py-2 font-normal">규격</th>
                <th className="px-3 py-2 font-normal">분류</th>
                <th className="px-3 py-2 font-normal">메모</th>
                <th className="px-3 py-2 text-right font-normal">{canEdit ? '관리' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.material_id} className={`border-t border-line-soft ${m.active ? '' : 'text-ink-muted'}`}>
                  <td className="px-3 py-1.5 max-sm:font-semibold">
                    <span>
                      {m.name}
                      {!m.active ? <span className="ml-1.5 rounded border border-line px-1 text-t9h">사용 안 함</span> : null}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-dim" data-label="규격">
                    {m.spec || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-ink-dim" data-label="분류">
                    {MATERIAL_CATEGORY_LABEL_KO[m.category]}
                  </td>
                  <td className="px-3 py-1.5 text-t11 text-ink-muted" data-label="메모">
                    {m.note || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right" data-label={canEdit ? '관리' : undefined}>
                    {canEdit ? (
                      <button
                        type="button"
                        className={LINK_BTN}
                        disabled={busy}
                        onClick={() => {
                          setError(null)
                          setDraft({ id: m.material_id, name: m.name, spec: m.spec, category: m.category, active: m.active, note: m.note })
                        }}
                      >
                        고치기
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
