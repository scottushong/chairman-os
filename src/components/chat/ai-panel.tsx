'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { askAi } from '@/app/actions/chat'
import { tr, type Lang } from '@/lib/i18n'
import type { AiChatMessage } from '@/types'

/**
 * «AI에게 묻기» (CH-044). 답마다 «결정 아님»을 붙이고 근거 링크를 단다.
 * AI가 보는 것은 **이 사람의 권한 안의 데이터뿐이다** — 화면이 그 사실을 입력칸 위에 적는다.
 */
const EXAMPLES_KO = ['왜 DY가 yellow인가', '이번 달 구매 요청 합계', '진행 중인 이니셔티브의 다음 행동']

export function AiPanel({
  chatId,
  messages,
  lang,
}: {
  chatId: string | null
  messages: AiChatMessage[]
  lang: Lang
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function ask(question: string) {
    setError(null)
    start(async () => {
      const r = await askAi({ chatId, question })
      if (r.error) {
        setError(r.error)
        return
      }
      setQ('')
      if (r.chatId && r.chatId !== chatId) router.push(`/chat?tab=ai&ai=${r.chatId}`)
      else router.refresh()
    })
  }

  return (
    <div className="flex h-[70vh] min-h-[420px] flex-col">
      <p className="rounded-md bg-raised px-2.5 py-1.5 text-[11px] text-ink-dim">
        {tr(
          lang,
          'AI는 내가 볼 수 있는 데이터만 봅니다(권한 밖 자료는 AI에게도 보이지 않습니다). 답은 참고용이며 결정이 아닙니다. 질문의 앞부분은 감사 기록에 남고 본인과 회장만 봅니다.',
          'AI only sees data you are allowed to see. Answers are for reference, not decisions. A summary of each question is audit-logged (visible to you and the Chairman).',
        )}
      </p>
      <ul className="flex-1 space-y-3 overflow-y-auto px-1 py-3">
        {messages.length === 0 ? (
          <li className="space-y-1.5 py-4 text-center text-[12px] text-ink-muted">
            <p>{tr(lang, '예를 들어 이렇게 물어보세요.', 'Try asking:')}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {EXAMPLES_KO.map((e) => (
                <button key={e} type="button" onClick={() => ask(e)} disabled={pending} className="rounded-full border border-line bg-raised px-2.5 py-1 text-[11.5px] hover:border-accent">
                  {e}
                </button>
              ))}
            </div>
          </li>
        ) : null}
        {messages.map((m) =>
          m.role === 'user' ? (
            <li key={m.id} className="flex justify-end">
              <p className="max-w-[80%] rounded-xl bg-accent px-3 py-2 text-[12.5px] text-white">{m.content}</p>
            </li>
          ) : (
            <li key={m.id} className="max-w-[88%] rounded-xl bg-raised px-3 py-2 text-[12.5px] leading-relaxed">
              <span className="mb-1 inline-block rounded bg-line-soft px-1.5 py-0.5 text-[10px] font-semibold text-ink-dim">
                {tr(lang, '결정 아님', 'Not a decision')}
              </span>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.sources.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.sources.map((s) => (
                    <Link key={s.href + s.label} href={s.href} className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10.5px] text-ink-dim hover:text-ink">
                      ↗ {s.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </li>
          ),
        )}
        {pending ? <li className="text-[11.5px] text-ink-muted">{tr(lang, '생각하는 중…', 'Thinking…')}</li> : null}
      </ul>
      {error ? (
        <p role="alert" className="mb-1 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}
      <form
        className="flex gap-1.5 border-t border-line-soft pt-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) ask(q)
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr(lang, 'AI에게 묻기…', 'Ask AI…')}
          className="flex-1 rounded-md border border-line bg-panel px-2.5 py-2 text-[12.5px]"
        />
        <button type="submit" disabled={pending || !q.trim()} className="rounded-md bg-accent px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40">
          {tr(lang, '묻기', 'Ask')}
        </button>
      </form>
    </div>
  )
}
