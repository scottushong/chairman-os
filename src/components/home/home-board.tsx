'use client'

import { useEffect, useRef, useState } from 'react'

import { reloadHomeLayout, saveHomeLayout } from '@/app/actions/home'
import { C, Pill } from '@/components/home/ui'
import {
  dropWidget,
  filterOf,
  moveWidget,
  newWidgetId,
  sameLayout,
  SIZE_LABEL,
  WIDGET_SIZES,
  widgetDef,
  type FavoriteOption,
  type HomeWidget,
  type WidgetSize,
} from '@/lib/home/widgets'

import { FavoritesEditor, WidgetContent } from './home-widget'

/**
 * 0086 «내 홈» 위젯 판 — 평소에는 업무만, «홈 편집»을 누르면 추가 · 제거 · 끌어 옮기기 · 앞/뒤 버튼 · 크기 · 저장 · 취소.
 *   편집 중 바뀐 것은 임시(draft) — 저장이 성공해야 배치에 들어간다. 취소 = 편집 직전 그대로. 저장 실패 = 편집 내용 유지 + 다시 시도.
 *   다른 탭 · 기기가 먼저 저장했으면(revision 충돌) 덮어쓰지 않고 «최신 배치 불러오기» · «내 편집으로 덮어쓰기» 중 고르게 한다.
 *   저장하지 않고 나가려 하면 묻는다(창 닫기 · 앱 안 링크).
 *   편집이 아닐 때 표시 범위(필터)를 바꾸면 그 자리에서 저장한다(한 번 바꿈 = 한 번 저장).
 * 배치: 데스크톱 3열 · 태블릿 2열 · 폰 1열(저장한 순서 그대로). 크기 작게 = 1칸 · 넓게 = 2칸 · 전체 폭 = 한 줄.
 */

const SPAN: Record<WidgetSize, string> = { s: 'col-span-1', m: 'col-span-1 sm:col-span-2', l: 'col-span-1 sm:col-span-2 lg:col-span-3' }
const SMALL_BTN = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[#d5d9e0] bg-white px-2 text-[14px] text-[#1f2329] hover:bg-[#f4f6f9] disabled:opacity-40'
const SELECT = 'min-h-11 rounded-md border border-[#d5d9e0] bg-white px-2 text-[14px] text-[#1f2329]'

export function HomeBoard({
  initial,
  unknown: initialUnknown,
  revision: initialRevision,
  usedDefault,
  catalog,
  favorites,
  loadFailed,
}: {
  initial: HomeWidget[]
  unknown: HomeWidget[]
  revision: number
  usedDefault: boolean
  catalog: string[]
  favorites: FavoriteOption[]
  loadFailed: boolean
}) {
  const [saved, setSaved] = useState<HomeWidget[]>(initial)
  const [unknown, setUnknown] = useState<HomeWidget[]>(initialUnknown)
  const [revision, setRevision] = useState(initialRevision)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<HomeWidget[]>(initial)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const dragFrom = useRef<number | null>(null)

  const list = editing ? draft : saved
  const dirty = editing && !sameLayout(draft, saved)

  // 저장하지 않고 나가려 하면 묻는다 — 창 닫기 · 새로고침(beforeunload), 앱 안 링크(클릭 가로채기).
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank') return
      if (!window.confirm('저장하지 않은 홈 편집 내용이 있습니다. 나가면 사라집니다. 나갈까요?')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])

  async function persist(next: HomeWidget[], rev: number): Promise<boolean> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await saveHomeLayout(rev, next, unknown)
      if (r.ok && r.revision) {
        setSaved(next)
        setDraft(next)
        setRevision(r.revision)
        setConflict(false)
        return true
      }
      setConflict(!!r.conflict)
      setError(r.error ?? '저장하지 못했습니다.')
      return false
    } catch {
      setError('저장하지 못했습니다(연결 문제). 편집 내용은 그대로 있습니다 — 다시 시도해 주세요.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (await persist(draft, revision)) {
      setEditing(false)
      setAdding(false)
      setNotice('배치를 저장했습니다.')
    }
  }

  async function loadLatest(keepDraft: boolean) {
    setBusy(true)
    const r = await reloadHomeLayout().catch(() => ({ ok: false as const, error: '최신 배치를 불러오지 못했습니다.' }))
    setBusy(false)
    if (!r.ok || r.revision === undefined) {
      setError(r.error ?? '최신 배치를 불러오지 못했습니다.')
      return
    }
    setRevision(r.revision)
    setSaved(r.widgets ?? [])
    setUnknown(r.unknown ?? [])
    setConflict(false)
    if (keepDraft) {
      // 내 편집으로 덮어쓰기 — 최신 판 번호를 받은 뒤 지금 편집을 다시 저장한다(명시적으로 고른 경우만).
      if (await persist(draft, r.revision)) {
        setEditing(false)
        setNotice('내 편집으로 저장했습니다(다른 탭의 배치를 덮어씀).')
      }
    } else {
      setDraft(r.widgets ?? [])
      setError(null)
      setNotice('최신 배치를 불러왔습니다. 다시 고친 뒤 저장하세요.')
    }
  }

  function startEdit() {
    setDraft(saved)
    setEditing(true)
    setError(null)
    setNotice(null)
  }
  function cancel() {
    setDraft(saved)
    setEditing(false)
    setAdding(false)
    setError(null)
    setConflict(false)
  }
  const patch = (id: string, fn: (w: HomeWidget) => HomeWidget) => setDraft((d) => d.map((w) => (w.id === id ? fn(w) : w)))

  function changeFilter(w: HomeWidget, filter: string) {
    if (editing) {
      patch(w.id, (x) => ({ ...x, settings: { ...x.settings, filter } }))
      return
    }
    void persist(
      saved.map((x) => (x.id === w.id ? { ...x, settings: { ...x.settings, filter } } : x)),
      revision,
    )
  }

  const present = new Set(draft.map((w) => w.kind))

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <section data-testid="edit-bar" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#d9e3fb] bg-[#eef3fd] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-[#1f2329]">내 홈 편집</h2>
            <p className="text-[13px] text-[#4b5563]">위젯을 끌거나 앞·뒤 버튼으로 옮기세요. 크기와 표시 내용도 바꿀 수 있습니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="home-add" onClick={() => setAdding((a) => !a)} className={C.btnLine} aria-expanded={adding}>
              + 위젯 추가
            </button>
            <button type="button" data-testid="home-cancel" onClick={cancel} disabled={busy} className={C.btnLine}>
              취소
            </button>
            <button type="button" data-testid="home-save" onClick={save} disabled={busy} className={C.btn}>
              {busy ? '저장 중…' : '배치 저장'}
            </button>
          </div>
        </section>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-[#6b7280]">{usedDefault && revision === 0 ? '기본 배치입니다. «홈 편집»으로 내게 맞게 바꿀 수 있습니다.' : '내가 저장한 배치입니다.'}</p>
          <button type="button" data-testid="home-edit" onClick={startEdit} disabled={loadFailed || busy} className={C.btnLine}>
            홈 편집
          </button>
        </div>
      )}

      {loadFailed ? <p className="text-[14px] text-[#b4372b]">저장된 배치를 불러오지 못해 기본 배치로 보여 줍니다. 새로고침 뒤 다시 시도해 주세요(지금은 편집을 막습니다).</p> : null}
      {error ? (
        <div role="alert" data-testid="home-error" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#f3c9c4] bg-[#fdecea] px-4 py-3 text-[14px] text-[#b4372b]">
          <span className="min-w-0 flex-1">{error}</span>
          {conflict ? (
            <>
              <button type="button" onClick={() => loadLatest(false)} disabled={busy} className={C.btnLine}>
                최신 배치 불러오기
              </button>
              {editing ? (
                <button type="button" onClick={() => loadLatest(true)} disabled={busy} className={C.btnLine}>
                  내 편집으로 덮어쓰기
                </button>
              ) : null}
            </>
          ) : editing ? (
            <button type="button" onClick={save} disabled={busy} className={C.btnLine}>
              다시 저장
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-[14px] text-[#1f7a4d]">
          {notice}
        </p>
      ) : null}

      {editing && adding ? (
        <section data-testid="add-panel" className={`${C.card} px-4 py-3`}>
          <h3 className="text-[15px] font-semibold text-[#1f2329]">위젯 추가</h3>
          <p className="text-[13px] text-[#6b7280]">내 권한으로 쓸 수 있는 위젯만 보입니다. 같은 위젯은 한 번만 넣습니다.</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((kind) => {
              const def = widgetDef(kind)!
              const has = present.has(kind)
              return (
                <li key={kind} className="flex items-center gap-2 rounded-md border border-[#e3e6eb] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-[#1f2329]">
                      {def.label} {def.link === 'pending' ? <Pill tone="orange">연동 준비 중</Pill> : null}
                    </div>
                    <div className="text-[13px] text-[#6b7280]">{def.description}</div>
                  </div>
                  <button
                    type="button"
                    data-testid={`add-${kind}`}
                    disabled={has}
                    onClick={() =>
                      setDraft((d) => [...d, { id: newWidgetId(kind, d.map((w) => w.id)), kind, size: def.defaultSize, settings: def.filters.length ? { filter: def.filters[0].key } : {} }])
                    }
                    className={SMALL_BTN}
                  >
                    {has ? '추가됨' : '추가'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {list.length === 0 ? (
        <div className={`${C.card} px-4 py-10 text-center text-[14px] text-[#6b7280]`}>위젯이 없습니다. «홈 편집 → + 위젯 추가»로 넣으세요.</div>
      ) : (
        <div data-testid="widget-grid" className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((w, i) => {
            const def = widgetDef(w.kind)
            if (!def) return null
            const usable = catalog.includes(w.kind)
            const filter = filterOf(w)
            return (
              <section
                key={w.id}
                data-testid={`widget-${w.kind}`}
                data-size={w.size}
                aria-label={def.label}
                className={`${SPAN[w.size]} ${C.card} flex min-w-0 flex-col overflow-hidden`}
                draggable={editing}
                onDragStart={(e) => {
                  dragFrom.current = i
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  if (editing && dragFrom.current !== null) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragFrom.current
                  dragFrom.current = null
                  if (from !== null) setDraft((d) => dropWidget(d, from, i))
                }}
              >
                {editing ? (
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-[#eceef2] bg-[#f7f8fa] px-3 py-1.5">
                    <span className="hidden cursor-grab text-[13px] text-[#6b7280] select-none lg:inline" title="끌어서 옮기기">
                      ⠿ 이동
                    </span>
                    <span className="flex-1" />
                    <button type="button" data-testid="move-prev" aria-label={`${def.label} 앞으로`} disabled={i === 0} onClick={() => setDraft((d) => moveWidget(d, i, -1))} className={SMALL_BTN}>
                      앞
                    </button>
                    <button type="button" data-testid="move-next" aria-label={`${def.label} 뒤로`} disabled={i === list.length - 1} onClick={() => setDraft((d) => moveWidget(d, i, 1))} className={SMALL_BTN}>
                      뒤
                    </button>
                    <select data-testid="size" aria-label={`${def.label} 크기`} value={w.size} onChange={(e) => patch(w.id, (x) => ({ ...x, size: e.target.value as WidgetSize }))} className={SELECT}>
                      {WIDGET_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {SIZE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <button type="button" data-testid="remove" aria-label={`${def.label} 제거`} onClick={() => setDraft((d) => d.filter((x) => x.id !== w.id))} className={SMALL_BTN}>
                      제거
                    </button>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
                  <h2 className="min-w-0 truncate text-[16px] font-semibold text-[#1f2329]">{def.label}</h2>
                  {def.filters.length && usable ? (
                    <select data-testid="filter" aria-label={`${def.label} 표시 범위`} value={filter} disabled={busy} onChange={(e) => changeFilter(w, e.target.value)} className={SELECT}>
                      {def.filters.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                {!usable ? (
                  <div data-state="denied" className="px-4 py-4 text-[14px] text-[#6b7280]">
                    <Pill tone="gray">권한 없음</Pill> <span className="ml-1">이 위젯을 쓸 수 없는 계정입니다. 편집에서 제거할 수 있습니다.</span>
                  </div>
                ) : editing && w.kind === 'favorites' ? (
                  <FavoritesEditor items={w.settings.items ?? []} options={favorites} onChange={(items) => patch(w.id, (x) => ({ ...x, settings: { ...x.settings, items } }))} />
                ) : (
                  <WidgetContent widget={w} def={def} favorites={favorites} />
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
