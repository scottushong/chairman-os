'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { markChannelRead, sendChatMessage } from '@/app/actions/chat'
import { tr, type Lang } from '@/lib/i18n'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { ChatMessage, ChatRead } from '@/types'

/**
 * 채널 하나 (Phase 9 블록 6). 새 메시지는 Supabase Realtime으로 받는다(live 모드).
 * Realtime은 구독자의 RLS를 그대로 적용한다 — 못 보는 채널의 메시지는 애초에 오지 않는다.
 * 받으면 서버가 다시 그리게 한다(router.refresh) — 보낸 사람 이름 · 문서 제목을 서버가 붙이므로
 * 클라이언트가 payload로 그리면 그 판정(문서를 볼 수 있나)이 두 곳으로 갈라진다.
 *
 * 읽음 표시: 1:1은 내 마지막 메시지 밑에 «읽음», 여럿인 방은 «읽음 N».
 */
export function ChatRoom({
  channelId,
  kind,
  messages,
  reads,
  me,
  documents,
  realtime,
  lang,
}: {
  channelId: string
  kind: 'company' | 'team' | 'dm'
  messages: ChatMessage[]
  reads: ChatRead[]
  me: string
  documents: { id: string; title: string }[]
  realtime: boolean
  lang: Lang
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [doc, setDoc] = useState('')
  const [extra, setExtra] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void markChannelRead(channelId)
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [channelId, messages.length])

  useEffect(() => {
    if (!realtime) return
    const sb = createSupabaseBrowserClient()
    const sub = sb
      .channel(`chat:${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channelId}` },
        () => router.refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_reads', filter: `channel_id=eq.${channelId}` },
        () => router.refresh(),
      )
      .subscribe()
    return () => {
      void sb.removeChannel(sub)
    }
  }, [channelId, realtime, router])

  function send() {
    setError(null)
    start(async () => {
      const r = await sendChatMessage({ channelId, body, link, documentId: doc })
      if (r.error) {
        setError(r.error)
        return
      }
      setBody('')
      setLink('')
      setDoc('')
      setExtra(false)
      router.refresh()
    })
  }

  const others = reads.filter((r) => r.user_id !== me)
  const myLast = [...messages].reverse().find((m) => m.sender_id === me)
  const readersOfMyLast = myLast ? others.filter((r) => r.last_read_at >= myLast.created_at).length : 0
  const time = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <div className="flex h-[70vh] min-h-[420px] flex-col">
      <ul className="flex-1 space-y-2 overflow-y-auto px-1 py-2">
        {messages.length === 0 ? (
          <li className="py-8 text-center text-t12 text-ink-muted">{tr(lang, '아직 대화가 없습니다.', 'No messages yet.')}</li>
        ) : null}
        {messages.map((m) => {
          const mine = m.sender_id === me
          return (
            <li key={m.message_id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              {!mine ? <span className="px-1 text-t10h text-ink-muted">{m.sender_name}</span> : null}
              <div className={`max-w-[78%] rounded-xl px-3 py-2 text-t12h leading-relaxed ${mine ? 'bg-accent text-white' : 'bg-raised'}`}>
                {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                {m.link ? (
                  m.link.startsWith('/') ? (
                    <Link href={m.link} className="block underline underline-offset-2">🔗 {m.link}</Link>
                  ) : (
                    <a href={m.link} target="_blank" rel="noreferrer noopener" className="block break-all underline underline-offset-2">🔗 {m.link}</a>
                  )
                ) : null}
                {m.document_id ? (
                  m.document_title ? (
                    <Link href={`/documents/${encodeURIComponent(m.document_id)}`} className="mt-1 block underline underline-offset-2">📄 {m.document_title}</Link>
                  ) : (
                    <span className="mt-1 block opacity-70">📄 {tr(lang, '볼 수 없는 문서', 'A document you can’t view')}</span>
                  )
                ) : null}
              </div>
              <span className="px-1 text-t10 text-ink-muted tnum">
                {time(m.created_at)}
                {mine && myLast?.message_id === m.message_id && readersOfMyLast > 0
                  ? ` · ${kind === 'dm' ? tr(lang, '읽음', 'Read') : tr(lang, `읽음 ${readersOfMyLast}`, `Read by ${readersOfMyLast}`)}`
                  : ''}
              </span>
            </li>
          )
        })}
        <div ref={bottom} />
      </ul>

      <div className="border-t border-line-soft pt-2">
        {error ? (
          <p role="alert" className="mb-1 text-t11h text-critical">
            {error}
          </p>
        ) : null}
        {extra ? (
          <div className="mb-1.5 grid gap-1.5 sm:grid-cols-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={tr(lang, '링크 (https://… 또는 /…)', 'Link (https://… or /…)')}
              className="rounded-md border border-line bg-panel px-2 py-1.5 text-t12"
            />
            <select value={doc} onChange={(e) => setDoc(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1.5 text-t12">
              <option value="">{tr(lang, '문서 첨부 (선택)', 'Attach document')}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            onClick={() => setExtra((x) => !x)}
            aria-label={tr(lang, '링크 · 문서 첨부', 'Attach')}
            className="rounded-md border border-line bg-raised px-2.5 py-2 text-t12 text-ink-dim"
          >
            📎
          </button>
          {/* 입력칸 높이는 폰 · 태블릿 44px(터치 과녁), 1024px 이상은 원래 38px. */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            enterKeyHint="send"
            placeholder={tr(lang, '메시지 (Enter 보내기, Shift+Enter 줄바꿈)', 'Message (Enter to send)')}
            className="min-h-11 flex-1 resize-none rounded-md border border-line bg-panel px-2.5 py-2 text-t12h lg:min-h-[38px]"
          />
          <button
            type="button"
            onClick={send}
            disabled={pending || (!body.trim() && !link.trim() && !doc)}
            className="rounded-md bg-accent px-3 py-2 text-t12h font-semibold text-white disabled:opacity-40"
          >
            {tr(lang, '보내기', 'Send')}
          </button>
        </div>
      </div>
    </div>
  )
}
