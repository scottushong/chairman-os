'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { leadBundleAction, leadDecideAction } from '@/app/actions/lead'
import { boss, bossEn, bossText } from '@/lib/boss'
import { tr, type Lang } from '@/lib/i18n'
import type { Decision, Role } from '@/types'

/**
 * 팀장 요청함 (Phase 6-2). 팀원이 올린 요청 가운데 내가 결재선 첫 칸인 것.
 * 승인하면 DB가 규칙으로 판정한다 — 이 화면은 그 결과(팀 선 종결 / 회장 결재)를 한 줄로 알려 준다.
 * 규칙 결과를 미리 보여 준다: 얼린 결재선의 «규칙 판정» 칸 그대로.
 */
export function TeamInbox({ pending, lang, viewerRole }: { pending: Decision[]; lang: Lang; viewerRole: Role | null }) {
  // 호칭은 보는 사람에 맞춘다 — 직원 화면 용어 원칙(CLAUDE.md).
  const b = boss(viewerRole)
  const bEn = bossEn(viewerRole)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [pendingUi, start] = useTransition()

  if (pending.length === 0) {
    return <p className="py-6 text-center text-t12h text-ink-muted">{tr(lang, '처리할 팀 요청이 없습니다.', 'No team requests to review.')}</p>
  }

  function act(d: Decision, approve: boolean, escalate = false) {
    start(async () => {
      const r = await leadDecideAction({ decisionId: d.decision_id, approve, escalate })
      setMsg((m) => ({ ...m, [d.decision_id]: r.error ?? r.message ?? '' }))
    })
  }

  return (
    <ul className="space-y-2">
      {pending.map((d) => {
        const rule = d.approval_line?.find((s) => s.step === 'rule')
        return (
          <li key={d.decision_id} className="rounded-xl border border-line-soft bg-raised p-3">
            <Link href={`/approvals?id=${d.decision_id}`} className="text-t13 font-semibold hover:text-accent">
              {d.title}
            </Link>
            {rule ? (
              <p className="mt-0.5 text-t11h text-ink-dim">
                {tr(lang, '규칙:', 'Rule:')} {bossText(rule.why, viewerRole)} → {d.chairman_required ? tr(lang, `${b} 결재`, `to ${bEn}`) : tr(lang, '팀 선 종결', 'closes at team level')}
              </p>
            ) : null}
            {msg[d.decision_id] ? (
              <p className="mt-1 text-t11h font-semibold">{msg[d.decision_id]}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" disabled={pendingUi} onClick={() => act(d, true)} className="rounded-md bg-accent px-3 py-1.5 text-t12 font-semibold text-white disabled:opacity-40">
                  {tr(lang, '승인', 'Approve')}
                </button>
                <button type="button" disabled={pendingUi} onClick={() => act(d, false)} className="rounded-md border border-line bg-panel px-3 py-1.5 text-t12">
                  {tr(lang, '반려', 'Reject')}
                </button>
                {!d.chairman_required ? (
                  <button type="button" disabled={pendingUi} onClick={() => act(d, true, true)} className="rounded-md border border-line bg-panel px-3 py-1.5 text-t12 text-ink-dim">
                    {tr(lang, `승인 + ${b} 확인 요청`, `Approve + ask ${bEn}`)}
                  </button>
                ) : null}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 회장 기안(취합) — 내가 승인해 회장 큐에 올린 열린 요청들을 한 건으로 묶는다. */
export function BundleComposer({ candidates, lang, viewerRole }: { candidates: Decision[]; lang: Lang; viewerRole: Role | null }) {
  const b = boss(viewerRole)
  const bEn = bossEn(viewerRole)
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (candidates.length < 2) {
    return (
      <p className="py-6 text-center text-t12h text-ink-muted">
        {tr(lang, `묶을 수 있는 요청이 두 건 이상일 때 씁니다(내가 승인해 ${b} 결재로 올린, 아직 열린 요청).`, `Needs two or more requests you approved up to ${bEn}.`)}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {candidates.map((d) => (
          <li key={d.decision_id}>
            <label className="flex items-center gap-2 rounded-md bg-raised px-2.5 py-2 text-t12h">
              <input
                type="checkbox"
                checked={picked.includes(d.decision_id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.decision_id] : p.filter((x) => x !== d.decision_id)))}
              />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <span className="text-t10h text-ink-muted tnum">{d.form?.amount ?? ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr(lang, '묶음 제목 (예: 생산팀 10월 설비 요청)', 'Bundle title')} className="w-full rounded-md border border-line bg-panel px-2.5 py-2 text-t12h" />
      <button
        type="button"
        disabled={pending || picked.length < 2 || !title.trim()}
        onClick={() =>
          start(async () => {
            const r = await leadBundleAction({ decisionIds: picked, title })
            setResult(r.error ?? tr(lang, `${b} 기안으로 올렸습니다 (${r.id}).`, `Sent to ${bEn} (${r.id}).`))
          })
        }
        className="w-full rounded-md bg-accent px-3 py-2 text-t12h font-semibold text-white disabled:opacity-40"
      >
        {tr(lang, `${picked.length}건 묶어 ${b}에게 올리기`, `Bundle ${picked.length} to ${bEn}`)}
      </button>
      {result ? <p className="text-t12 font-semibold">{result}</p> : null}
    </div>
  )
}
