'use client'

import { useState, useTransition } from 'react'

import { saveApprovalTemplate } from '@/app/actions/approval-templates'
import type { ApprovalTemplate, TemplateField, TemplateFieldType } from '@/types'

/**
 * /settings/approvals 편집기 — 양식 하나에 카드 하나, 저장도 양식마다 (2026-10-06).
 *
 * 항목의 내부 이름(key)은 보여 주지 않는다. 이미 있는 항목은 key를 그대로 들고 다니고(옛 결재의 값이 그 key에 있다),
 * 새 항목은 서버가 key를 준다. 금액 칸(key 'amount')은 지울 수는 있어도 종류는 «금액»으로 고정이다 — 규칙이 그 칸을 본다.
 */
const TYPE_LABEL: Record<TemplateFieldType, string> = {
  text: '글',
  textarea: '긴 글',
  money: '금액',
  number: '숫자',
  date: '날짜',
  url: '링크(URL)',
}

type Draft = TemplateField & { tmp: string }

export function ApprovalTemplatesEditor({ templates }: { templates: ApprovalTemplate[] }) {
  return (
    <div className="space-y-4">
      {templates.map((t) => (
        <TemplateCard key={t.template_key} template={t} />
      ))}
    </div>
  )
}

function TemplateCard({ template }: { template: ApprovalTemplate }) {
  const [fields, setFields] = useState<Draft[]>(() => template.fields.map((f, i) => ({ ...f, tmp: `${f.key}-${i}` })))
  const [always, setAlways] = useState(template.chairman_always)
  const [over, setOver] = useState(template.chairman_over === null ? '' : String(template.chairman_over))
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [pending, start] = useTransition()
  const input = 'w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h'

  function patch(i: number, p: Partial<TemplateField>) {
    setFields(fields.map((f, j) => (j === i ? { ...f, ...p } : f)))
    setMessage(null)
  }

  function save() {
    setMessage(null)
    start(async () => {
      const r = await saveApprovalTemplate({
        templateKey: template.template_key,
        fields: fields.map((f) => ({ key: f.key, label_ko: f.label_ko, label_en: f.label_en, type: f.type, required: f.required })),
        chairmanAlways: always,
        chairmanOver: over.trim() === '' ? null : over,
      })
      setMessage(r.error ? { tone: 'err', text: r.error } : { tone: 'ok', text: '저장했습니다. 지금부터 올리는 결재에 적용됩니다.' })
    })
  }

  const overNumber = Number(over.replace(/[^0-9.]/g, ''))

  return (
    <section className="glass rounded-glass p-4" aria-label={`${template.name_ko} 양식`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-t14 font-semibold">{template.name_ko}</h2>
        {template.attachment_required ? (
          <span className="text-t10h text-warning">
            지금 «첨부 링크 필수»가 켜져 있습니다 — 저장하면 꺼집니다(양식에서 첨부 칸을 뺐습니다).
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex min-h-11 items-center gap-2 text-t12 sm:min-h-0">
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => setAlways(e.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          금액과 상관없이 항상 회장 결재
        </label>
        <label>
          <span className="mb-1 block text-t11 text-ink-dim">회장 결재 기준 금액(원) — 이 금액 이상이면 회장까지</span>
          <input
            value={over}
            onChange={(e) => setOver(e.target.value)}
            inputMode="numeric"
            placeholder="비우면 금액 규칙 없음"
            disabled={always}
            className={`${input} disabled:opacity-50`}
          />
          {!always && over.trim() && Number.isFinite(overNumber) ? (
            <span className="mt-0.5 block text-t10h text-ink-muted tnum">
              {overNumber.toLocaleString('ko-KR')}원 이상 → 회장 승인 · 미만 → 팀장 결재로 종결
            </span>
          ) : null}
        </label>
      </div>

      <h3 className="mt-4 text-t12 font-semibold text-ink-dim">항목</h3>
      <ul className="mt-1.5 space-y-1.5">
        {fields.map((f, i) => (
          <li key={f.tmp} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_140px_auto_auto]">
            <input
              aria-label="항목 이름"
              value={f.label_ko}
              onChange={(e) => patch(i, { label_ko: e.target.value, label_en: f.key ? f.label_en : e.target.value })}
              className={input}
            />
            <select
              aria-label="종류"
              value={f.type}
              disabled={f.key === 'amount'}
              onChange={(e) => patch(i, { type: e.target.value as TemplateFieldType })}
              className={`${input} max-sm:order-3 disabled:opacity-60`}
            >
              {(Object.keys(TYPE_LABEL) as TemplateFieldType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <label className="flex min-h-11 items-center gap-1.5 text-t12 max-sm:order-4 sm:min-h-0">
              <input
                type="checkbox"
                checked={f.required}
                onChange={(e) => patch(i, { required: e.target.checked })}
                className="size-4 accent-[var(--color-accent)]"
              />
              필수
            </label>
            <button
              type="button"
              onClick={() => setFields(fields.filter((_, j) => j !== i))}
              className="min-h-11 rounded-md border border-line px-2 text-t11 text-ink-dim hover:border-critical hover:text-critical sm:min-h-0 sm:py-1.5"
            >
              삭제
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() =>
          setFields([
            ...fields,
            { key: '', label_ko: '', label_en: '', type: 'text', required: false, tmp: `new-${Date.now()}` },
          ])
        }
        className="mt-2 rounded-md border border-dashed border-line px-3 py-1.5 text-t12 text-ink-dim hover:border-accent hover:text-ink"
      >
        + 항목 추가
      </button>
      {fields.some((f) => f.key === 'amount') ? null : (
        // 금액 규칙은 key 'amount' 칸만 본다(0038 트리거). 지운 금액 칸을 되살리는 길.
        <button
          type="button"
          onClick={() =>
            setFields([
              ...fields,
              { key: 'amount', label_ko: '금액(원)', label_en: 'Amount (KRW)', type: 'money', required: true, tmp: `amount-${Date.now()}` },
            ])
          }
          className="mt-2 ml-2 rounded-md border border-dashed border-line px-3 py-1.5 text-t12 text-ink-dim hover:border-accent hover:text-ink"
        >
          + 금액 칸 추가
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-t13 font-semibold text-white disabled:opacity-40"
        >
          {pending ? '저장 중…' : `${template.name_ko} 저장`}
        </button>
        {message ? (
          <span role={message.tone === 'err' ? 'alert' : 'status'} className={`text-t12 ${message.tone === 'err' ? 'text-critical' : 'text-ok'}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </section>
  )
}
