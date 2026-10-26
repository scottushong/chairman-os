'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { memoryStatusAction, registerMemoryAssetAction, saveMemoryAction } from '@/app/actions/memory'
import { Icon } from '@/components/ui/icon'
import { STATUS_LABEL, type ProcessingStatus } from '@/lib/memory/types'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

/**
 * 빠른 기록(0088) — 대표에게만 그린다(레이아웃이 대표 · 스위치일 때만 붙인다). 모든 화면 오른쪽 아래(어시스턴트 단추 위).
 *
 *   · 데스크톱은 오른쪽 패널, 휴대폰은 아래에서 올라오는 판. 단축키 Alt+M(열기) · Ctrl/⌘+Enter(저장) · Esc(닫기).
 *   · 쓰는 중인 글은 이 브라우저에 자동 보관(화면을 옮겨도 · 새로고침해도 남는다). 저장되면 지운다.
 *   · 저장은 원본을 바로 남기고, 분석은 뒤에서 한다 — 기다리지 않아도 된다. 상태(저장됨 → 분석 중 → 준비됨/검토 필요/실패)를 보인다.
 *   · 제목 · 회사 · 참석자를 묻지 않는다(회의만 고를 수 있게). AI가 분류하고 나중에 고친다.
 *   · 음성은 파일로(휴대폰은 녹음기가 바로 열린다) — 전사 업체가 정해지기 전까지 «원본 보관 · 전사 대기».
 */

type Kind = 'note' | 'meeting' | 'voice' | 'file'
const KIND_LABEL: Record<Kind, string> = { note: '메모', meeting: '회의', voice: '음성', file: '파일' }
const DRAFT_KEY = 'memory.quick-capture.draft.v1'
const BUCKET = 'memory-assets'
const MAX_FILE = 25 * 1024 * 1024
const DUMMY_MAX = 4 * 1024 * 1024

interface Draft {
  kind: Kind
  text: string
  title: string
  participants: string
  consent: boolean
}
const EMPTY: Draft = { kind: 'note', text: '', title: '', participants: '', consent: false }

function readDraft(): Draft {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY
  } catch {
    return EMPTY
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (!d || (!d.text.trim() && !d.title.trim() && !d.participants.trim())) window.localStorage.removeItem(DRAFT_KEY)
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
  } catch {
    /* 저장소가 막힌 창(시크릿 등) — 보관 없이 쓴다 */
  }
}
const newKey = () => `qc_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
function safeName(name: string): string {
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0]?.toLowerCase() ?? ''
  const base = name.slice(0, name.length - ext.length).replace(/[^A-Za-z0-9가-힣_-]+/g, '_').replace(/^\.+/, '').slice(0, 60) || 'file'
  return `${Date.now().toString(36)}_${base}${ext}`
}

export function QuickCapture({ mode, userId }: { mode: 'dummy' | 'live'; userId: string }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: string; status: ProcessingStatus | 'saved'; reviews: number } | null>(null)
  const [busy, start] = useTransition()
  const keyRef = useRef<string>('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const loaded = useRef(false)

  // 처음 한 번 — 이 브라우저에 남은 쓰던 글을 되살린다.
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    const d = readDraft()
    // 브라우저 저장소는 마운트 뒤에만 읽힌다(서버 렌더와 맞추려고)
    setDraft(d)
  }, [])

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => {
      const n = { ...d, ...patch }
      writeDraft(n)
      return n
    })
  }, [])

  const openPanel = useCallback((kind?: Kind) => {
    setOpen(true)
    setError(null)
    if (kind) update({ kind })
    setTimeout(() => textRef.current?.focus(), 30)
  }, [update])

  // Alt+M 열기 · Esc 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM')) {
        e.preventDefault()
        openPanel()
      } else if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openPanel])

  // 저장 뒤 상태 따라가기(2초마다 · 최대 90초)
  useEffect(() => {
    if (!saved || !['saved', 'processing'].includes(saved.status)) return
    let n = 0
    const t = setInterval(async () => {
      n++
      const s = await memoryStatusAction(saved.id).catch(() => null)
      if (s) setSaved((prev) => (prev && prev.id === saved.id ? { ...prev, status: s.status as ProcessingStatus, reviews: s.reviews } : prev))
      if (n >= 45 || (s && !['saved', 'processing'].includes(s.status))) clearInterval(t)
    }, 2000)
    return () => clearInterval(t)
  }, [saved])

  function pick(list: FileList | null) {
    if (!list) return
    const max = mode === 'live' ? MAX_FILE : DUMMY_MAX
    const ok = [...list].filter((f) => f.size > 0 && f.size <= max).slice(0, 5)
    if (ok.length < list.length) setError(`파일은 ${max / 1024 / 1024}MB까지 · 한 번에 5개까지입니다.`)
    setFiles((prev) => [...prev, ...ok].slice(0, 5))
  }

  function save() {
    const d = draft
    if (!d.text.trim() && files.length === 0) {
      setError('내용을 쓰거나 파일을 붙여 주세요.')
      return
    }
    setError(null)
    keyRef.current ||= newKey()
    start(async () => {
      const form = new FormData()
      const type = d.kind === 'voice' ? 'voice' : d.kind === 'file' ? 'file' : d.kind === 'meeting' ? 'meeting' : 'note'
      form.set('client_key', keyRef.current)
      form.set('type', type)
      form.set('text', d.text)
      form.set('captured_at', new Date().toISOString())
      if (d.kind === 'meeting') {
        form.set('title', d.title)
        form.set('participants', d.participants)
      }
      if (d.consent) form.set('consent', 'on')
      if (mode === 'dummy') for (const f of files) form.append('file', f)
      const r = await saveMemoryAction(form)
      if (!r.ok || !r.captureId) {
        setError(r.error ?? '저장하지 못했습니다. 글은 이 창에 그대로 있습니다.')
        return
      }
      // live — 원본 글은 이미 저장됐다. 파일은 비공개 버킷으로 바로 올리고 경로만 등록한다(Vercel 요청 한도를 타지 않음).
      if (mode === 'live' && files.length) {
        const sb = createSupabaseBrowserClient()
        for (const f of files) {
          const path = `${userId}/${r.captureId}/${safeName(f.name)}`
          const { error: upErr } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false })
          if (upErr) {
            setError(`«${f.name}»을(를) 올리지 못했습니다 — 글은 저장됐습니다. 기억 화면에서 다시 붙여 주세요.`)
            continue
          }
          const a = await registerMemoryAssetAction(r.captureId, { path, name: f.name, type: f.type, size: f.size })
          if (!a.ok) setError(a.error ?? `«${f.name}» 등록 실패`)
        }
      }
      keyRef.current = ''
      setFiles([])
      setDraft({ ...EMPTY, kind: d.kind })
      writeDraft(null)
      setSaved({ id: r.captureId, status: 'saved', reviews: 0 })
    })
  }

  const statusTone = (s: string) =>
    s === 'failed' ? 'text-critical' : s === 'needs_review' ? 'text-warning' : s === 'ready' ? 'text-ok' : 'text-ink-muted'

  return (
    <>
      {open ? null : (
        <button
          type="button"
          onClick={() => openPanel()}
          aria-label="빠른 기록 열기 (Alt+M)"
          title="빠른 기록 (Alt+M)"
          className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+9.25rem)] z-40 flex size-12 items-center justify-center rounded-full border border-line bg-panel text-ink shadow-lg shadow-scrim/15 transition-transform hover:scale-105 lg:right-7 lg:bottom-32"
        >
          <Icon name="pencil" className="size-5" />
        </button>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-scrim/30 lg:items-stretch lg:justify-end lg:bg-transparent lg:pointer-events-none" role="dialog" aria-modal="true" aria-label="빠른 기록">
          <button type="button" aria-label="닫기" className="absolute inset-0 lg:hidden" onClick={() => setOpen(false)} />
          <section className="relative pointer-events-auto flex max-h-[88dvh] w-full flex-col rounded-t-2xl border-line-soft bg-app shadow-2xl lg:max-h-none lg:w-[420px] lg:rounded-none lg:border-l">
            <header className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
              <Icon name="pencil" className="size-4 text-accent" />
              <p className="flex-1 text-t13 font-semibold text-ink">빠른 기록</p>
              <Link href="/memory" className="rounded-md px-2 py-1 text-t11h text-ink-dim hover:bg-raised" onClick={() => setOpen(false)}>
                기억 열기
              </Link>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="flex size-10 items-center justify-center rounded-lg text-ink-dim hover:bg-raised">
                <Icon name="x" className="size-5" />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="flex gap-1" role="tablist" aria-label="기록 종류">
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={draft.kind === k}
                    onClick={() => {
                      update({ kind: k })
                      if (k === 'voice') audioRef.current?.click()
                      if (k === 'file') fileRef.current?.click()
                    }}
                    className={`min-h-9 flex-1 rounded-lg border px-2 text-t12 ${draft.kind === k ? 'border-accent bg-accent/10 text-ink' : 'border-line-soft text-ink-dim hover:border-line'}`}
                  >
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>

              {draft.kind === 'meeting' ? (
                <div className="space-y-2">
                  <input value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="회의 제목(비워도 됨)" className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-t13" maxLength={200} />
                  <input value={draft.participants} onChange={(e) => update({ participants: e.target.value })} placeholder="참석자(쉼표로 · 비워도 됨)" className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-t13" />
                </div>
              ) : null}

              <textarea
                ref={textRef}
                value={draft.text}
                onChange={(e) => update({ text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    save()
                  }
                }}
                placeholder={draft.kind === 'meeting' ? '회의 메모 — 결정 · 약속 · 할 일을 그대로 적어 두세요.' : '무엇이든 적어 두세요. 회사 · 사람 · 프로젝트는 AI가 찾아 잇고, 확실하지 않은 것은 검토함에서 묻습니다.'}
                rows={draft.kind === 'meeting' ? 9 : 8}
                className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 text-t14 leading-relaxed"
                aria-label="기록 내용"
              />

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-9 items-center gap-1 rounded-lg border border-line-soft px-2.5 text-t12 text-ink-dim hover:border-line">
                  <Icon name="file-text" className="size-4" /> 첨부
                </button>
                <button type="button" onClick={() => audioRef.current?.click()} className="flex min-h-9 items-center gap-1 rounded-lg border border-line-soft px-2.5 text-t12 text-ink-dim hover:border-line">
                  <Icon name="video" className="size-4" /> 음성 파일 · 녹음
                </button>
                <button type="button" onClick={() => update({ kind: 'meeting' })} className="flex min-h-9 items-center gap-1 rounded-lg border border-line-soft px-2.5 text-t12 text-ink-dim hover:border-line">
                  <Icon name="users" className="size-4" /> 회의 시작
                </button>
                <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.eml,image/*" onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
                <input ref={audioRef} type="file" hidden accept="audio/*" capture="user" onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
              </div>

              {files.length ? (
                <ul className="space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md bg-raised px-2 py-1 text-t11h text-ink-dim">
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="tnum">{Math.max(1, Math.round(f.size / 1024))}KB</span>
                      <button type="button" aria-label={`${f.name} 빼기`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} className="text-ink-muted hover:text-ink">
                        <Icon name="x" className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {draft.kind === 'meeting' || files.some((f) => /^audio\//.test(f.type)) ? (
                <label className="flex items-start gap-2 rounded-lg border border-line-soft px-3 py-2 text-t11h text-ink-dim">
                  <input type="checkbox" checked={draft.consent} onChange={(e) => update({ consent: e.target.checked })} className="mt-0.5" />
                  <span>참석자에게 기록 · 녹음 사실을 알렸습니다. (녹음 파일은 전사 업체가 정해지기 전까지 원본만 보관됩니다.)</span>
                </label>
              ) : null}

              {error ? <p className="text-t12 text-critical" role="alert">{error}</p> : null}

              {saved ? (
                <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-panel px-3 py-2 text-t12" aria-live="polite">
                  <Icon name="check-circle" className="size-4 text-ok" />
                  <span className="text-ink">원본 저장됨</span>
                  <span className={statusTone(saved.status)}>· {STATUS_LABEL[saved.status as ProcessingStatus] ?? saved.status}{saved.reviews ? ` (검토 ${saved.reviews})` : ''}</span>
                  <Link href={`/memory/${saved.id}`} className="ml-auto text-accent hover:underline" onClick={() => setOpen(false)}>
                    열기
                  </Link>
                </div>
              ) : null}
            </div>

            <footer className="flex items-center gap-2 border-t border-line-soft px-4 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)]">
              <span className="text-t10h text-ink-muted">{draft.text ? '쓰는 중 — 이 브라우저에 자동 보관' : 'Ctrl+Enter 저장 · Alt+M 열기'}</span>
              <button type="button" disabled={busy} onClick={save} className="ml-auto min-h-10 rounded-lg bg-gold px-4 text-t13 font-semibold text-ink disabled:opacity-60">
                {busy ? '저장 중…' : '저장'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
