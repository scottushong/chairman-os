'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { reloadBoard, saveBoardLayout } from '@/app/actions/home'
import {
  addSection,
  addWidget,
  effectiveScope,
  moveSection,
  nudgeWidget,
  patchSection,
  patchWidget,
  removeSection,
  removeWidget,
  renameSection,
  sameBoard,
  transferWidget,
  MAX_SECTIONS,
  type BoardSection,
} from '@/lib/home/board'
import { filterOf, SIZE_LABEL, WIDGET_GROUPS, WIDGET_SIZES, widgetDef, type FavoriteOption, type HomeWidget, type Scope, type WidgetGroup, type WidgetSize } from '@/lib/home/widgets'

import { FavoritesEditor, WidgetContent } from './home-widget'

/**
 * 0097 구역 · 위젯 판(0086 «내 홈» 판을 넓힌 것) — 대표 첫 화면(/)과 직원 홈(/home)이 같이 쓴다. 시안 docs/design/chairman-os-custom-sections-edit-mode.png.
 *   평소     구역 머리(이름 · 범위 · 접기) + 위젯. 손잡이 · 점선 · 라이브러리는 없다.
 *   편집 모드 구역 만들기 · 이름 바꾸기 · 앞뒤 · 숨김 · 범위(회사 · 프로젝트) · 지우기 / 위젯 추가(라이브러리) · 제거 · 끌어 옮기기(구역 사이도) ·
 *            앞뒤 버튼 · 다른 구역으로 · 크기 · 위젯 범위 덮어쓰기 / 되돌리기 · 취소 · 저장 · 기본 배치로.
 *            편집 중 바뀐 것은 임시(draft) — 저장이 성공해야 배치에 들어간다. 저장 실패 = 편집 내용 유지. 충돌 = 0086 규칙(최신 불러오기 · 덮어쓰기).
 *   폰       끌기 없이 앞뒤 버튼 · 구역 접기/펼치기. 평소 접기 · 표시 범위(필터)는 그 자리에서 저장한다(한 번 바꿈 = 한 번 저장).
 * 위젯을 지우는 것은 배치에서 빼는 것뿐 — 원본 데이터와 무관하다.
 */

const SPAN: Record<WidgetSize, string> = { s: 'col-span-1', m: 'col-span-1 sm:col-span-2', l: 'col-span-1 sm:col-span-2 lg:col-span-3' }
const BTN = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2.5 text-t13 text-ink hover:border-accent disabled:opacity-40'
const BTN_MAIN = 'inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-accent px-4 text-t14 font-semibold text-on-accent hover:bg-accent/90 disabled:opacity-50'
// 0098 시안 «편집 모드» — 금색 테두리 + 옅은 금색 면(주 버튼 «저장하기»는 진녹 채움, 보조 «취소»는 흰 바탕 테두리).
const BTN_EDIT = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-gold bg-gold/10 px-4 text-t14 font-semibold text-gold hover:bg-gold/15 disabled:opacity-50'
const SELECT = 'min-h-11 max-w-full rounded-lg border border-line bg-raised px-2 text-t13 text-ink'
type DragRef = { current: { section: string; index: number } | null }

const CARD = 'rounded-glass border border-line bg-panel shadow-[0_2px_10px_var(--color-glass-shadow)]'

export interface BoardOption {
  id: string
  name: string
  biz?: string
}

export function HomeBoard({
  initial,
  revision: initialRevision,
  usedDefault,
  library,
  addable,
  favorites,
  loadFailed,
  defaults,
  businesses,
  projects,
  title,
  sub,
  aside,
  top,
}: {
  initial: BoardSection[]
  revision: number
  usedDefault: boolean
  /** 라이브러리에 보일 종류(준비 중 포함). */
  library: string[]
  /** 넣을 수 있는 종류. */
  addable: string[]
  favorites: FavoriteOption[]
  loadFailed: boolean
  /** «기본 배치로»가 쓸 배치(서버가 역할로 정함). */
  defaults: BoardSection[]
  businesses: BoardOption[]
  projects: BoardOption[]
  title: ReactNode
  sub?: ReactNode
  /** 머리 오른쪽(날짜 등). */
  aside?: ReactNode
  /** 머리 아래 · 구역 위(편집 밖 — 필수 공지 · 긴급 띠). */
  top?: ReactNode
}) {
  const [saved, setSaved] = useState<BoardSection[]>(initial)
  const [revision, setRevision] = useState(initialRevision)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<BoardSection[]>(initial)
  const [history, setHistory] = useState<BoardSection[][]>([])
  const [libFor, setLibFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const dragRef = useRef<{ section: string; index: number } | null>(null)

  const list = editing ? draft : saved
  const dirty = editing && !sameBoard(draft, saved)

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
      if (!window.confirm('저장하지 않은 편집 내용이 있습니다. 나가면 사라집니다. 나갈까요?')) {
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

  /** 편집 한 걸음 — 앞 상태를 되돌리기 칸에 쌓는다. */
  function change(fn: (d: BoardSection[]) => BoardSection[]) {
    const next = fn(draft)
    if (sameBoard(next, draft)) return
    setHistory((h) => [...h.slice(-49), draft])
    setDraft(next)
  }
  function undo() {
    const last = history.at(-1)
    if (!last) return
    setDraft(last)
    setHistory(history.slice(0, -1))
  }

  async function persist(next: BoardSection[], rev: number): Promise<boolean> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await saveBoardLayout(rev, next)
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
      setLibFor(null)
      setHistory([])
      setNotice('배치를 저장했습니다.')
    }
  }

  async function loadLatest(keepDraft: boolean) {
    setBusy(true)
    const r = await reloadBoard().catch(() => ({ ok: false as const, error: '최신 배치를 불러오지 못했습니다.' }))
    setBusy(false)
    if (!r.ok || r.revision === undefined) {
      setError(r.error ?? '최신 배치를 불러오지 못했습니다.')
      return
    }
    setRevision(r.revision)
    setSaved(r.sections ?? [])
    setConflict(false)
    if (keepDraft) {
      if (await persist(draft, r.revision)) {
        setEditing(false)
        setHistory([])
        setNotice('내 편집으로 저장했습니다(다른 탭의 배치를 덮어씀).')
      }
    } else {
      setDraft(r.sections ?? [])
      setHistory([])
      setError(null)
      setNotice('최신 배치를 불러왔습니다. 다시 고친 뒤 저장하세요.')
    }
  }

  function startEdit() {
    setDraft(saved)
    setHistory([])
    setEditing(true)
    setError(null)
    setNotice(null)
  }
  function cancel() {
    setDraft(saved)
    setHistory([])
    setEditing(false)
    setLibFor(null)
    setError(null)
    setConflict(false)
    setNotice('편집을 취소했습니다(저장된 배치 그대로).')
  }
  function restoreDefault() {
    change(() => defaults.map((s) => ({ ...s, widgets: s.widgets.filter((w) => addable.includes(w.kind)) })))
    setNotice('기본 배치를 불러왔습니다 — «저장하기»를 눌러야 반영됩니다.')
  }

  /** 편집이 아닐 때의 바꿈(표시 범위 · 접기) — 그 자리에서 저장. */
  function quick(fn: (d: BoardSection[]) => BoardSection[]) {
    if (editing) change(fn)
    else void persist(fn(saved), revision)
  }

  const sectionOptions = list.map((s) => ({ id: s.id, title: s.title }))
  const target = libFor ? draft.find((s) => s.id === libFor) : null

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-t22 font-bold tracking-tight break-words text-ink">{title}</h1>
            {sub ? <div className="mt-0.5 text-t13 text-ink-dim">{sub}</div> : null}
          </div>
          {editing ? (
            <div data-testid="edit-bar" className="flex flex-wrap items-center gap-2">
              <span className={BTN_EDIT} aria-current="true">
                ✎ 편집 모드
              </span>
              <button type="button" data-testid="board-undo" onClick={undo} disabled={!history.length || busy} className={BTN} title="한 걸음 되돌리기">
                ↶ 되돌리기
              </button>
              <button type="button" data-testid="home-cancel" onClick={cancel} disabled={busy} className={BTN}>
                취소
              </button>
              <button type="button" data-testid="home-save" onClick={save} disabled={busy} className={BTN_MAIN}>
                {busy ? '저장 중…' : '저장하기'}
              </button>
            </div>
          ) : (
            <button type="button" data-testid="home-edit" onClick={startEdit} disabled={loadFailed || busy} className={BTN_EDIT}>
              ✎ 편집 모드
            </button>
          )}
        </div>
        {aside ? <div className="text-t13 text-ink-dim tnum">{aside}</div> : null}
      </header>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-glass border border-dashed border-accent/50 bg-accent-soft/70 px-3 py-2 text-t13 text-ink-dim">
          <span className="min-w-0 flex-1">구역과 위젯을 끌어 옮기거나(PC) 앞·뒤 버튼으로 옮기세요. 바꾼 것은 «저장하기»를 눌러야 반영됩니다.</span>
          <button type="button" data-testid="home-add" onClick={() => setLibFor((v) => (v ? null : (draft[0]?.id ?? null)))} disabled={!draft.length} className={BTN} aria-expanded={!!libFor}>
            ▦ 위젯 라이브러리
          </button>
          <button type="button" data-testid="board-default" onClick={restoreDefault} disabled={busy} className={BTN}>
            기본 배치로
          </button>
        </div>
      ) : (
        <p className="text-t13 text-ink-muted">{usedDefault && revision === 0 ? '기본 배치입니다. «편집 모드»로 구역과 위젯을 내게 맞게 바꿀 수 있습니다.' : '내가 저장한 배치입니다.'}</p>
      )}

      {loadFailed ? <p className="text-t14 text-critical">저장된 배치를 불러오지 못해 기본 배치로 보여 줍니다. 새로고침 뒤 다시 시도해 주세요(지금은 편집을 막습니다).</p> : null}
      {error ? (
        <div role="alert" data-testid="home-error" className="flex flex-wrap items-center gap-2 rounded-glass border border-critical/40 bg-critical/10 px-4 py-3 text-t14 text-critical">
          <span className="min-w-0 flex-1">{error}</span>
          {conflict ? (
            <>
              <button type="button" onClick={() => loadLatest(false)} disabled={busy} className={BTN}>
                최신 배치 불러오기
              </button>
              {editing ? (
                <button type="button" onClick={() => loadLatest(true)} disabled={busy} className={BTN}>
                  내 편집으로 덮어쓰기
                </button>
              ) : null}
            </>
          ) : editing ? (
            <button type="button" onClick={save} disabled={busy} className={BTN}>
              다시 저장
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p role="status" data-testid="home-notice" className="text-t14 text-ok">
          {notice}
        </p>
      ) : null}

      {top}

      <div className={editing && target ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]' : ''}>
        <div data-testid="board" className="flex min-w-0 flex-col gap-4">
          {list.length === 0 ? (
            <div className={`${CARD} px-4 py-10 text-center text-t14 text-ink-dim`}>구역이 없습니다. «편집 모드 → 새 구역 만들기»로 넣으세요.</div>
          ) : null}
          {list.map((s, si) =>
            !editing && s.hidden ? null : (
              <div key={s.id} className="flex flex-col gap-4">
                <SectionBox
                  section={s}
                  index={si}
                  count={list.length}
                  editing={editing}
                  busy={busy}
                  addable={addable}
                  favorites={favorites}
                  businesses={businesses}
                  projects={projects}
                  sectionOptions={sectionOptions}
                  libOpen={libFor === s.id}
                  onLibrary={() => setLibFor((v) => (v === s.id ? null : s.id))}
                  change={change}
                  quick={quick}
                  dragRef={dragRef}
                />
                {editing && draft.length < MAX_SECTIONS ? (
                  <button
                    type="button"
                    data-testid={`add-section-${si}`}
                    onClick={() => change((d) => addSection(d, '새 구역', si + 1))}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-glass border border-dashed border-accent/50 bg-accent-soft/60 text-t14 font-semibold text-accent hover:bg-accent-soft"
                  >
                    ⊕ 새 구역 만들기
                  </button>
                ) : null}
              </div>
            ),
          )}
          {editing && draft.length === 0 ? (
            <button type="button" data-testid="add-section-first" onClick={() => change((d) => addSection(d, '새 구역'))} className={BTN}>
              ⊕ 새 구역 만들기
            </button>
          ) : null}
        </div>

        {editing && target ? (
          <Library
            target={target}
            sections={sectionOptions}
            library={library}
            addable={addable}
            onTarget={setLibFor}
            onAdd={(kind) => change((d) => addWidget(d, target.id, kind))}
            onClose={() => setLibFor(null)}
          />
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 구역 */

function scopeLabel(scope: Scope, businesses: BoardOption[], projects: BoardOption[]): string {
  const biz = !scope.biz || scope.biz === 'all' ? '전체 계열사' : (businesses.find((b) => b.id === scope.biz)?.name ?? scope.biz)
  const pj = scope.project ? projects.find((p) => p.id === scope.project)?.name : null
  return pj ? `${biz} · ${pj}` : biz
}

function ScopePicker({ value, businesses, projects, onChange, inherit, label, withProject = true }: { value: Scope | undefined; businesses: BoardOption[]; projects: BoardOption[]; onChange: (s: Scope | undefined) => void; inherit?: string; label: string; withProject?: boolean }) {
  const biz = value?.biz ?? (inherit ? '' : 'all')
  const pjs = projects.filter((p) => !value?.biz || value.biz === 'all' || p.biz === value.biz)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label={`${label} 회사 범위`}
        data-testid="scope-biz"
        value={biz}
        onChange={(e) => onChange(e.target.value === '' ? undefined : { biz: e.target.value })}
        className={SELECT}
      >
        {inherit ? <option value="">구역 따름({inherit})</option> : null}
        <option value="all">전체 계열사</option>
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {withProject && pjs.length && (value || !inherit) ? (
        <select
          aria-label={`${label} 프로젝트 범위`}
          data-testid="scope-project"
          value={value?.project ?? ''}
          onChange={(e) => onChange({ biz: value?.biz ?? 'all', ...(e.target.value ? { project: e.target.value } : {}) })}
          className={SELECT}
        >
          <option value="">프로젝트 전체</option>
          {pjs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
    </span>
  )
}

function SectionBox({
  section: s,
  index,
  count,
  editing,
  busy,
  addable,
  favorites,
  businesses,
  projects,
  sectionOptions,
  libOpen,
  onLibrary,
  change,
  quick,
  dragRef,
}: {
  section: BoardSection
  index: number
  count: number
  editing: boolean
  busy: boolean
  addable: string[]
  favorites: FavoriteOption[]
  businesses: BoardOption[]
  projects: BoardOption[]
  sectionOptions: { id: string; title: string }[]
  libOpen: boolean
  onLibrary: () => void
  change: (fn: (d: BoardSection[]) => BoardSection[]) => void
  quick: (fn: (d: BoardSection[]) => BoardSection[]) => void
  dragRef: DragRef
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(s.title)
  const [over, setOver] = useState(false)
  const shown = s.widgets.filter((w) => !!widgetDef(w.kind))
  const dropTo = (index?: number) => {
    const from = dragRef.current
    dragRef.current = null
    setOver(false)
    if (from) change((d) => transferWidget(d, from, { section: s.id, index }).sections)
  }

  return (
    <section
      data-testid={`section-${s.id}`}
      data-hidden={s.hidden ? '1' : undefined}
      data-collapsed={s.collapsed ? '1' : undefined}
      aria-label={s.title}
      className={`${CARD} flex min-w-0 flex-col gap-3 p-3 sm:p-4 ${editing ? 'border-dashed border-accent/50' : ''} ${s.hidden ? 'opacity-60' : ''} ${over ? 'ring-2 ring-accent/50' : ''}`}
      onDragOver={(e) => {
        if (editing && dragRef.current) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        dropTo()
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <span className="hidden cursor-grab text-t16 text-ink-muted select-none lg:inline" title="구역은 위·아래 버튼으로 옮깁니다" aria-hidden>
            ⠿
          </span>
        ) : null}
        {editing && renaming ? (
          <form
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              change((d) => renameSection(d, s.id, name))
              setRenaming(false)
            }}
          >
            <input data-testid="section-title" aria-label="구역 이름" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-2 text-t16 text-ink" autoFocus />
            <button type="submit" className={BTN}>
              확인
            </button>
          </form>
        ) : (
          <h2 className="flex min-w-0 items-center gap-1.5 text-t18 font-bold text-ink">
            <span className="min-w-0 truncate">{s.title}</span>
            {editing ? (
              <button type="button" data-testid="section-rename" aria-label={`${s.title} 이름 바꾸기`} onClick={() => (setName(s.title), setRenaming(true))} className={BTN}>
                ✎
              </button>
            ) : null}
          </h2>
        )}
        <span data-testid="section-scope" className="rounded-full border border-line-soft bg-raised px-2.5 py-1 text-t13 text-ink-dim">
          {scopeLabel(s.scope, businesses, projects)}
        </span>
        {s.hidden ? <span className="rounded-full bg-raised px-2 py-1 text-t13 text-ink-muted">숨김</span> : null}
        <span className="flex-1" />
        <button
          type="button"
          data-testid="section-collapse"
          aria-expanded={!s.collapsed}
          aria-label={`${s.title} ${s.collapsed ? '펼치기' : '접기'}`}
          disabled={busy}
          onClick={() => quick((d) => patchSection(d, s.id, (x) => ({ ...x, collapsed: !x.collapsed })))}
          className={BTN}
        >
          {s.collapsed ? '▸ 펼치기' : '▾ 접기'}
        </button>
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-raised/60 p-2">
          <button type="button" data-testid="section-up" aria-label={`${s.title} 위로`} disabled={index === 0} onClick={() => change((d) => moveSection(d, index, -1))} className={BTN}>
            ↑ 위로
          </button>
          <button type="button" data-testid="section-down" aria-label={`${s.title} 아래로`} disabled={index === count - 1} onClick={() => change((d) => moveSection(d, index, 1))} className={BTN}>
            ↓ 아래로
          </button>
          <button type="button" data-testid="section-hide" aria-pressed={s.hidden} onClick={() => change((d) => patchSection(d, s.id, (x) => ({ ...x, hidden: !x.hidden })))} className={BTN}>
            {s.hidden ? '보이기' : '숨기기'}
          </button>
          <ScopePicker label={s.title} value={s.scope} businesses={businesses} projects={projects} onChange={(v) => change((d) => patchSection(d, s.id, (x) => ({ ...x, scope: v ?? { biz: 'all' } })))} />
          <span className="flex-1" />
          <button type="button" data-testid="section-library" aria-expanded={libOpen} onClick={onLibrary} className={BTN}>
            + 위젯
          </button>
          <button
            type="button"
            data-testid="section-remove"
            onClick={() => {
              if (!s.widgets.length || window.confirm(`«${s.title}» 구역을 지울까요? 안의 위젯 ${s.widgets.length}개도 화면에서 빠집니다(원본 자료는 그대로).`)) change((d) => removeSection(d, s.id))
            }}
            className={BTN}
          >
            구역 지우기
          </button>
        </div>
      ) : null}

      {s.collapsed ? (
        <p className="text-t13 text-ink-muted">접힌 구역 — 위젯 {shown.length}개</p>
      ) : shown.length === 0 ? (
        <div className={`rounded-lg px-4 py-6 text-center text-t14 text-ink-dim ${editing ? 'border border-dashed border-accent/50 bg-accent-soft/50' : 'bg-raised/50'}`}>
          {editing ? '여기로 위젯을 끌어 놓거나 «+ 위젯»으로 넣으세요.' : '위젯이 없는 구역입니다.'}
        </div>
      ) : (
        <div data-testid="widget-grid" className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((w, i) => (
            <WidgetBox
              key={w.id}
              widget={w}
              index={i}
              count={shown.length}
              section={s}
              editing={editing}
              busy={busy}
              usable={addable.includes(w.kind)}
              favorites={favorites}
              businesses={businesses}
              projects={projects}
              sectionOptions={sectionOptions}
              change={change}
              quick={quick}
              dragRef={dragRef}
              onDropHere={() => dropTo(i)}
            />
          ))}
          {editing ? (
            <div
              aria-hidden
              className="hidden min-h-24 items-center justify-center rounded-lg border border-dashed border-accent/50 bg-accent-soft/50 text-t13 text-accent lg:flex"
              onDragOver={(e) => dragRef.current && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                dropTo()
              }}
            >
              여기에 놓기
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ 위젯 */

function WidgetBox({
  widget: w,
  index: i,
  count,
  section: s,
  editing,
  busy,
  usable,
  favorites,
  businesses,
  projects,
  sectionOptions,
  change,
  quick,
  dragRef,
  onDropHere,
}: {
  widget: HomeWidget
  index: number
  count: number
  section: BoardSection
  editing: boolean
  busy: boolean
  usable: boolean
  favorites: FavoriteOption[]
  businesses: BoardOption[]
  projects: BoardOption[]
  sectionOptions: { id: string; title: string }[]
  change: (fn: (d: BoardSection[]) => BoardSection[]) => void
  quick: (fn: (d: BoardSection[]) => BoardSection[]) => void
  dragRef: DragRef
  onDropHere: () => void
}) {
  const def = widgetDef(w.kind)!
  const filter = filterOf(w)
  const eff = effectiveScope(s, w)
  const others = sectionOptions.filter((o) => o.id !== s.id)
  return (
    <article
      data-testid={`widget-${w.kind}`}
      data-size={w.size}
      data-section={s.id}
      aria-label={def.label}
      className={`${SPAN[w.size]} flex min-w-0 flex-col overflow-hidden rounded-lg border bg-panel ${editing ? 'border-dashed border-accent/40' : 'border-line-soft'}`}
      draggable={editing}
      onDragStart={(e) => {
        dragRef.current = { section: s.id, index: i }
        e.dataTransfer.effectAllowed = 'move'
        e.stopPropagation()
      }}
      onDragOver={(e) => {
        if (editing && dragRef.current) e.preventDefault()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDropHere()
      }}
    >
      {editing ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line-soft bg-raised/70 px-2 py-1.5">
          <span className="hidden cursor-grab text-t13 text-ink-muted select-none lg:inline" title="끌어서 옮기기">
            ⠿ 이동
          </span>
          <span className="flex-1" />
          <button type="button" data-testid="move-prev" aria-label={`${def.label} 앞으로`} disabled={i === 0} onClick={() => change((d) => nudgeWidget(d, s.id, i, -1))} className={BTN}>
            앞
          </button>
          <button type="button" data-testid="move-next" aria-label={`${def.label} 뒤로`} disabled={i === count - 1} onClick={() => change((d) => nudgeWidget(d, s.id, i, 1))} className={BTN}>
            뒤
          </button>
          {others.length ? (
            <select
              data-testid="move-section"
              aria-label={`${def.label} 다른 구역으로`}
              value=""
              onChange={(e) => {
                const to = e.target.value
                if (to) change((d) => transferWidget(d, { section: s.id, index: i }, { section: to }).sections)
              }}
              className={SELECT}
            >
              <option value="">구역 이동…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  → {o.title}
                </option>
              ))}
            </select>
          ) : null}
          <select data-testid="size" aria-label={`${def.label} 크기`} value={w.size} onChange={(e) => change((d) => patchWidget(d, s.id, w.id, (x) => ({ ...x, size: e.target.value as WidgetSize })))} className={SELECT}>
            {WIDGET_SIZES.map((z) => (
              <option key={z} value={z}>
                {SIZE_LABEL[z]}
              </option>
            ))}
          </select>
          <button type="button" data-testid="remove" aria-label={`${def.label} 제거`} onClick={() => change((d) => removeWidget(d, s.id, w.id))} className={BTN}>
            제거
          </button>
          {def.scoped ? (
            <div className="w-full">
              <ScopePicker
                label={def.label}
                value={w.settings.scope}
                inherit={scopeLabel(s.scope, businesses, projects)}
                businesses={businesses}
                projects={projects}
                withProject={def.scoped === 'project'}
                onChange={(v) => change((d) => patchWidget(d, s.id, w.id, (x) => ({ ...x, settings: { ...x.settings, scope: v } })))}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2.5 pb-1">
        <h3 className="min-w-0 truncate text-t15 font-semibold text-ink">{def.label}</h3>
        <span className="flex flex-wrap items-center gap-1.5">
          {eff.overridden ? (
            <span data-testid="widget-scope" className="rounded-full border border-line-soft px-2 py-0.5 text-t13 text-ink-dim">
              {scopeLabel({ biz: eff.biz, project: eff.project }, businesses, projects)}
            </span>
          ) : null}
          {def.filters.length && usable ? (
            <select
              data-testid="filter"
              aria-label={`${def.label} 표시 범위`}
              value={filter}
              disabled={busy}
              onChange={(e) => quick((d) => patchWidget(d, s.id, w.id, (x) => ({ ...x, settings: { ...x.settings, filter: e.target.value } })))}
              className={SELECT}
            >
              {def.filters.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          ) : null}
        </span>
      </div>
      {!usable ? (
        <div data-state="denied" className="px-3 py-4 text-t14 text-ink-dim">
          <span className="rounded-md bg-raised px-2 py-0.5 text-t13">권한 없음</span> <span className="ml-1">이 위젯을 쓸 수 없는 계정입니다. 편집에서 제거할 수 있습니다.</span>
        </div>
      ) : editing && w.kind === 'favorites' ? (
        <FavoritesEditor items={w.settings.items ?? []} options={favorites} onChange={(items) => change((d) => patchWidget(d, s.id, w.id, (x) => ({ ...x, settings: { ...x.settings, items } })))} />
      ) : (
        <WidgetContent widget={w} def={def} favorites={favorites} scope={eff} />
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ 위젯 라이브러리(편집 모드에서만) */

function Library({
  target,
  sections,
  library,
  addable,
  onTarget,
  onAdd,
  onClose,
}: {
  target: BoardSection
  sections: { id: string; title: string }[]
  library: string[]
  addable: string[]
  onTarget: (id: string) => void
  onAdd: (kind: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<WidgetGroup | 'all'>('all')
  const defs = library.map((k) => widgetDef(k)!).filter(Boolean)
  const groups = WIDGET_GROUPS.filter((g) => defs.some((d) => (d.group ?? '업무') === g))
  const shown = defs.filter((d) => tab === 'all' || (d.group ?? '업무') === tab)
  const present = new Set(target.widgets.map((w) => w.kind))
  return (
    <aside data-testid="add-panel" aria-label="위젯 라이브러리" className={`${CARD} flex flex-col gap-3 p-3 lg:sticky lg:top-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-t16 font-bold text-ink">▦ 위젯 라이브러리</h2>
        <button type="button" onClick={onClose} aria-label="라이브러리 닫기" className={BTN}>
          ✕
        </button>
      </div>
      <p className="text-t13 text-ink-dim">내 권한으로 쓸 수 있는 위젯만 보입니다. 구역마다 같은 위젯은 한 번만 넣습니다.</p>
      <label className="flex flex-col gap-1 text-t13 text-ink-dim">
        넣을 구역
        <select data-testid="library-target" value={target.id} onChange={(e) => onTarget(e.target.value)} className={SELECT}>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="위젯 종류">
        {(['all', ...groups] as const).map((g) => (
          <button key={g} type="button" role="tab" aria-selected={tab === g} onClick={() => setTab(g)} className={`min-h-11 rounded-lg px-3 text-t13 ${tab === g ? 'bg-accent font-semibold text-on-accent' : 'border border-line bg-raised text-ink-dim'}`}>
            {g === 'all' ? '전체' : g}
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {shown.map((d) => {
          const has = present.has(d.kind)
          const can = addable.includes(d.kind)
          return (
            <li key={d.kind} data-testid={`lib-${d.kind}`} className="flex items-center gap-2 rounded-lg border border-line-soft bg-raised/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-t14 font-semibold text-ink">
                  {d.label}
                  {d.listOnly || d.link === 'pending' ? <span className="ml-1.5 rounded-md bg-accent-soft px-1.5 py-0.5 text-t13 font-medium text-warning">준비 중</span> : null}
                </div>
                <div className="text-t13 text-ink-dim">{d.description}</div>
              </div>
              <button type="button" data-testid={`add-${d.kind}`} disabled={has || !can} onClick={() => onAdd(d.kind)} className={BTN}>
                {d.listOnly ? '준비 중' : has ? '추가됨' : '+ 추가'}
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
