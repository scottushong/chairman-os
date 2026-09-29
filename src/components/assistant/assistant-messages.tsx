'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { cancelAiAction, confirmAiAction } from '@/app/actions/assistant'
import { tr, type Lang } from '@/lib/i18n'
import { AI_ACTION_LABEL_KO, type AiActionView, type AiChatMessage } from '@/types'

/**
 * 어시스턴트 대화 한 줄기 — 떠 있는 패널과 /chat의 AI 탭이 같이 쓴다.
 *
 * 답마다 «결정 아님» 표지, 근거 카드(도구가 실제로 읽은 화면 · 줄 — 코드가 만든 것), 그리고 그 답이 만든
 * **제안 카드**(전 → 후 미리보기 + [확인] [취소])를 붙인다. 확인을 눌러야 저장된다 — 카드가 그 사실을 글로 적는다.
 */
export function AssistantMessages({
  messages,
  actions,
  lang,
  pending,
  onChanged,
  onNavigate,
}: {
  messages: AiChatMessage[]
  actions: AiActionView[]
  lang: Lang
  pending: boolean
  onChanged: () => void
  onNavigate?: () => void
}) {
  const byId = new Map(actions.map((a) => [a.action_id, a]))
  return (
    <ul className="space-y-3 px-1 py-3">
      {messages.map((m) =>
        m.role === 'user' ? (
          <li key={m.id} className="flex justify-end">
            <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-t12h text-white">{m.content}</p>
          </li>
        ) : (
          <li key={m.id} className="max-w-[94%] rounded-2xl rounded-bl-sm border border-line-soft bg-raised px-3 py-2.5 text-t12h leading-relaxed">
            <span className="mb-1 inline-block rounded bg-gold/15 px-1.5 py-0.5 text-t10 font-semibold text-gold">{tr(lang, '결정 아님', 'Not a decision')}</span>
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.sources.length > 0 ? (
              <div className="mt-2 grid gap-1.5">
                {m.sources.map((s) => (
                  <Link
                    key={s.href + s.label}
                    href={s.href}
                    onClick={onNavigate}
                    className="flex min-h-11 flex-col justify-center rounded-lg border border-line bg-panel px-2.5 py-1.5 hover:border-accent"
                  >
                    <span className="text-t11h font-semibold text-ink">↗ {s.label}</span>
                    {s.detail ? <span className="text-t10h text-ink-muted">{s.detail}</span> : null}
                  </Link>
                ))}
              </div>
            ) : null}
            {(m.action_ids ?? []).map((id) => {
              const a = byId.get(id)
              return a ? <ActionCard key={id} action={a} lang={lang} busy={pending} onChanged={onChanged} onNavigate={onNavigate} /> : null
            })}
          </li>
        ),
      )}
    </ul>
  )
}

function ActionCard({
  action,
  lang,
  busy,
  onChanged,
  onNavigate,
}: {
  action: AiActionView
  lang: Lang
  busy: boolean
  onChanged: () => void
  onNavigate?: () => void
}) {
  const [note, setNote] = useState<{ ok: boolean; text: string; href?: string } | null>(null)
  const [working, start] = useTransition()
  // 만료는 서버가 판정한다(0046). 화면은 버튼을 감출지 고르는 데만 시각을 본다 — 눌러도 서버가 다시 본다.
  const [now] = useState(() => Date.now())
  const expired = action.status === 'pending' && Date.parse(action.expires_at) <= now
  const open = action.status === 'pending' && !expired && !note

  function decide(confirm: boolean) {
    start(async () => {
      const r = confirm ? await confirmAiAction(action.action_id) : await cancelAiAction(action.action_id)
      setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? '', href: r.href })
      onChanged()
    })
  }

  const statusText: Record<string, string> = {
    pending: expired ? tr(lang, '만료됨 — 다시 물어 새 제안을 받으세요', 'Expired') : tr(lang, '확인 전 · 아직 바뀌지 않았습니다', 'Not applied yet'),
    confirmed: tr(lang, '확인됨 · 실행 중', 'Confirmed'),
    cancelled: tr(lang, '취소함', 'Cancelled'),
    done: tr(lang, '저장됨', 'Saved'),
    failed: tr(lang, '실패', 'Failed'),
  }

  return (
    <div className="mt-2 rounded-xl border border-gold/40 bg-gold/5 p-2.5">
      <p className="flex flex-wrap items-center gap-1.5 text-t11h font-semibold text-ink">
        <span className="rounded bg-gold/15 px-1.5 py-0.5 text-t10 text-gold">{tr(lang, 'AI 제안', 'AI proposal')} · {AI_ACTION_LABEL_KO[action.kind]}</span>
        {action.preview.title}
      </p>
      <dl className="mt-1.5 space-y-1">
        {action.preview.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[5.5rem_1fr] gap-2 text-t11h">
            <dt className="text-ink-muted">{l.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words">
              {l.before !== null ? <span className="text-ink-muted line-through">{l.before}</span> : null}
              {l.before !== null ? <span className="text-ink-muted"> → </span> : null}
              <span className="font-semibold text-ink">{l.after}</span>
            </dd>
          </div>
        ))}
      </dl>
      {action.preview.warning ? <p className="mt-1.5 text-t10h text-warning">{action.preview.warning}</p> : null}
      <p className="mt-1.5 text-t10h text-ink-muted">
        {note ? '' : statusText[action.status]}
        {action.result && !note ? ` — ${action.result}` : ''}
      </p>
      {note ? (
        <p role="status" className={`mt-1 text-t11h ${note.ok ? 'text-ok' : 'text-critical'}`}>
          {note.text}
          {note.href ? (
            <Link href={note.href} onClick={onNavigate} className="ml-1.5 underline">
              {tr(lang, '열기', 'Open')}
            </Link>
          ) : null}
        </p>
      ) : null}
      {open ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy || working}
            onClick={() => decide(true)}
            className="min-h-11 flex-1 rounded-lg bg-gold px-3 text-t12h font-semibold text-ink disabled:opacity-40"
          >
            {working ? tr(lang, '처리 중…', 'Working…') : tr(lang, '확인 — 저장', 'Confirm')}
          </button>
          <button
            type="button"
            disabled={busy || working}
            onClick={() => decide(false)}
            className="min-h-11 rounded-lg border border-line bg-panel px-3 text-t12h text-ink-dim disabled:opacity-40"
          >
            {tr(lang, '취소', 'Cancel')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
