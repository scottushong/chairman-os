'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { askAssistant } from '@/app/actions/assistant'
import { AssistantMessages } from '@/components/assistant/assistant-messages'
import { tr, type Lang } from '@/lib/i18n'
import type { AiActionView, AiChatMessage } from '@/types'

/**
 * /chat의 «AI» 탭 (CH-044). Phase 11부터 떠 있는 어시스턴트와 **같은 엔진 · 같은 대화 줄기**를 쓴다
 * (askAssistant · AssistantMessages) — 답마다 «결정 아님», 근거 카드, 제안이면 [확인] 카드.
 * AI가 보는 것은 이 사람의 권한 안의 데이터뿐이다 — 화면이 그 사실을 입력칸 위에 적는다.
 */
const EXAMPLES_KO = ['왜 DY가 yellow인가', '이번 달 구매 요청 합계', '진행 중인 이니셔티브의 다음 행동']

export function AiPanel({
  chatId,
  messages,
  actions,
  lang,
}: {
  chatId: string | null
  messages: AiChatMessage[]
  actions: AiActionView[]
  lang: Lang
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function ask(question: string) {
    setError(null)
    start(async () => {
      const r = await askAssistant({ chatId, question, path: '/chat' })
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
      <p className="rounded-md bg-raised px-2.5 py-1.5 text-t11 text-ink-dim">
        {tr(
          lang,
          'AI는 내가 볼 수 있는 데이터만 봅니다(권한 밖 자료는 AI에게도 보이지 않습니다). 답은 참고용이며 결정이 아닙니다. 고치는 제안은 [확인]을 눌러야 저장됩니다. 질문의 앞부분은 감사 기록에 남고 본인과 회장만 봅니다.',
          'AI only sees data you are allowed to see. Answers are for reference, not decisions. Proposed changes are saved only when you press Confirm. A summary of each question is audit-logged (visible to you and the Chairman).',
        )}
      </p>
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="space-y-1.5 py-4 text-center text-t12 text-ink-muted">
            <p>{tr(lang, '예를 들어 이렇게 물어보세요.', 'Try asking:')}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {EXAMPLES_KO.map((e) => (
                <button key={e} type="button" onClick={() => ask(e)} disabled={pending} className="rounded-full border border-line bg-raised px-2.5 py-1 text-t11h hover:border-accent">
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <AssistantMessages messages={messages} actions={actions} lang={lang} pending={pending} onChanged={() => router.refresh()} />
        {pending ? <p className="text-t11h text-ink-muted">{tr(lang, '생각하는 중…', 'Thinking…')}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="mb-1 text-t11h text-critical">
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
          className="flex-1 rounded-md border border-line bg-panel px-2.5 py-2 text-t12h"
        />
        <button type="submit" disabled={pending || !q.trim()} className="rounded-md bg-accent px-3 py-2 text-t12h font-semibold text-white disabled:opacity-40">
          {tr(lang, '묻기', 'Ask')}
        </button>
      </form>
    </div>
  )
}
