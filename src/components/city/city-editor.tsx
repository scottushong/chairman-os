'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { promoteCityLot, saveCityLayout } from '@/app/actions/city'
import { Icon } from '@/components/ui/icon'
import { CITY_ASPECT, citySrc, citySrcSet, clampBox, type CityPhase } from '@/lib/city'
import { CITY_STAGE, CITY_STAGE_LABEL_KO, type CityLayout, type CityStage } from '@/types'

/**
 * /group/edit — 회장이 핫스팟을 드래그로 옮기고 모서리로 크기를 바꾼다 (Phase 8 G-1).
 *
 * **저장은 한 번에.** 드래그할 때마다 저장하면 한 번 옮기는 데 감사 줄이 수십 개 생긴다.
 * 여기서 바꾼 것을 모아 두었다가 «저장»에서 옮긴 것 · 더한 것 · 뺀 것을 한꺼번에 보낸다.
 *
 * 좌표는 그림에 대한 %다. 포인터가 움직인 픽셀을 그림 상자의 폭·높이로 나눠 %로 바꾸고,
 * 그림 밖으로 나가지 않게 clampBox로 가둔다(0037 city_layout_box_check와 같은 판정).
 */

interface Owner {
  id: string
  name: string
}

type Row = CityLayout

type Drag = {
  id: number
  mode: 'move' | 'resize'
  startX: number
  startY: number
  box: { x: number; y: number; w: number; h: number }
}

const NEW_BOX = { x: 44, y: 40, w: 10, h: 16 }

export function CityEditor({
  phase,
  layout,
  businesses,
  initiatives,
}: {
  phase: CityPhase
  layout: CityLayout[]
  businesses: Owner[]
  initiatives: Owner[]
}) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(layout)
  const [deletes, setDeletes] = useState<number[]>([])
  const [selected, setSelected] = useState<number | null>(layout[0]?.id ?? null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [promoteTo, setPromoteTo] = useState('')
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  // 새 줄은 음수 id로 들고 있다가 저장할 때 id 없이 보낸다.
  const tempId = useRef(-1)

  const nameOf = (r: Row) =>
    r.business_id !== null
      ? (businesses.find((b) => b.id === r.business_id)?.name ?? r.business_id)
      : (initiatives.find((i) => i.id === r.initiative_id)?.name ?? r.initiative_id ?? '?')

  const placedBusiness = new Set(rows.map((r) => r.business_id).filter(Boolean))
  const placedInitiative = new Set(rows.map((r) => r.initiative_id).filter(Boolean))
  const freeBusinesses = businesses.filter((b) => !placedBusiness.has(b.id))
  const freeInitiatives = initiatives.filter((i) => !placedInitiative.has(i.id))
  const current = rows.find((r) => r.id === selected) ?? null

  function patch(id: number, next: Partial<Row>) {
    setRows((all) => all.map((r) => (r.id === id ? { ...r, ...next } : r)))
    setDirty(true)
  }

  function onPointerDown(e: React.PointerEvent, row: Row, mode: Drag['mode']) {
    e.preventDefault()
    e.stopPropagation()
    setSelected(row.id)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: row.id, mode, startX: e.clientX, startY: e.clientY, box: { x: row.x, y: row.y, w: row.w, h: row.h } }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    const rect = frame.current?.getBoundingClientRect()
    if (!d || !rect) return
    const dx = ((e.clientX - d.startX) / rect.width) * 100
    const dy = ((e.clientY - d.startY) / rect.height) * 100
    const next =
      d.mode === 'move'
        ? { ...d.box, x: d.box.x + dx, y: d.box.y + dy }
        : { ...d.box, w: d.box.w + dx, h: d.box.h + dy }
    patch(d.id, clampBox(next))
  }

  function onPointerUp() {
    drag.current = null
  }

  function add(owner: { business_id: string | null; initiative_id: string | null }) {
    const id = tempId.current--
    setRows((all) => [...all, { id, ...owner, ...NEW_BOX, stage_image: null }])
    setSelected(id)
    setDirty(true)
  }

  function remove(id: number) {
    setRows((all) => all.filter((r) => r.id !== id))
    if (id > 0) setDeletes((d) => [...d, id])
    setSelected(null)
    setDirty(true)
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await saveCityLayout({
        upserts: rows.map((r) => ({ ...r, id: r.id > 0 ? r.id : undefined })),
        deletes,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setDirty(false)
      setDeletes([])
      router.refresh()
    })
  }

  function promote(id: number) {
    setError(null)
    startTransition(async () => {
      const result = await promoteCityLot(id, promoteTo)
      if (result.error) {
        setError(result.error)
        return
      }
      setPromoteTo('')
      router.refresh()
    })
  }

  return (
    <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div
        ref={frame}
        className="relative w-full touch-none overflow-hidden rounded-glass select-none"
        style={{ aspectRatio: `${1 / CITY_ASPECT}` }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 폭 셋을 미리 만들어 두었다(city-map.tsx). */}
        <img
          src={citySrc(phase)}
          srcSet={citySrcSet(phase)}
          sizes="(min-width: 1024px) 70vw, 100vw"
          alt="그룹 시티 전경"
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
        {rows.map((r) => {
          const active = r.id === selected
          const lot = r.initiative_id !== null
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              aria-label={`${nameOf(r)} 자리 — 끌어서 옮긴다`}
              onPointerDown={(e) => onPointerDown(e, r, 'move')}
              onKeyDown={(e) => {
                // 키보드로도 옮긴다. 한 번에 0.5%, Shift는 2%.
                const step = e.shiftKey ? 2 : 0.5
                const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
                if (!move) return
                e.preventDefault()
                patch(r.id, clampBox({ x: r.x + move[0], y: r.y + move[1], w: r.w, h: r.h }))
              }}
              onFocus={() => setSelected(r.id)}
              className={`absolute cursor-move rounded-lg border-2 ${
                active ? 'border-gold bg-gold/15' : lot ? 'border-dashed border-white/80 bg-black/10' : 'border-white/80 bg-black/10'
              }`}
              style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
            >
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/70 px-1.5 py-0.5 text-t11 text-white">
                {lot ? '터 · ' : ''}
                {nameOf(r)}
              </span>
              <span
                aria-hidden
                onPointerDown={(e) => onPointerDown(e, r, 'resize')}
                className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-gold"
              />
            </div>
          )
        })}
      </div>

      <aside className="glass space-y-4 rounded-glass p-4 text-t12h">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || pending}
            className="flex-1 rounded-lg bg-accent px-3 py-2 font-semibold text-white transition-opacity disabled:opacity-40"
          >
            {pending ? '저장 중…' : dirty ? '저장' : '저장됨'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/group')}
            className="rounded-lg border border-line bg-raised px-3 py-2 text-ink-dim hover:text-ink"
          >
            보기로
          </button>
        </div>
        {error ? (
          <p role="alert" className="rounded-md border border-critical/40 bg-raised px-2 py-1.5 text-critical">
            {error}
          </p>
        ) : null}

        {current ? (
          <section className="space-y-2 rounded-lg border border-line-soft bg-raised p-3">
            <p className="font-semibold">{nameOf(current)}</p>
            <p className="text-t11 text-ink-muted tnum">
              x {current.x} · y {current.y} · 폭 {current.w} · 높이 {current.h} (%)
            </p>
            {current.business_id !== null ? (
              <label className="block">
                <span className="text-t11 text-ink-dim">단계 그림</span>
                <select
                  value={current.stage_image ?? ''}
                  onChange={(e) => patch(current.id, { stage_image: (e.target.value || null) as CityStage | null })}
                  className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5"
                >
                  <option value="">자동 (완성도에서)</option>
                  {CITY_STAGE.map((s) => (
                    <option key={s} value={s}>
                      {CITY_STAGE_LABEL_KO[s]}로 고정
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="space-y-1.5">
                <span className="text-t11 text-ink-dim">회사로 승격 — 같은 자리에 기초가 섭니다</span>
                <div className="flex gap-1.5">
                  <select
                    value={promoteTo}
                    onChange={(e) => setPromoteTo(e.target.value)}
                    disabled={current.id < 0 || dirty}
                    className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1.5"
                  >
                    <option value="">회사 고르기</option>
                    {freeBusinesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => promote(current.id)}
                    disabled={!promoteTo || current.id < 0 || dirty || pending}
                    className="rounded-md bg-accent px-2.5 py-1.5 font-semibold text-white disabled:opacity-40"
                  >
                    승격
                  </button>
                </div>
                {current.id < 0 || dirty ? (
                  <p className="text-t11 text-ink-muted">먼저 저장한 뒤 승격할 수 있습니다.</p>
                ) : freeBusinesses.length === 0 ? (
                  <p className="text-t11 text-ink-muted">
                    도시에 자리가 없는 회사가 없습니다. 새 회사는 대시보드의 «기업 추가»로 먼저 만듭니다.
                  </p>
                ) : null}
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(current.id)}
              className="flex items-center gap-1 text-t11h text-ink-dim hover:text-critical"
            >
              <Icon name="eye-off" className="size-3.5" />
              도시에서 빼기 (회사 · 이니셔티브는 그대로)
            </button>
          </section>
        ) : (
          <p className="text-ink-dim">상자를 누르면 여기서 단계와 승격을 고릅니다. 끌어서 옮기고, 오른쪽 아래 모서리로 크기를 바꿉니다.</p>
        )}

        <section>
          <p className="mb-1 text-t11 font-semibold text-ink-dim">자리가 없는 회사</p>
          {freeBusinesses.length === 0 ? (
            <p className="text-t11 text-ink-muted">모두 배치됐습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {freeBusinesses.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => add({ business_id: b.id, initiative_id: null })}
                  className="rounded-md border border-line bg-panel px-2 py-1 hover:border-accent"
                >
                  + {b.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <p className="mb-1 text-t11 font-semibold text-ink-dim">터가 없는 이니셔티브 (진행 중)</p>
          {freeInitiatives.length === 0 ? (
            <p className="text-t11 text-ink-muted">없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {freeInitiatives.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => add({ business_id: null, initiative_id: i.id })}
                  className="rounded-md border border-dashed border-line bg-panel px-2 py-1 hover:border-accent"
                >
                  + 터 · {i.name}
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  )
}
