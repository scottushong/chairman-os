'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'

import { approvalChainAction, submitApprovalForm } from '@/app/actions/approval-form'
import { chainText } from '@/components/approvals/chain-text'
import { StepHeader, StepNav, useMobileSteps } from '@/components/ui/mobile-steps'
import { NumberInput } from '@/components/ui/number-input'
import { chainLine } from '@/lib/approval-chain'
import { AMOUNT_INVALID_MESSAGE, amountInvalid, missingFields } from '@/lib/approval-line'
import type { ApprovalChainPreview } from '@/lib/approval-submit'
import { boss, bossEn, isChairman } from '@/lib/boss'
import { tr, type Lang } from '@/lib/i18n'
import type { ApprovalLead, ApprovalTemplate, ApprovalTemplateKey, Role } from '@/types'

/** 반려된 결재를 고쳐 다시 올릴 때(0059 재상신) 채워 둘 값. */
export interface ApprovalFormInitial {
  templateKey: ApprovalTemplateKey
  businessId: string
  title: string
  form: Record<string, string>
  resubmitOf: string
}

/**
 * /approvals/new — 양식 고르기 → 항목 채우기 → **결재선 미리보기** → 올리기 (Phase 9 블록 2).
 *
 * 미리보기는 lib/approval-chain.ts(0059 거울)가 그린다 — 조직도 상사 사슬 → (기준 이상 · 계약 · 채용이면) 대표.
 * 사슬은 회사마다 다르다(그 회사 접근이 없는 상사는 건너뛴다). 서버가 미리 준 회사는 그 값, 없는 회사는 고를 때 묻는다.
 * 제출하면 0059 트리거가 같은 규칙으로 결재선을 새로 만들어 얼린다 — 이 화면의 결재선은 «이렇게 올라갈 것이다»이지 저장되는 값이 아니다.
 */
export function ApprovalForm({
  templates,
  chains,
  initial,
  businesses,
  defaultDeadline,
  lang,
  viewerRole,
  afterSubmit,
}: {
  templates: ApprovalTemplate[]
  /** 0059 이전의 결재선 첫 칸. 더는 미리보기에 쓰지 않는다 — 부르는 화면이 아직 넘기면 받기만 한다. */
  lead?: ApprovalLead | null
  /** 회사 id → 상사 사슬(서버가 미리 읽은 것). 없는 회사는 고를 때 approvalChainAction으로 묻는다. */
  chains?: Record<string, ApprovalChainPreview>
  /** 재상신(/approvals/new?resubmit=) — 원본 값으로 채워 두고 resubmit_of로 올린다. */
  initial?: ApprovalFormInitial
  businesses: { id: string; name: string }[]
  defaultDeadline: string
  lang: Lang
  /** 결재선의 호칭(회장/대표)을 보는 사람에 맞춘다 — 직원 화면 용어 원칙(CLAUDE.md). */
  viewerRole: Role | null
  /** 올린 뒤 갈 곳. 없으면 그 결재의 상세(/approvals?id=). 직원 홈은 /me?tab=requests로 돌아간다. */
  afterSubmit?: string
}) {
  const router = useRouter()
  const [key, setKey] = useState(initial?.templateKey ?? templates[0]?.template_key ?? 'expense')
  const [form, setForm] = useState<Record<string, string>>(initial?.form ?? {})
  const [business, setBusiness] = useState(initial?.businessId ?? businesses[0]?.id ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [chainBy, setChainBy] = useState<Record<string, ApprovalChainPreview>>(chains ?? {})
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // 폰은 ① 양식·기본 ② 항목 ③ 결재선·올리기 세 화면으로 넘긴다(mobile-steps.tsx). 640px 이상은 지금 그대로 한 화면.
  const steps = useMobileSteps(3)

  // 미리 받지 않은 회사의 사슬은 고를 때 묻는다(/me의 요청 올리기는 미리 받지 않는다).
  const known = business ? chainBy[business] : undefined
  useEffect(() => {
    if (!business || known) return
    let live = true
    approvalChainAction(business).then((c) => {
      if (live) setChainBy((cur) => ({ ...cur, [business]: c }))
    })
    return () => {
      live = false
    }
  }, [business, known])

  const selfClose = isChairman(viewerRole)
  const template = templates.find((t) => t.template_key === key) ?? templates[0]
  const line = useMemo(
    () =>
      template && known && !selfClose
        ? chainLine(template, form, known.bosses, { user_id: null, name: boss(viewerRole) }, known.directBossIsChairman)
        : [],
    [template, form, known, selfClose, viewerRole],
  )
  if (!template) return null
  const missing = missingFields(template, form)
  // 0054 리뷰 C1 — 금액이 숫자 모양이 아니면 미리보기도 «기록 완료»라 말하지 않고, 올리지 못한다.
  const badAmount = missing.length === 0 && amountInvalid(template, form)

  function submit() {
    setError(null)
    start(async () => {
      const result = await submitApprovalForm({
        templateKey: key,
        businessId: business,
        title,
        deadline,
        form,
        resubmitOf: initial?.resubmitOf,
      })
      if (result.error) setError(result.error)
      else if (result.decisionId) router.push(afterSubmit ?? `/approvals?id=${result.decisionId}`)
    })
  }

  const input = 'w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-t12h'
  const label = (ko: string, en: string, required = false) => (
    <span className="mb-1 block text-t11 text-ink-dim">
      {tr(lang, ko, en)}
      {required ? <span className="ml-0.5 text-critical">*</span> : null}
    </span>
  )

  return (
    <>
      <StepHeader
        steps={steps}
        className="mt-4"
        labels={[
          tr(lang, '양식 · 기본', 'Template'),
          tr(lang, '항목', 'Fields'),
          tr(lang, '결재선 · 올리기', 'Review'),
        ]}
      />
      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className={`glass space-y-4 rounded-glass p-5 ${steps.step === 2 ? 'max-sm:hidden' : ''}`}>
          <div
            className={`flex flex-wrap gap-1.5 ${steps.only(0)}`}
            role="tablist"
            aria-label={tr(lang, '결재 양식', 'Templates')}
          >
            {templates.map((t) => (
              <button
                key={t.template_key}
                type="button"
                role="tab"
                aria-selected={t.template_key === key}
                onClick={() => {
                  setKey(t.template_key)
                  setForm({})
                }}
                className={`rounded-lg border px-3 py-1.5 text-t12h font-semibold ${
                  t.template_key === key
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-raised hover:border-accent'
                }`}
              >
                {lang === 'en' ? t.name_en : t.name_ko}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* 단계 묶음은 display:contents다 — 640px 이상에서는 칸들이 지금처럼 한 격자에 그대로 흐른다. */}
            <div className={`contents ${steps.only(0)}`}>
              <label>
                {label('회사', 'Company', true)}
                <select value={business} onChange={(e) => setBusiness(e.target.value)} className={input}>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {label('결재 기한', 'Due', true)}
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={input} />
              </label>
              <label className="sm:col-span-2">
                {label('제목 (비우면 양식 이름으로)', 'Title (optional)')}
                <input value={title} enterKeyHint="next" onChange={(e) => setTitle(e.target.value)} className={input} />
              </label>
            </div>

            <div className={`contents ${steps.only(1)}`}>
              {template.fields.map((f) => (
                <label key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  {label(f.label_ko, f.label_en, f.required)}
                  {f.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={form[f.key] ?? ''}
                      onChange={(e) => setForm((cur) => ({ ...cur, [f.key]: e.target.value }))}
                      className={input}
                    />
                  ) : f.type === 'money' || f.type === 'number' ? (
                    // 2026-10-07 — 숫자만 · 세 자리 쉼표 · 숫자 키패드 · 금액은 «원»과 한글 읽기(components/ui/number-input.tsx).
                    <NumberInput
                      kind={f.type}
                      enterKeyHint="next"
                      value={form[f.key] ?? ''}
                      onChange={(v) => setForm((cur) => ({ ...cur, [f.key]: v }))}
                      className={input}
                    />
                  ) : (
                    <input
                      type={f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'}
                      inputMode={f.type === 'url' ? 'url' : undefined}
                      placeholder={f.type === 'url' ? 'https://' : undefined}
                      enterKeyHint="next"
                      value={form[f.key] ?? ''}
                      onChange={(e) => setForm((cur) => ({ ...cur, [f.key]: e.target.value }))}
                      className={input}
                    />
                  )}
                </label>
              ))}

            </div>
          </div>
        </section>

        <aside className={`glass space-y-3 rounded-glass p-4 ${steps.only(2)}`}>
          <h2 className="text-t13 font-semibold">{tr(lang, '결재선 미리보기', 'Approval line preview')}</h2>
          {selfClose ? (
            // 0059 — 대표 본인이 올린 양식 결재는 결재선 없이 대표 결정으로 바로 닫힌다(자기 결재를 자기에게 올리지 않는다).
            <p className="rounded-md bg-raised px-2 py-1.5 text-t11 text-ink-dim">
              {tr(lang, `${boss(viewerRole)} 본인 결재 — 올리면 바로 승인으로 닫힙니다.`, `Your own approval — it closes as approved right away.`)}
            </p>
          ) : !known ? (
            <p className="text-t11 text-ink-muted">{tr(lang, '결재선을 불러오는 중…', 'Loading the approval line…')}</p>
          ) : (
            <ol className="space-y-2">
              {line.map((s, i) => (
                <li key={`${s.step}-${i}`} className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-t10h font-bold ${
                      s.step === 'chairman'
                        ? 'bg-gold text-white'
                        : s.step === 'rule'
                          ? 'bg-line-soft text-ink-dim'
                          : 'bg-accent text-white'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    {/* 상사 칸은 사람 이름 그대로, 대표 칸 · 규칙 문장은 보는 사람의 호칭으로(직원 화면 용어 원칙). */}
                    <span className="block text-t12h font-semibold">{s.step === 'boss' ? s.name : chainText(s.name, viewerRole)}</span>
                    <span className="block text-t11 text-ink-dim">{chainText(s.why, viewerRole)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {badAmount ? (
            <p role="alert" className="rounded-md border border-critical/40 bg-raised px-2 py-1.5 text-t11h text-critical">
              {tr(lang, AMOUNT_INVALID_MESSAGE, 'Write the amount as a number — e.g. 6000000 or 6,000,000')}
            </p>
          ) : null}
          <p className="rounded-md bg-raised px-2 py-1.5 text-t11 text-ink-dim">
            {tr(
              lang,
              `기준 금액 미만은 직속 상사 승인으로 끝나고, 이상이면 상사들을 거쳐 ${isChairman(viewerRole) ? '회장이' : '대표가'} 최종 승인합니다.`,
              `Below the threshold your direct manager closes it; at or above it goes up the chain to ${bossEn(viewerRole)} for final approval.`,
            )}
          </p>
          <p className="text-t10h leading-relaxed text-ink-muted">
            {tr(
              lang,
              '올리는 순간 서버가 같은 규칙으로 결재선을 다시 만들어 고정합니다. 이후 조직이 바뀌어도 이 결재의 결재선은 바뀌지 않습니다.',
              'On submit the server rebuilds this line with the same rule and freezes it.',
            )}
          </p>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-critical/40 bg-raised px-2 py-1.5 text-t11h text-critical"
            >
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={pending || missing.length > 0 || badAmount}
            className="w-full rounded-lg bg-accent px-3 py-2 text-t13 font-semibold text-white disabled:opacity-40"
          >
            {pending ? tr(lang, '올리는 중…', 'Submitting…') : tr(lang, '결재 올리기', 'Submit')}
          </button>
          {missing.length > 0 ? (
            <p className="text-t11 text-ink-muted">
              {tr(lang, '필수 항목을 채우면 올릴 수 있습니다.', 'Fill the required fields to submit.')}
            </p>
          ) : null}
        </aside>
      </div>
      <StepNav
        steps={steps}
        className="mt-4"
        prevLabel={tr(lang, '이전', 'Back')}
        nextLabel={tr(lang, '다음', 'Next')}
      />
    </>
  )
}
