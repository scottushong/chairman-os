'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { eaDeleteFavorite, eaEndProxy, eaSaveForm, eaSaveNotify, eaSaveProxy, eaSaveRule } from '@/app/actions/e-approval'
import { won, type EaForm, type EaLineRule, type EaMySettings, type EaPerson } from '@/lib/approvals/types'

import { C, Pill } from './parts'

/** 개인 설정 — 자주 쓰는 결재선 · 기간을 정한 대결자 · 결재 알림(앱 안 알림만). */
export function EaPersonal({ settings, people, forms, today }: { settings: EaMySettings; people: EaPerson[]; forms: EaForm[]; today: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [proxy, setProxy] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [pForms, setPForms] = useState<string[]>([])
  const [max, setMax] = useState('')
  const [notify, setNotify] = useState(settings.notify)

  const go = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn()
      setMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: r.error ?? '저장하지 못했습니다.' })
      if (r.ok) router.refresh()
    })

  return (
    <div className="flex flex-col gap-4">
      {msg ? <div className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? 'bg-[#e7f5ee] text-[#1f7a4d]' : 'bg-[#fdecea] text-[#b4372b]'}`}>{msg.text}</div> : null}

      <section className={`${C.card} flex flex-col gap-3 px-4 py-4 sm:px-5`}>
        <h2 className="text-[16px] font-semibold text-[#1f2329]">기간을 정한 대결자</h2>
        <p className="text-[13px] text-[#6b7280]">내가 없는 동안 이 사람이 내 차례 문서를 대신 처리합니다(정한 기간 · 양식 · 금액 안에서만). 문서에는 나와 대결자가 둘 다 남습니다. 최대 90일.</p>
        {settings.proxy_for.length ? <div className="text-[13px] text-[#2f5bd3]">지금 내가 대결하는 사람: {settings.proxy_for.map((p) => `${p.owner}(${p.from}~${p.to})`).join(', ')}</div> : null}
        <ul className="flex flex-col gap-1.5">
          {settings.proxies.map((p) => (
            <li key={p.proxy_id} className="flex flex-wrap items-center gap-2 rounded-md bg-[#f6f7f9] px-3 py-2 text-[13px]">
              <span className="font-medium">{p.proxy}</span>
              <span>
                {p.from} ~ {p.to}
              </span>
              <span className="text-[#6b7280]">{p.forms?.length ? p.forms.map((f) => forms.find((x) => x.form_key === f)?.name_ko ?? f).join(' · ') : '모든 양식'}</span>
              <span className="text-[#6b7280]">{p.max_amount ? `${won(p.max_amount)} 이하` : '금액 제한 없음'}</span>
              {p.active ? (
                <button type="button" className="ml-auto text-[#b4372b]" disabled={pending} onClick={() => go(() => eaEndProxy(p.proxy_id), '대결을 끝냈습니다.')}>
                  끝내기
                </button>
              ) : (
                <span className="ml-auto">
                  <Pill tone="gray">끝남</Pill>
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={proxy} onChange={(e) => setProxy(e.target.value)} className={C.input} aria-label="대결자">
            <option value="">대결자 선택</option>
            {people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name}
                {p.dept ? ` · ${p.dept}` : ''}
              </option>
            ))}
          </select>
          <input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/[^0-9]/g, ''))} placeholder="금액 상한(비우면 제한 없음)" className={C.input} />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={C.input} aria-label="시작일" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={C.input} aria-label="종료일" />
        </div>
        <div className="flex flex-wrap gap-3 text-[13px]">
          {forms.map((f) => (
            <label key={f.form_key} className="flex items-center gap-1">
              <input type="checkbox" checked={pForms.includes(f.form_key)} onChange={(e) => setPForms((x) => (e.target.checked ? [...x, f.form_key] : x.filter((y) => y !== f.form_key)))} />
              {f.name_ko}
            </label>
          ))}
          <span className="text-[#6b7280]">(아무것도 안 고르면 모든 양식)</span>
        </div>
        <button type="button" disabled={pending || !proxy} className={`${C.btn} self-start`} onClick={() => go(() => eaSaveProxy(proxy, from, to, pForms, max ? Number(max) : null), '대결자를 정했습니다.')}>
          대결자 정하기
        </button>
      </section>

      <section className={`${C.card} flex flex-col gap-3 px-4 py-4 sm:px-5`}>
        <h2 className="text-[16px] font-semibold text-[#1f2329]">자주 쓰는 결재선</h2>
        {settings.favorites.length ? (
          <ul className="flex flex-col gap-1.5">
            {settings.favorites.map((f) => (
              <li key={f.fav_id} className="flex items-center justify-between gap-2 rounded-md bg-[#f6f7f9] px-3 py-2 text-[13px]">
                <span>
                  <span className="font-medium">{f.name}</span> · {f.line.map((s) => (s.role ? '대표' : (people.find((p) => p.user_id === s.user_id)?.name ?? '—')) + (s.kind === 'agree' ? '(합의)' : '')).join(' → ')}
                </span>
                <button type="button" className="text-[#b4372b]" disabled={pending} onClick={() => go(() => eaDeleteFavorite(f.fav_id), '지웠습니다.')}>
                  지우기
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[#6b7280]">아직 없습니다. 새 문서 작성 화면의 결재선 아래에서 «이름 붙여 저장»합니다.</p>
        )}
      </section>

      <section className={`${C.card} flex flex-col gap-3 px-4 py-4 sm:px-5`}>
        <h2 className="text-[16px] font-semibold text-[#1f2329]">결재 알림</h2>
        <p className="text-[13px] text-[#6b7280]">앱 안 알림(위쪽 종)으로만 갑니다. 메일 · 카톡은 보내지 않습니다.</p>
        {(
          [
            ['turn', '내 차례가 됐을 때'],
            ['result', '내가 올린 문서가 반려 · 승인 완료됐을 때'],
            ['followup', '후속 처리를 맡았을 때'],
            ['ref', '참조 · 열람자로 지정됐을 때'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={notify[k]} onChange={(e) => setNotify((x) => ({ ...x, [k]: e.target.checked }))} />
            {label}
          </label>
        ))}
        <button type="button" disabled={pending} className={`${C.btnLine} self-start`} onClick={() => go(() => eaSaveNotify(notify), '알림 설정을 저장했습니다.')}>
          저장
        </button>
      </section>
    </div>
  )
}

/** 관리자(대표) — 양식 관리 · 결재선 · 전결 규칙. 문서 권한 · 보관 설정과 이력 조회는 «준비 중». */
export function EaAdmin({ forms, rules }: { forms: EaForm[]; rules: EaLineRule[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [edit, setEdit] = useState<EaForm | null>(null)
  const [fieldsText, setFieldsText] = useState('')
  const [rule, setRule] = useState({ form_key: '', min_amount: '10000000', require_chairman: true, note: '' })

  const go = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn()
      setMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: r.error ?? '저장하지 못했습니다.' })
      if (r.ok) router.refresh()
    })

  return (
    <div className="flex flex-col gap-4">
      {msg ? <div className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? 'bg-[#e7f5ee] text-[#1f7a4d]' : 'bg-[#fdecea] text-[#b4372b]'}`}>{msg.text}</div> : null}

      <section className={`${C.card} flex flex-col gap-3 px-4 py-4 sm:px-5`}>
        <h2 className="text-[16px] font-semibold text-[#1f2329]">양식 관리</h2>
        <p className="text-[13px] text-[#6b7280]">바꾸면 판(버전)이 하나 오릅니다. 이미 상신된 문서는 상신 때 판 그대로입니다.</p>
        <ul className="flex flex-col gap-1.5">
          {forms.map((f) => (
            <li key={f.form_key} className="flex flex-wrap items-center gap-2 rounded-md bg-[#f6f7f9] px-3 py-2 text-[13px]">
              <span className="font-medium">{f.name_ko}</span>
              <Pill tone="gray">{f.version}판</Pill>
              <span className="text-[#6b7280]">
                칸 {f.fields.length} · {f.attachment_required ? '첨부 필수' : '첨부 선택'} · {f.followup_kind ? `후속 ${f.followup_kind}` : '후속 없음'}
              </span>
              {!f.active ? <Pill tone="red">쓰지 않음</Pill> : null}
              <button
                type="button"
                className="ml-auto text-[#2f5bd3]"
                onClick={() => {
                  setEdit(f)
                  setFieldsText(JSON.stringify(f.fields, null, 1))
                }}
              >
                고치기
              </button>
            </li>
          ))}
        </ul>
        {edit ? (
          <div className="flex flex-col gap-2 rounded-md border border-[#e3e6eb] p-3">
            <input value={edit.name_ko} onChange={(e) => setEdit({ ...edit, name_ko: e.target.value })} className={C.input} aria-label="양식 이름" />
            <input value={edit.followup_kind ?? ''} onChange={(e) => setEdit({ ...edit, followup_kind: e.target.value || null })} placeholder="후속 처리(비우면 없음) — 예: 관리부 지급" className={C.input} />
            <input value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value || null })} placeholder="작성 화면 안내" className={C.input} />
            <div className="flex flex-wrap gap-3 text-[13px]">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={edit.attachment_required} onChange={(e) => setEdit({ ...edit, attachment_required: e.target.checked })} /> 첨부 필수
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={edit.followup_required} onChange={(e) => setEdit({ ...edit, followup_required: e.target.checked })} /> 후속 담당자 필수
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> 사용
              </label>
            </div>
            <label className="text-[12px] text-[#6b7280]">
              입력 칸(JSON — key · label · type[text · textarea · number · money · date · select] · required · options)
              <textarea value={fieldsText} onChange={(e) => setFieldsText(e.target.value)} rows={8} className={`${C.input} font-mono text-[12px]`} />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                className={C.btn}
                onClick={() => {
                  let fields
                  try {
                    fields = JSON.parse(fieldsText)
                    if (!Array.isArray(fields)) throw new Error('array')
                  } catch {
                    setMsg({ ok: false, text: '입력 칸 JSON 모양이 맞지 않습니다.' })
                    return
                  }
                  go(() => eaSaveForm({ ...edit, fields }), '양식을 저장했습니다(판 +1).')
                  setEdit(null)
                }}
              >
                저장
              </button>
              <button type="button" className={C.btnLine} onClick={() => setEdit(null)}>
                닫기
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className={`${C.card} flex flex-col gap-3 px-4 py-4 sm:px-5`}>
        <h2 className="text-[16px] font-semibold text-[#1f2329]">결재선 · 전결 규칙</h2>
        <p className="text-[13px] text-[#6b7280]">금액이 기준 이상이면 결재선 끝에 «대표» 승인이 있어야 상신됩니다. 기준 아래는 결재선의 마지막 승인자가 전결합니다.</p>
        <ul className="flex flex-col gap-1.5">
          {rules.map((r) => (
            <li key={r.rule_id} className="flex flex-wrap items-center gap-2 rounded-md bg-[#f6f7f9] px-3 py-2 text-[13px]">
              <span className="font-medium">{forms.find((f) => f.form_key === r.form_key)?.name_ko ?? '모든 양식'}</span>
              <span>{won(r.min_amount)} 이상 → {r.require_chairman ? '대표 승인 필수' : '전결'}</span>
              {r.note ? <span className="text-[#6b7280]">{r.note}</span> : null}
              {r.active ? null : <Pill tone="gray">끔</Pill>}
              <button type="button" className="ml-auto text-[#2f5bd3]" disabled={pending} onClick={() => go(() => eaSaveRule({ ...r, active: !r.active }), r.active ? '규칙을 껐습니다.' : '규칙을 켰습니다.')}>
                {r.active ? '끄기' : '켜기'}
              </button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={rule.form_key} onChange={(e) => setRule({ ...rule, form_key: e.target.value })} className={C.input} aria-label="양식">
            <option value="">모든 양식</option>
            {forms.map((f) => (
              <option key={f.form_key} value={f.form_key}>
                {f.name_ko}
              </option>
            ))}
          </select>
          <input inputMode="numeric" value={rule.min_amount} onChange={(e) => setRule({ ...rule, min_amount: e.target.value.replace(/[^0-9]/g, '') })} className={C.input} aria-label="기준 금액" />
          <input value={rule.note} onChange={(e) => setRule({ ...rule, note: e.target.value })} placeholder="메모" className={C.input} />
          <button
            type="button"
            disabled={pending}
            className={C.btn}
            onClick={() => go(() => eaSaveRule({ rule_id: null, form_key: rule.form_key || null, business_id: null, min_amount: Number(rule.min_amount || 0), require_chairman: true, note: rule.note || null, active: true }), '규칙을 더했습니다.')}
          >
            규칙 더하기
          </button>
        </div>
      </section>

      <section className={`${C.card} grid gap-2 px-4 py-4 sm:grid-cols-2 sm:px-5`}>
        {['문서 권한 · 보관 설정', '결재 · 변경 이력 조회', '처리자 바꾸기(퇴사 등 · 사유 필수)', '부서 문서함(별도 권한자만)'].map((t) => (
          <div key={t} className="rounded-md border border-dashed border-[#d5d9e0] px-3 py-3 text-[13px] text-[#6b7280]">
            {t} — 준비 중
          </div>
        ))}
      </section>
    </div>
  )
}
