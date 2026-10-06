'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { submitApprovalForm } from '@/app/actions/approval-form'
import { StepHeader, StepNav, useMobileSteps } from '@/components/ui/mobile-steps'
import { approvalLine, missingFields } from '@/lib/approval-line'
import { boss, bossEn, bossText } from '@/lib/boss'
import { tr, type Lang } from '@/lib/i18n'
import type { ApprovalLead, ApprovalTemplate, Role } from '@/types'

/**
 * /approvals/new — 양식 고르기 → 항목 채우기 → **결재선 미리보기** → 올리기 (Phase 9 블록 2).
 *
 * 미리보기는 lib/approval-line.ts가 그린다. 제출하면 0038 트리거가 같은 규칙으로 결재선을 새로
 * 만들어 얼린다 — 이 화면의 결재선은 «이렇게 올라갈 것이다»이지 저장되는 값이 아니다.
 */
export function ApprovalForm({
  templates,
  lead,
  businesses,
  defaultDeadline,
  lang,
  viewerRole,
  afterSubmit,
}: {
  templates: ApprovalTemplate[]
  lead: ApprovalLead | null
  businesses: { id: string; name: string }[]
  defaultDeadline: string
  lang: Lang
  /** 결재선의 호칭(회장/대표)을 보는 사람에 맞춘다 — 직원 화면 용어 원칙(CLAUDE.md). */
  viewerRole: Role | null
  /** 올린 뒤 갈 곳. 없으면 그 결재의 상세(/approvals?id=). 직원 홈은 /me?tab=requests로 돌아간다. */
  afterSubmit?: string
}) {
  const router = useRouter()
  const [key, setKey] = useState(templates[0]?.template_key ?? 'expense')
  const [form, setForm] = useState<Record<string, string>>({})
  const [business, setBusiness] = useState(businesses[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // 폰은 ① 양식·기본 ② 항목 ③ 결재선·올리기 세 화면으로 넘긴다(mobile-steps.tsx). 640px 이상은 지금 그대로 한 화면.
  const steps = useMobileSteps(3)

  const template = templates.find((t) => t.template_key === key) ?? templates[0]
  const line = useMemo(() => (template ? approvalLine(template, form, lead) : []), [template, form, lead])
  if (!template) return null
  const missing = missingFields(template, form)

  function submit() {
    setError(null)
    start(async () => {
      const result = await submitApprovalForm({
        templateKey: key,
        businessId: business,
        title,
        deadline,
        form,
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
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      className={input}
                    />
                  ) : (
                    <input
                      type={f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'}
                      inputMode={f.type === 'money' || f.type === 'number' ? 'numeric' : f.type === 'url' ? 'url' : undefined}
                      placeholder={f.type === 'url' ? 'https://' : undefined}
                      enterKeyHint="next"
                      value={form[f.key] ?? ''}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
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
          <ol className="space-y-2">
            {line.map((s, i) => (
              <li key={s.step} className="flex items-start gap-2">
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
                  {/* 팀장 칸이 직속 상위(대표 본인)일 수 있다 — 이름도 bossText로(직원 화면 용어 원칙). */}
                  <span className="block text-t12h font-semibold">{bossText(s.name, viewerRole)}</span>
                  <span className="block text-t11 text-ink-dim">{bossText(s.why, viewerRole)}</span>
                </span>
              </li>
            ))}
          </ol>
          {line.every((s) => s.step !== 'chairman') ? (
            <p className="rounded-md bg-raised px-2 py-1.5 text-t11 text-ink-dim">
              {/* 0042/0054 — 팀장 칸이 비면(대표는 팀장 칸에 서지 않는다) 팀장 단계를 건너뛰고 규칙이 바로 종결한다(decided_by_kind 'rule'). */}
              {line[0]?.user_id
                ? tr(lang, `${boss(viewerRole)}까지 올라가지 않는 결재입니다.`, `This does not go up to ${bossEn(viewerRole)}.`)
                : tr(
                    lang,
                    `팀장 결재 단계가 없어(팀장 · 직속 상위가 없거나 ${boss(viewerRole)}) 올리면 «기록 완료»로 바로 저장됩니다. ${boss(viewerRole)}도 목록에서 볼 수 있습니다.`,
                    `No lead step (no lead, or the only one above is ${bossEn(viewerRole)}) — this is saved as «Recorded» right away. ${bossEn(viewerRole)} can still see it.`,
                  )}
            </p>
          ) : null}
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
            disabled={pending || missing.length > 0}
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
