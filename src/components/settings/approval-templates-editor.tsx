'use client'

import { useState, useTransition } from 'react'

import { saveApprovalTemplate } from '@/app/actions/approval-templates'
import { NumberInput } from '@/components/ui/number-input'
import { groupDigits, koreanAmount, parseGrouped } from '@/lib/number-input'
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

/**
 * 2026-10-07 — 회장이 항목 «이름» 칸에 값(«금액(원)500000» · «지출일 2026.10.07»)을 넣었다. 이름은 칸 제목이다 —
 * 숫자 · 날짜가 섞이면 저장 전에 알려 준다(저장은 막지 않는다 — «1차 견적» 같은 제목도 있다).
 */
export function looksLikeValue(label: string): '날짜' | '숫자' | null {
  if (/\d{2,4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]/.test(label)) return '날짜'
  if (/\d/.test(label)) return '숫자'
  return null
}

function TemplateCard({ template }: { template: ApprovalTemplate }) {
  const [fields, setFields] = useState<Draft[]>(() => template.fields.map((f, i) => ({ ...f, tmp: `${f.key}-${i}` })))
  const [always, setAlways] = useState(template.chairman_always)
  const [over, setOver] = useState(template.chairman_over === null ? '' : groupDigits(String(template.chairman_over), 'money'))
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [pending, start] = useTransition()
  const input = 'w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h'

  // 상태는 늘 함수형으로 고친다 — 폰에서 칸을 빠르게 연달아 누르면 앞의 변경이 옛 배열로 덮여 체크가 되돌아갔다(2026-10-07).
  function patch(i: number, p: Partial<TemplateField>) {
    setFields((cur) => cur.map((f, j) => (j === i ? { ...f, ...p } : f)))
    setMessage(null)
  }

  // 기준 금액이 있으면 금액 칸은 필수다 — 서버가 그렇게 저장한다(actions/approval-templates.ts). 화면도 같은 값을 보인다.
  // 저장 전에는 체크가 꺼져 보이다가 새로고침하면 켜져 있었다(2026-10-07).
  const overSet = over.trim() !== ''
  const forcedRequired = (f: TemplateField) => f.key === 'amount' && overSet

  function save() {
    setMessage(null)
    start(async () => {
      const r = await saveApprovalTemplate({
        templateKey: template.template_key,
        fields: fields.map((f) => ({ key: f.key, label_ko: f.label_ko, label_en: f.label_en, type: f.type, required: f.required })),
        chairmanAlways: always,
        chairmanOver: over.trim() === '' ? null : over,
      })
      if (r.error) {
        setMessage({ tone: 'err', text: r.error })
        return
      }
      // 저장된 그대로 다시 맞춘다 — 새 항목은 이제 key가 있다. 맞추지 않으면 다음 저장이 새 key를 또 만들어
      // 그 사이에 올라온 결재의 값이 어느 칸에도 안 보이게 된다.
      if (r.fields) setFields(r.fields.map((f, i) => ({ ...f, tmp: `${f.key}-${i}` })))
      setMessage({ tone: 'ok', text: '저장했습니다. 지금부터 올리는 결재에 적용됩니다.' })
    })
  }

  const overNumber = parseGrouped(over)
  const suspicious = fields.flatMap((f) => {
    const kind = looksLikeValue(f.label_ko)
    return kind ? [{ label: f.label_ko.trim(), kind }] : []
  })

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
      <p className="mt-1.5 rounded-md bg-raised px-2.5 py-1.5 text-t11h text-ink-dim">
        여기는 칸 제목을 정하는 곳입니다. 값은 직원이 결재를 올릴 때 넣습니다.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex min-h-11 items-center gap-2 self-start text-t12 sm:min-h-0 sm:pt-6">
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => {
              setAlways(e.target.checked)
              setMessage(null)
            }}
            className="size-4 accent-[var(--color-accent)]"
          />
          금액과 상관없이 항상 회장 결재
        </label>
        <div>
          <span className="mb-1 block text-t11 text-ink-dim">회장 결재 기준 금액 — 이 금액 이상이면 회장까지</span>
          <NumberInput
            kind="money"
            reading={false}
            aria-label="회장 결재 기준 금액"
            value={over}
            onChange={(v) => {
              setOver(v)
              setMessage(null)
            }}
            placeholder="비우면 금액 규칙 없음"
            disabled={always}
            className={`${input} disabled:opacity-50`}
          />
          {/* 안내 줄은 늘 한 줄 자리를 차지한다 — 체크를 켜고 끌 때마다 아래 항목 전체가 위아래로 뛰었다(2026-10-07). */}
          <span className="mt-0.5 block min-h-5 text-t10h text-ink-muted tnum">
            {always
              ? '«항상 회장 결재»가 켜져 있어 기준 금액은 쓰지 않습니다.'
              : overNumber !== null
                ? `${over}원(${koreanAmount(overNumber)}) 이상 → 상사 결재 → 회장 최종 승인 · 미만 → 직속 상사 승인으로 종결`
                : '비워 두면 금액으로는 회장까지 올라가지 않습니다.'}
          </span>
        </div>
      </div>

      <h3 className="mt-3 text-t12 font-semibold text-ink-dim">항목 (칸 제목)</h3>
      <ul className="mt-1.5 space-y-1.5">
        {fields.map((f, i) => {
          const warn = looksLikeValue(f.label_ko)
          const forced = forcedRequired(f)
          return (
            <li
              key={f.tmp}
              className="grid grid-cols-[1fr_auto] items-center gap-2 max-sm:rounded-lg max-sm:border max-sm:border-line-soft max-sm:p-2 sm:grid-cols-[1fr_140px_auto_auto]"
            >
              <input
                aria-label="항목 이름"
                value={f.label_ko}
                placeholder="칸 제목만 (예: 금액(원))"
                onChange={(e) => {
                  const v = e.target.value
                  patch(i, f.key ? { label_ko: v } : { label_ko: v, label_en: v })
                }}
                className={`${input} ${warn ? 'border-warning' : ''}`}
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
                  checked={f.required || forced}
                  disabled={forced}
                  onChange={(e) => patch(i, { required: e.target.checked })}
                  className="size-4 accent-[var(--color-accent)] disabled:opacity-60"
                />
                필수
              </label>
              <button
                type="button"
                onClick={() => {
                  setFields((cur) => cur.filter((x) => x.tmp !== f.tmp))
                  setMessage(null)
                }}
                className="min-h-11 rounded-md border border-line px-2 text-t11 text-ink-dim hover:border-critical hover:text-critical sm:min-h-0 sm:py-1.5"
              >
                삭제
              </button>
              {warn ? (
                <span className="col-span-full text-t10h text-warning max-sm:order-5">
                  이름에 {warn}가 들어 있습니다 — 값이 아니라 칸 제목만 적습니다(예: «금액(원)», «지출일»).
                </span>
              ) : forced ? (
                <span className="col-span-full text-t10h text-ink-muted max-sm:order-5">기준 금액이 있어 이 칸은 늘 필수입니다.</span>
              ) : null}
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          setFields((cur) => [...cur, { key: '', label_ko: '', label_en: '', type: 'text', required: false, tmp: `new-${Date.now()}` }])
          setMessage(null)
        }}
        className="mt-2 rounded-md border border-dashed border-line px-3 py-1.5 text-t12 text-ink-dim hover:border-accent hover:text-ink"
      >
        + 항목 추가
      </button>
      {fields.some((f) => f.key === 'amount') ? null : (
        // 금액 규칙은 key 'amount' 칸만 본다(0038 트리거). 지운 금액 칸을 되살리는 길.
        <button
          type="button"
          onClick={() => {
            setFields((cur) => [
              ...cur,
              { key: 'amount', label_ko: '금액(원)', label_en: 'Amount (KRW)', type: 'money', required: true, tmp: `amount-${Date.now()}` },
            ])
            setMessage(null)
          }}
          className="mt-2 ml-2 rounded-md border border-dashed border-line px-3 py-1.5 text-t12 text-ink-dim hover:border-accent hover:text-ink"
        >
          + 금액 칸 추가
        </button>
      )}

      {suspicious.length > 0 ? (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-t11h text-ink">
          확인: {suspicious.map((x) => `«${x.label}»`).join(' · ')} — 이름에 {[...new Set(suspicious.map((x) => x.kind))].join(' · ')}가
          있습니다. 값은 직원이 결재를 올릴 때 넣습니다. 칸 제목이 맞으면 그대로 저장해도 됩니다.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
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
