'use client'

import { useRef, useState, type DragEvent, type ReactNode } from 'react'

import { dropSummary, planDrop, type FileCheck } from '@/lib/file-drop'

/**
 * 공통 첨부 부품(5단계) — 파일을 받는 칸은 모두 이것을 쓴다(첨부 · 이니셔티브 로고 · 프로필 사진).
 *
 * - 끌어다 놓기: 칸 위에 있는 동안 테두리 · 바탕이 accent로 바뀐다. 놓으면 곧바로 판정 → 순서대로 하나씩 올린다.
 * - 형식 · 크기 위반은 **올리기 전에** 파일마다 바로 알린다(받는 형식 · 상한을 같이). 같은 묶음의 맞는 파일은 그대로 올라간다.
 * - 한 장만 받는 칸(`max={1}`)은 맞는 파일 중 첫 장만 올리고 나머지는 «넘김»으로 적는다.
 * - 폰(손가락 포인터): «사진 찍기»(camera) + «파일 고르기». 마우스 화면: «파일 고르기» + «끌어다 놓아도 됩니다».
 *   (pointer: coarse/fine로 가른다 — 화면 폭이 아니라 입력 기기로. 터치 노트북은 마우스가 주 포인터면 데스크톱 쪽.)
 * - 키보드: 버튼이 탭으로 잡히고 Enter/Space로 고르기 창이 열린다. 진행 · 거절은 aria-live로 읽힌다.
 *
 * 칸의 규칙(형식 · 상한 · 줄이기 · 등급)은 부르는 쪽이 `check` · `upload`로 넘긴다 — 이 부품은 규칙을 모른다.
 * 서버 액션이 마지막 문지기다.
 */

type ItemState = 'waiting' | 'working' | 'done' | 'warn' | 'error' | 'rejected' | 'skipped'

interface DropItem {
  key: string
  name: string
  state: ItemState
  text: string
}

export interface UseFileDropOptions {
  check: FileCheck
  /** 한 번에 받는 파일 수. 로고 · 사진은 1. 없으면 제한 없음. */
  max?: number
  /**
   * 파일 한 개를 올린다. 실패는 throw(Error.message가 그 파일의 문구). 올라갔지만 덧붙일 말이 있으면
   * 문자열을 돌려준다(예: 요약 실패). `phase`로 진행 문구를 바꾼다(«요약 중…»).
   */
  upload: (file: File, phase: (text: string) => void) => Promise<string | void>
  /** 묶음이 끝난 뒤(성공 · 실패 무관) 한 번. */
  onSettled?: () => void
  /** 지금은 파일을 받지 않는 이유(예: Vault 등급). 있으면 놓아도 올리지 않고 이 문구를 알린다. */
  blocked?: string | null
}

export function useFileDrop({ check, max, upload, onSettled, blocked }: UseFileDropOptions) {
  const [items, setItems] = useState<DropItem[]>([])
  const [busy, setBusy] = useState(false)
  const [announce, setAnnounce] = useState('')
  const [alertText, setAlert] = useState('')
  const batch = useRef(0)

  const patch = (key: string, next: Partial<DropItem>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...next } : it)))

  async function accept(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? [])
    if (files.length === 0) return
    if (busy) {
      setAnnounce('올리는 중입니다 — 끝난 뒤 다시 놓으세요.')
      return
    }
    if (blocked) {
      setItems([])
      setAlert(blocked)
      return
    }

    batch.current += 1
    const plan = planDrop(files, check, max).map((v, i) => ({ ...v, key: `${batch.current}-${i}` }))
    setItems(
      plan.map((v) => ({
        key: v.key,
        name: v.file.name,
        state: v.verdict === 'take' ? 'waiting' : v.verdict === 'reject' ? 'rejected' : 'skipped',
        text: v.verdict === 'take' ? '기다리는 중' : v.reason,
      })),
    )
    const rejected = plan.filter((v) => v.verdict === 'reject')
    const skipped = plan.filter((v) => v.verdict === 'skip').length
    const take = plan.filter((v) => v.verdict === 'take')
    // 거절은 올리기 전에 곧바로 — role=alert로 따로 읽힌다(진행 문구가 덮지 않게).
    setAlert(rejected.map((v) => `${v.file.name}: ${v.verdict === 'reject' ? v.reason : ''}`).join(' '))
    if (take.length === 0) {
      setAnnounce(dropSummary({ done: 0, failed: 0, rejected: rejected.length, skipped }))
      return
    }

    setBusy(true)
    let done = 0
    let failed = 0
    try {
      for (const [i, v] of take.entries()) {
        const step = take.length > 1 ? ` (${i + 1}/${take.length})` : ''
        patch(v.key, { state: 'working', text: `올리는 중…${step}` })
        setAnnounce(`${v.file.name} 올리는 중${step}`)
        try {
          const warning = await upload(v.file, (text) => {
            patch(v.key, { text: `${text}${step}` })
            setAnnounce(`${v.file.name} ${text}${step}`)
          })
          done += 1
          patch(v.key, warning ? { state: 'warn', text: warning } : { state: 'done', text: '올렸습니다' })
        } catch (e) {
          failed += 1
          patch(v.key, { state: 'error', text: e instanceof Error ? e.message : '올리지 못했습니다.' })
        }
      }
    } finally {
      setBusy(false)
      setAnnounce(dropSummary({ done, failed, rejected: rejected.length, skipped }))
      onSettled?.()
    }
  }

  return { items, busy, announce, alertText, accept }
}

const STATE_CLASS: Record<ItemState, string> = {
  waiting: 'text-ink-muted',
  working: 'text-accent',
  done: 'text-ok',
  warn: 'text-warning',
  error: 'text-critical',
  rejected: 'text-critical',
  skipped: 'text-ink-muted',
}
const STATE_MARK: Record<ItemState, string> = {
  waiting: '…',
  working: '↑',
  done: '✓',
  warn: '!',
  error: '✕',
  rejected: '✕',
  skipped: '–',
}

const BUTTON =
  'min-h-11 rounded-md border border-line bg-panel px-3 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:opacity-50 lg:min-h-0 lg:py-1.5'

export interface FileDropZoneProps extends UseFileDropOptions {
  /** `<input accept>` — 고르기 창의 거르개일 뿐, 실제 판정은 `check`. */
  accept: string
  /** 안내 줄 — 받는 형식과 상한(«PNG · JPG · WebP, 2MB까지»). */
  hint: ReactNode
  /** «파일 고르기» 대신 쓸 이름(«로고 바꾸기»). */
  pickLabel?: string
  /** 폰에서 «사진 찍기»(capture=environment)를 보인다. */
  camera?: boolean
  /** 버튼 줄 오른쪽에 붙는 것(등급 고르기 · 삭제 버튼). */
  extra?: ReactNode
  /** `blocked`일 때 안내 줄 대신 그릴 것. */
  blockedNotice?: ReactNode
  /** 바깥 동작(삭제 등)이 도는 동안 막는다. */
  disabled?: boolean
  /** 칸 이름(스크린 리더) — «첨부 파일 올리기». */
  label: string
  className?: string
}

export function FileDropZone(props: FileDropZoneProps) {
  const { accept: acceptAttr, hint, pickLabel = '파일 고르기', camera, extra, blockedNotice, disabled, label, className = '', blocked, max } = props
  const { items, busy, announce, alertText, accept } = useFileDrop(props)
  const [drag, setDrag] = useState(false)
  const depth = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const off = disabled || busy

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 같은 파일을 다시 골라도 change 이벤트가 뜨도록 비워 둔다.
    void accept(files)
  }

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={busy}
      data-drag={drag ? 'over' : undefined}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current += 1
        setDrag(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = off || blocked ? 'none' : 'copy'
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDrag(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setDrag(false)
        if (disabled) return
        void accept(e.dataTransfer.files)
      }}
      className={`relative rounded-lg border-2 border-dashed p-3 transition-colors ${
        drag ? (blocked ? 'border-critical/60 bg-critical/5' : 'border-accent bg-accent/10 ring-2 ring-accent/30') : 'border-line'
      } ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {blocked ? null : (
          <>
            {camera ? (
              <button type="button" disabled={off} onClick={() => cameraRef.current?.click()} className={`${BUTTON} pointer-fine:hidden`}>
                사진 찍기
              </button>
            ) : null}
            <button type="button" disabled={off} onClick={() => fileRef.current?.click()} className={BUTTON}>
              {busy ? '올리는 중…' : pickLabel}
            </button>
          </>
        )}
        {extra}
      </div>

      {blocked ? (
        (blockedNotice ?? <p className="mt-2 text-t11h text-ink-muted">{blocked}</p>)
      ) : (
        <p className="mt-1.5 text-t10h text-ink-muted">
          {drag ? (
            <span className="font-semibold text-accent">여기에 놓으면 {max === 1 ? '첫 장을' : '차례로'} 올립니다</span>
          ) : (
            <>
              <span className="pointer-coarse:hidden">여기로 끌어다 놓아도 됩니다 · </span>
              {hint}
            </>
          )}
        </p>
      )}

      {items.length ? (
        <ul className="mt-2 space-y-1" aria-label="올리기 상태">
          {items.map((it) => (
            <li
              key={it.key}
              className={`flex gap-1.5 rounded-md px-2 py-1 text-t11 ${
                it.state === 'rejected' || it.state === 'error' ? 'border border-critical/40 bg-critical/10' : 'bg-raised/40'
              }`}
            >
              <span aria-hidden className={`w-3 shrink-0 text-center font-semibold ${STATE_CLASS[it.state]}`}>
                {STATE_MARK[it.state]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="break-all font-semibold text-ink">{it.name}</span>
                <span className={`ml-1.5 ${STATE_CLASS[it.state]}`}>{it.text}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <p role="alert" className="sr-only">
        {alertText}
      </p>

      <input ref={fileRef} type="file" multiple={max !== 1} accept={acceptAttr} className="hidden" tabIndex={-1} onChange={onPicked} />
      {camera ? (
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} onChange={onPicked} />
      ) : null}
    </div>
  )
}
