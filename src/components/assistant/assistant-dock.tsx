'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'

import { askAssistant, loadAssistant, type AssistantThread } from '@/app/actions/assistant'
import { Icon } from '@/components/ui/icon'
import { SCREEN_LABEL_KO, screenSubject } from '@/lib/ai/assistant/screen'
import { tr, type Lang } from '@/lib/i18n'

import { AssistantMessages } from './assistant-messages'

/**
 * Phase 11 — 모든 화면 오른쪽 아래의 AI 어시스턴트(셸 둘이 한 번씩 그린다 — 화면마다 넣지 않는다).
 *
 * PC(1024px~)는 오른쪽에서 420px 패널이 밀려 나오고, 폰은 전체 화면이다. 버튼은 폰 하단 탭 위에 뜬다.
 * 지금 화면의 경로(+ ?id=)를 질문과 같이 보낸다 — 이니셔티브 상세에서 열면 그 건이 기본 주제다.
 * 마지막 대화 id는 이 기기에만 기억한다(localStorage — 없어도 새 대화로 열릴 뿐이다). 대화 자체는 DB(0041)에 있다.
 * 음성 입력은 브라우저에 Web Speech API가 있을 때만 마이크 버튼이 선다(폰 Chrome · Safari).
 */

const LAST_CHAT_KEY = 'chairman.assistant.chat'

type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
type RecognitionCtor = new () => Recognition

function speechCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const noop = () => () => {}

function readLast(): string | null {
  try {
    return window.localStorage.getItem(LAST_CHAT_KEY)
  } catch {
    return null
  }
}
function writeLast(id: string | null) {
  try {
    if (id) window.localStorage.setItem(LAST_CHAT_KEY, id)
    else window.localStorage.removeItem(LAST_CHAT_KEY)
  } catch {
    /* 사생활 창 등 — 기억 못 해도 새 대화로 열릴 뿐이다 */
  }
}

const EMPTY: AssistantThread = { chatId: null, chats: [], messages: [], actions: [] }

function examples(kind: string, lang: Lang): string[] {
  if (lang === 'en') return ['Anything wrong on this screen?', 'Initiatives without a deadline', 'Why is DY yellow?']
  if (kind === 'initiative') return ['이 건 요약해 줘', '이 화면에 틀린 것 있어?', '다음 행동을 바꿔 줘']
  if (kind === 'finance_business' || kind === 'business') return ['이 회사 최근 3개월 영업이익 합계', '이 화면에 틀린 것 있어?', '잠정과 확정이 다른 달']
  return ['VANA 9월 손익 합계', '기한 없는 이니셔티브', '왜 DY가 yellow인가', '이 화면에 틀린 것 있어?']
}

export function AssistantDock({ lang }: { lang: Lang }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [showChats, setShowChats] = useState(false)
  const [data, setData] = useState<AssistantThread>(EMPTY)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [pending, start] = useTransition()
  const recRef = useRef<Recognition | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const voice = useSyncExternalStore(noop, () => speechCtor() !== null, () => false)
  const screen = screenSubject(pathname)

  function load(chatId: string | null) {
    start(async () => {
      const r = await loadAssistant(chatId)
      if (r.error) setError(r.error)
      setData(r)
      writeLast(r.chatId)
    })
  }

  function openPanel() {
    setOpen(true)
    setError(null)
    load(readLast())
  }

  function ask(question: string) {
    const text = question.trim()
    if (!text) return
    setError(null)
    // 지금 화면의 경로 + 쿼리(?id=)를 보낸다. useSearchParams를 셸에 걸지 않으려고 누를 때 읽는다.
    const path = `${window.location.pathname}${window.location.search}`
    start(async () => {
      const r = await askAssistant({ chatId: data.chatId, question: text, path })
      if (r.error) {
        setError(r.error)
        return
      }
      setQ('')
      setData(r)
      writeLast(r.chatId)
    })
  }

  function toggleVoice() {
    const Ctor = speechCtor()
    if (!Ctor) return
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = new Ctor()
    rec.lang = lang === 'en' ? 'en-US' : 'ko-KR'
    rec.interimResults = false
    rec.continuous = false
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(' ').trim()
      if (said) setQ((prev) => (prev ? `${prev} ${said}` : said))
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  // 새 답이 오면 맨 아래로. 상태를 바꾸지 않는 효과다(스크롤만).
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, data.messages.length, pending])

  // Esc로 닫는다.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {open ? null : (
        <button
          type="button"
          onClick={openPanel}
          aria-label={tr(lang, 'AI 어시스턴트 열기', 'Open AI assistant')}
          title={tr(lang, 'AI 어시스턴트', 'AI assistant')}
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 flex size-14 items-center justify-center rounded-full border border-gold/60 bg-gold text-ink shadow-lg shadow-black/20 transition-transform hover:scale-105 lg:right-6 lg:bottom-14"
        >
          <Icon name="sparkles" className="size-6" />
        </button>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 flex lg:pointer-events-none lg:justify-end" role="dialog" aria-modal="false" aria-label={tr(lang, 'AI 어시스턴트', 'AI assistant')}>
          <section className="assistant-slide pointer-events-auto flex h-full w-full flex-col border-line-soft bg-app shadow-2xl lg:w-[420px] lg:border-l">
            <header className="safe-top flex items-center gap-1 border-b border-line-soft px-3 py-2">
              <Icon name="sparkles" className="size-5 text-gold" />
              <div className="min-w-0 flex-1">
                <p className="text-t13 font-semibold text-ink">{tr(lang, 'AI 어시스턴트', 'AI assistant')}</p>
                <p className="truncate text-t10h text-ink-muted">
                  {tr(lang, '지금 화면', 'Screen')}: {SCREEN_LABEL_KO[screen.kind]}
                  {screen.id ? ` · ${screen.id}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setShowChats((v) => !v)} aria-label={tr(lang, '지난 대화', 'History')} className="flex size-11 items-center justify-center rounded-lg text-ink-dim hover:bg-raised">
                <Icon name="clock" className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setData({ ...EMPTY, chats: data.chats })
                  writeLast(null)
                  setShowChats(false)
                }}
                aria-label={tr(lang, '새 대화', 'New chat')}
                className="flex size-11 items-center justify-center rounded-lg text-ink-dim hover:bg-raised"
              >
                <Icon name="plus" className="size-5" />
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label={tr(lang, '닫기', 'Close')} className="flex size-11 items-center justify-center rounded-lg text-ink-dim hover:bg-raised">
                <Icon name="x" className="size-5" />
              </button>
            </header>

            {showChats ? (
              <ul className="max-h-[40%] overflow-y-auto border-b border-line-soft px-2 py-1.5">
                {data.chats.length === 0 ? <li className="px-2 py-2 text-t11h text-ink-muted">{tr(lang, '지난 대화가 없습니다.', 'No history.')}</li> : null}
                {data.chats.map((c) => (
                  <li key={c.chat_id}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowChats(false)
                        load(c.chat_id)
                      }}
                      className={`flex min-h-11 w-full flex-col items-start justify-center rounded-lg px-2 text-left hover:bg-raised ${c.chat_id === data.chatId ? 'bg-raised' : ''}`}
                    >
                      <span className="w-full truncate text-t12h text-ink">{c.title || '(제목 없음)'}</span>
                      <span className="text-t10h text-ink-muted">{c.created_at.slice(0, 16).replace('T', ' ')}{c.context_path ? ` · ${c.context_path}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex-1 overflow-y-auto px-3">
              {data.messages.length === 0 && !pending ? (
                <div className="space-y-2 py-6 text-center">
                  <p className="text-t12h text-ink-dim">{tr(lang, '이 화면에 대해 물어보세요.', 'Ask about this screen.')}</p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {examples(screen.kind, lang).map((e) => (
                      <button key={e} type="button" onClick={() => ask(e)} className="min-h-11 rounded-full border border-line bg-raised px-3 text-t11h hover:border-accent">
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <AssistantMessages
                messages={data.messages}
                actions={data.actions}
                lang={lang}
                pending={pending}
                onChanged={() => load(data.chatId)}
                onNavigate={() => {
                  if (window.matchMedia('(max-width: 1023px)').matches) setOpen(false)
                }}
              />
              {pending ? <p className="pb-3 text-t11h text-ink-muted">{tr(lang, '읽고 계산하는 중…', 'Working…')}</p> : null}
              <div ref={endRef} />
            </div>

            <footer className="safe-bottom border-t border-line-soft px-3 pt-2 pb-2">
              {error ? (
                <p role="alert" className="mb-1 text-t11h text-critical">
                  {error}
                </p>
              ) : null}
              <p className="mb-1.5 text-t10h text-ink-muted">
                {tr(
                  lang,
                  '내 권한 안의 데이터만 봅니다. 답은 참고용이며 결정이 아닙니다. 고치는 것은 [확인]을 눌러야 저장됩니다. 앱 화면 · 기능 변경은 하지 않습니다.',
                  'Sees only data you may see. Answers are not decisions. Changes are saved only when you press Confirm.',
                )}
              </p>
              <form
                className="flex items-end gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  ask(q)
                }}
              >
                <textarea
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      ask(q)
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder={tr(lang, 'AI에게 묻기…', 'Ask AI…')}
                  className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-line bg-panel px-2.5 py-2.5 text-t13"
                />
                {voice ? (
                  <button
                    type="button"
                    onClick={toggleVoice}
                    aria-label={listening ? tr(lang, '음성 입력 멈추기', 'Stop voice') : tr(lang, '음성으로 묻기', 'Voice input')}
                    className={`flex size-11 shrink-0 items-center justify-center rounded-lg border ${listening ? 'border-critical text-critical' : 'border-line text-ink-dim'}`}
                  >
                    <MicGlyph />
                  </button>
                ) : null}
                <button type="submit" disabled={pending || !q.trim()} className="min-h-11 shrink-0 rounded-lg bg-gold px-3.5 text-t12h font-semibold text-ink disabled:opacity-40">
                  {tr(lang, '묻기', 'Ask')}
                </button>
              </form>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}

/** 마이크 한 벌 — 아이콘 세트(ui/icon)에 없는 모양이라 여기서 그린다. */
function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}
