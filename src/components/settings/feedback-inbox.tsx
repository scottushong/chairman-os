'use client'

import { useMemo, useState, useTransition } from 'react'

import { bundleFeedback, setBundleStatus, setFeedbackStatus, triageFeedback } from '@/app/actions/feedback'
import {
  FEEDBACK_EXCLUDE_LABEL_KO,
  FEEDBACK_STATUS,
  FEEDBACK_STATUS_LABEL_KO,
  type AiFeedback,
  type AiFeedbackBundle,
  type FeedbackStatus,
  type FeedbackTriage,
} from '@/types'

/**
 * /settings/feedback의 몸통(0069). 거르기(상태 · 쓴 사람 · 화면 · 날짜) · 의견 카드 · AI 정리 · 지시문 복사 · 묶음.
 * 지시문은 **복사만** 된다 — 누르면 클립보드로 가고 상태가 «지시문 복사함»이 된다. 실행 버튼은 없다.
 */

const ROLE_KO: Record<string, string> = {
  Chairman: '회장',
  GroupCFO: '그룹 CFO',
  BusinessCEO: '회사 대표',
  Executive: '임원',
  TeamLead: '팀장',
  Member: '사원',
}

const screenOf = (path: string) => path.split('?')[0]
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10)

export function FeedbackInbox({
  rows,
  bundles,
  cost,
  aiConnected,
}: {
  rows: AiFeedback[]
  bundles: AiFeedbackBundle[]
  cost: { usd: number; calls: number; month: string }
  aiConnected: boolean
}) {
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('all')
  const [author, setAuthor] = useState('all')
  const [screen, setScreen] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, start] = useTransition()

  const authors = useMemo(() => [...new Map(rows.map((r) => [r.author_id, r.author_name])).entries()], [rows])
  const screens = useMemo(() => [...new Set(rows.map((r) => screenOf(r.path)))].sort(), [rows])
  const counts = useMemo(() => Object.fromEntries(FEEDBACK_STATUS.map((s) => [s, rows.filter((r) => r.status === s && !r.cancelled_at).length])), [rows])

  const shown = rows.filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      (author === 'all' || r.author_id === author) &&
      (screen === 'all' || screenOf(r.path) === screen) &&
      (!from || kstDay(r.created_at) >= from) &&
      (!to || kstDay(r.created_at) <= to),
  )

  function run(fn: () => Promise<{ error?: string }>, ok: string) {
    setNotice(null)
    start(async () => {
      const r = await fn()
      setNotice(r.error ?? ok)
    })
  }

  const pickable = (r: AiFeedback) => !r.ai_excluded && !r.cancelled_at && !r.bundle_id
  const pickedRows = rows.filter((r) => picked.includes(r.feedback_id))
  const pickedScreens = new Set(pickedRows.map((r) => screenOf(r.path)))

  return (
    <div className="mt-4 space-y-3">
      <section className="grid gap-2 sm:grid-cols-3">
        <Stat label="새것" value={`${counts.new ?? 0}건`} />
        <Stat label="AI 정리됨 · 복사 대기" value={`${counts.triaged ?? 0}건`} />
        <Stat
          label={`AI 정리 비용 · ${cost.month}`}
          value={`$${cost.usd.toFixed(4)}`}
          note={`${cost.calls}회 · 버튼 + 밤 묶음 · ai_usage_log 추정`}
        />
      </section>

      <section className="rounded-xl border border-line-soft bg-panel p-3">
        <div className="grid gap-2 sm:grid-cols-5">
          <Pick label="상태" value={status} onChange={(v) => setStatus(v as FeedbackStatus | 'all')}>
            <option value="all">전부</option>
            {FEEDBACK_STATUS.map((s) => (
              <option key={s} value={s}>
                {FEEDBACK_STATUS_LABEL_KO[s]}
              </option>
            ))}
          </Pick>
          <Pick label="쓴 사람" value={author} onChange={setAuthor}>
            <option value="all">전부</option>
            {authors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Pick>
          <Pick label="화면" value={screen} onChange={setScreen}>
            <option value="all">전부</option>
            {screens.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Pick>
          <label className="text-t10h text-ink-muted">
            날짜부터
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink" />
          </label>
          <label className="text-t10h text-ink-muted">
            날짜까지
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink" />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-t11h">
          <span className="text-ink-muted">
            {shown.length}건 · 고른 것 {picked.length}건{pickedScreens.size > 1 ? ' — 같은 화면만 묶습니다' : ''}
          </span>
          <button
            type="button"
            disabled={busy || picked.length < 2 || pickedScreens.size !== 1 || !aiConnected}
            onClick={() =>
              run(async () => {
                const r = await bundleFeedback(picked)
                if (!r.error) setPicked([])
                return r
              }, '묶음 지시문을 만들었습니다 — 아래 «묶음»에서 복사하세요.')
            }
            className="min-h-9 rounded-md border border-accent px-3 text-accent disabled:opacity-40"
          >
            고른 것 묶음 지시문 만들기
          </button>
          {!aiConnected ? <span className="text-ink-muted">이 환경에는 AI 연결이 없어 정리 버튼이 꺼져 있습니다.</span> : null}
        </div>
        {notice ? (
          <p role="status" className="mt-2 rounded-md bg-raised px-2.5 py-1.5 text-t11h text-ink">
            {notice}
          </p>
        ) : null}
      </section>

      {bundles.length ? (
        <section className="space-y-2">
          <h2 className="text-t13 font-semibold">묶음 지시문</h2>
          {bundles.map((b) => (
            <article key={b.bundle_id} className="rounded-xl border border-accent/30 bg-panel p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-t12 font-semibold">{b.title}</h3>
                <span className="text-t10h text-ink-muted">
                  {b.screen} · 의견 {b.feedback_ids.length}개 · {kstDay(b.created_at)} · {b.triage.by === 'AIAgent' ? '밤 묶음' : '버튼'}
                </span>
                <span className="ml-auto rounded bg-raised px-1.5 py-0.5 text-t10 text-ink-dim">{FEEDBACK_STATUS_LABEL_KO[b.status]}</span>
              </div>
              <TriageView
                triage={b.triage}
                busy={busy}
                onCopied={() => run(() => setBundleStatus(b.bundle_id, 'copied'), '지시문을 복사했습니다 — Claude Code에 직접 붙이세요.')}
              />
              <StatusButtons
                busy={busy}
                options={['applied', 'held', 'new'] as const}
                onPick={(s) => run(() => setBundleStatus(b.bundle_id, s), `묶음 상태: ${FEEDBACK_STATUS_LABEL_KO[s]}`)}
              />
            </article>
          ))}
        </section>
      ) : null}

      <section className="space-y-2">
        {shown.length === 0 ? <p className="rounded-xl border border-line-soft bg-panel p-6 text-center text-t12 text-ink-muted">조건에 맞는 의견이 없습니다.</p> : null}
        {shown.map((r) => (
          <article key={r.feedback_id} className={`rounded-xl border bg-panel p-3 ${r.cancelled_at ? 'border-line-soft opacity-60' : 'border-line'}`}>
            <div className="flex flex-wrap items-center gap-2 text-t10h text-ink-muted">
              <input
                type="checkbox"
                aria-label="묶음에 고르기"
                disabled={!pickable(r)}
                checked={picked.includes(r.feedback_id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.feedback_id] : p.filter((x) => x !== r.feedback_id)))}
                className="size-4"
              />
              <span className="font-semibold text-ink">{r.author_name}</span>
              <span>{ROLE_KO[r.author_role] ?? r.author_role}</span>
              <span>· {r.path}</span>
              <span>· {r.created_at.slice(0, 16).replace('T', ' ')} UTC</span>
              <span className="ml-auto rounded bg-raised px-1.5 py-0.5 text-t10 text-ink-dim">{FEEDBACK_STATUS_LABEL_KO[r.status]}</span>
              {r.ai_excluded ? (
                <span className="rounded bg-critical/10 px-1.5 py-0.5 text-t10 font-semibold text-critical">
                  AI 정리 제외 · {r.excluded_reasons.map((x) => FEEDBACK_EXCLUDE_LABEL_KO[x] ?? x).join(', ') || '민감'}
                </span>
              ) : null}
              {r.cancelled_at ? <span className="rounded bg-raised px-1.5 py-0.5 text-t10">쓴 사람이 취소</span> : null}
              {r.bundle_id ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-t10 text-accent">묶음</span> : null}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-t12h text-ink">{r.body}</p>
            <details className="mt-1.5">
              <summary className="cursor-pointer text-t10h text-ink-muted">질문 · 답 원문</summary>
              <div className="mt-1 space-y-1 rounded-md bg-raised p-2 text-t11h">
                <p>
                  <span className="text-ink-muted">질문 </span>
                  {r.question || '(없음)'}
                </p>
                <p className="whitespace-pre-wrap">
                  <span className="text-ink-muted">답 </span>
                  {r.answer}
                </p>
              </div>
            </details>
            {r.triage ? (
              <TriageView
                triage={r.triage}
                busy={busy}
                onCopied={() => run(() => setFeedbackStatus(r.feedback_id, 'copied'), '지시문을 복사했습니다 — Claude Code에 직접 붙이세요.')}
              />
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy || !pickable(r) || !aiConnected}
                onClick={() => run(() => triageFeedback(r.feedback_id), 'AI 정리를 마쳤습니다.')}
                className="min-h-9 rounded-md bg-accent px-3 text-t11h font-semibold text-on-accent disabled:opacity-40"
              >
                {r.triage ? 'AI 정리 다시' : 'AI 정리'}
              </button>
              <StatusButtons
                busy={busy}
                options={['applied', 'held', 'new'] as const}
                onPick={(s) => run(() => setFeedbackStatus(r.feedback_id, s), `상태: ${FEEDBACK_STATUS_LABEL_KO[s]}`)}
              />
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}

function TriageView({ triage, busy, onCopied }: { triage: FeedbackTriage; busy: boolean; onCopied: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-line-soft bg-raised p-2.5 text-t11h">
      <p>
        <span className="font-semibold">① 내용 요약 </span>
        {triage.summary}
      </p>
      <p>
        <span className="font-semibold">② 기대 결과 </span>
        {triage.expected}
      </p>
      <details>
        <summary className="cursor-pointer font-semibold">③ Claude Code 지시문</summary>
        <p className="mt-1 rounded bg-gold/10 px-2 py-1 text-t10h text-ink-dim">
          사용자 글에서 AI가 만든 초안입니다 — 붙이기 전에 읽어 보세요. «회장 확인 필요» 줄은 정한 뒤에. 자동으로 실행되지 않습니다.
        </p>
        <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-panel p-2 text-t11 leading-relaxed">{triage.instruction}</pre>
      </details>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(triage.instruction)
            setCopied(true)
            onCopied()
          } catch {
            setCopied(false)
          }
        }}
        className="min-h-9 rounded-md border border-line bg-panel px-3 font-semibold hover:border-accent disabled:opacity-40"
      >
        {copied ? '복사됨' : '지시문 복사'}
      </button>
      <span className="ml-2 text-t10 text-ink-muted">{triage.by === 'AIAgent' ? '밤 묶음 정리' : '버튼 정리'} · {triage.model}</span>
    </div>
  )
}

function StatusButtons<T extends FeedbackStatus>({ busy, options, onPick }: { busy: boolean; options: readonly T[]; onPick: (s: T) => void }) {
  return (
    <>
      {options.map((s) => (
        <button
          key={s}
          type="button"
          disabled={busy}
          onClick={() => onPick(s)}
          className="min-h-9 rounded-md border border-line bg-panel px-2.5 text-t11h text-ink-dim hover:border-accent hover:text-ink disabled:opacity-40"
        >
          {s === 'new' ? '새것으로' : FEEDBACK_STATUS_LABEL_KO[s]}
        </button>
      ))}
    </>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line-soft bg-panel px-3 py-2.5">
      <p className="text-t10h text-ink-muted">{label}</p>
      <p className="text-t15 font-semibold tnum">{value}</p>
      {note ? <p className="text-t10 text-ink-muted">{note}</p> : null}
    </div>
  )
}

function Pick({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="text-t10h text-ink-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink">
        {children}
      </select>
    </label>
  )
}
