'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { submitApprovalForm } from '@/app/actions/approval-form'
import { approvalLine, missingFields } from '@/lib/approval-line'
import { tr, type Lang } from '@/lib/i18n'
import type { ApprovalLead, ApprovalTemplate } from '@/types'

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
  afterSubmit,
}: {
  templates: ApprovalTemplate[]
  lead: ApprovalLead | null
  businesses: { id: string; name: string }[]
  defaultDeadline: string
  lang: Lang
  /** 올린 뒤 갈 곳. 없으면 그 결재의 상세(/approvals?id=). 직원 홈은 /me?tab=requests로 돌아간다. */
  afterSubmit?: string
}) {
  const router = useRouter()
  const [key, setKey] = useState(templates[0]?.template_key ?? 'expense')
  const [form, setForm] = useState<Record<string, string>>({})
  const [business, setBusiness] = useState(businesses[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [attachment, setAttachment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

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
        attachmentUrl: attachment,
        form,
      })
      if (result.error) setError(result.error)
      else if (result.decisionId) router.push(afterSubmit ?? `/approvals?id=${result.decisionId}`)
    })
  }

  const input = 'w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12.5px]'
  const label = (ko: string, en: string, required = false) => (
    <span className="mb-1 block text-[11px] text-ink-dim">
      {tr(lang, ko, en)}
      {required ? <span className="ml-0.5 text-critical">*</span> : null}
    </span>
  )

  return (
    <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="glass space-y-4 rounded-glass p-5">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={tr(lang, '결재 양식', 'Templates')}>
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
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${
                t.template_key === key ? 'border-accent bg-accent text-white' : 'border-line bg-raised hover:border-accent'
              }`}
            >
              {lang === 'en' ? t.name_en : t.name_ko}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
          </label>

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
                  type={f.type === 'date' ? 'date' : 'text'}
                  inputMode={f.type === 'money' || f.type === 'number' ? 'numeric' : undefined}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className={input}
                />
              )}
            </label>
          ))}

          <label className="sm:col-span-2">
            {label('첨부 (사내 스토리지 링크)', 'Attachment (storage link)', template.attachment_required)}
            <input
              value={attachment}
              onChange={(e) => setAttachment(e.target.value)}
              placeholder="https://"
              className={input}
            />
          </label>
        </div>
      </section>

      <aside className="glass space-y-3 rounded-glass p-4">
        <h2 className="text-[13px] font-semibold">{tr(lang, '결재선 미리보기', 'Approval line preview')}</h2>
        <ol className="space-y-2">
          {line.map((s, i) => (
            <li key={s.step} className="flex items-start gap-2">
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold ${
                  s.step === 'chairman' ? 'bg-gold text-white' : s.step === 'rule' ? 'bg-line-soft text-ink-dim' : 'bg-accent text-white'
                }`}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold">{s.name}</span>
                <span className="block text-[11px] text-ink-dim">{s.why}</span>
              </span>
            </li>
          ))}
        </ol>
        {line.every((s) => s.step !== 'chairman') ? (
          <p className="rounded-md bg-raised px-2 py-1.5 text-[11px] text-ink-dim">
            {tr(lang, '회장까지 올라가지 않는 결재입니다.', 'This does not go up to the Chairman.')}
          </p>
        ) : null}
        <p className="text-[10.5px] leading-relaxed text-ink-muted">
          {tr(
            lang,
            '올리는 순간 서버가 같은 규칙으로 결재선을 다시 만들어 고정합니다. 이후 조직이 바뀌어도 이 결재의 결재선은 바뀌지 않습니다.',
            'On submit the server rebuilds this line with the same rule and freezes it.',
          )}
        </p>

        {error ? (
          <p role="alert" className="rounded-md border border-critical/40 bg-raised px-2 py-1.5 text-[11.5px] text-critical">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={submit}
          disabled={pending || missing.length > 0 || (template.attachment_required && !attachment.trim())}
          className="w-full rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {pending ? tr(lang, '올리는 중…', 'Submitting…') : tr(lang, '결재 올리기', 'Submit')}
        </button>
        {missing.length > 0 ? (
          <p className="text-[11px] text-ink-muted">
            {tr(lang, '필수 항목을 채우면 올릴 수 있습니다.', 'Fill the required fields to submit.')}
          </p>
        ) : null}
      </aside>
    </div>
  )
}
