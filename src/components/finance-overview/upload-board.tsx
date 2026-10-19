'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { applyPendingUpload, releasePayrollHold, revertUpload, uploadFinanceFile, withdrawOfficialSave } from '@/app/actions/finance-upload'
import { OfficialPanel, type AccountOption } from '@/components/finance/finance-upload-board'
import { FIN_INBOX, inboxPath } from '@/lib/finance-upload/inbox'
import { KIND_SPECS } from '@/lib/finance-upload/kinds'
import type { FileCard } from '@/lib/finance-upload/process'
import { sendEach } from '@/lib/finance-upload/send-each'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { FinHoldKind, FinPayrollHeld, FinUpload } from '@/types'

/**
 * «회계 · 재무 자료 올리기»(0085 · 시안 finance-upload-mock.html) — 칸 하나 · 파일 여러 개 · 놓으면 끝.
 *   표: 파일 · 알아본 종류 · 달 · 상태(저장됨 · 경고 n · 보류(이유)) · 되돌리기 / 보기. 미리보기 · 넣기 단추는 없다.
 *   보류 줄만 그 자리에서 고른다: 종류 · 달(모를 때) · 이유(마감 달 — 대표 · CFO) · 급여 개인 줄(대표 · CFO).
 * 직원 화면 — «회장» 없음(대표 · CFO).
 */

const ACCEPT = '.xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png'
const UPLOAD_MAX = 20 * 1024 * 1024
const KIND_KO: Record<string, string> = Object.fromEntries(KIND_SPECS.map((k) => [k.kind, k.label.replace(/^.*· /, '')]))
const LEGACY_KO: Record<string, string> = { accounts: '계정과목표', monthly: '월별 손익계산서', annual: '재무제표(연간)' }
const failCard = (fileName: string, message: string): FileCard => ({ file_name: fileName, sheet: null, kind: 'unknown', period: null, status: 'failed', upload_id: null, rows: 0, message, why: [], ai_used: 0, confidence: 'none' })

export interface HeldView {
  upload: FinUpload
  hold: FinHoldKind
  message: string
  warnings: string[]
}

export function UploadBoard({
  businessId,
  month,
  userId,
  mode,
  recent,
  held,
  payrollHeld,
  boss,
  revertable,
  missing,
  got,
  total,
  overviewHref,
  accounts,
  canClose,
  officialYears,
}: {
  businessId: string
  month: string
  userId: string
  mode: 'dummy' | 'live'
  recent: FinUpload[]
  held: HeldView[]
  payrollHeld: FinPayrollHeld[]
  boss: boolean
  revertable: string[]
  missing: string[]
  got: number
  total: number
  overviewHref: string
  accounts: AccountOption[]
  canClose: boolean
  officialYears: string[]
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [cards, setCards] = useState<FileCard[]>([])
  const [over, setOver] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expand, setExpand] = useState(false)
  const [busy, start] = useTransition()

  function send(files: FileList | File[]) {
    const list = [...files].slice(0, 30)
    if (!list.length) return
    setError(files.length > 30 ? `한 번에 30개까지 — 앞 30개만 올립니다(${files.length}개 중).` : null)
    setCards([])
    start(async () => {
      try {
        await sendEach(list, sendOne, failCard, (done, all, f, out) => {
          setCards([...out])
          setProgress(done < all ? `${done + 1} / ${all} · ${f.name}` : null)
        })
      } finally {
        setProgress(null)
        router.refresh()
      }
    })
  }
  async function sendOne(f: File): Promise<FileCard[]> {
    if (f.size < 1) return [failCard(f.name, '빈 파일입니다.')]
    if (f.size > UPLOAD_MAX) return [failCard(f.name, '20MB가 넘는 파일입니다 — 기간을 나눠 내려받아 올려 주세요.')]
    if (/\.(heic|heif|webp)$/i.test(f.name)) return [failCard(f.name, 'HEIC · WEBP 사진은 받지 않습니다 — JPG로 저장해 올려 주세요.')]
    const form = new FormData()
    form.set('business_id', businessId)
    if (mode === 'live') {
      const path = inboxPath(businessId, userId, f.name, crypto.randomUUID())
      const { error: upErr } = await createSupabaseBrowserClient().storage.from(FIN_INBOX).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false })
      if (upErr) return [failCard(f.name, `파일을 올리지 못했습니다(${upErr.message.slice(0, 80)}) — 다시 올려 주세요.`)]
      form.set('path', path)
      form.set('name', f.name)
    } else form.set('file', f)
    const r = await uploadFinanceFile(form)
    if (r.error) return [failCard(f.name, r.error)]
    return r.cards
  }

  const savedN = cards.filter((c) => c.status === 'applied').length
  const warnN = cards.filter((c) => c.status === 'applied' && c.warnings?.length).length
  const shown = expand ? cards : cards.slice(0, 7)
  const recentShown = recent.slice(0, expand ? 40 : 10)

  return (
    <div className="flex flex-col gap-5">
      <section
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          send(e.dataTransfer.files)
        }}
        className={`flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-11 text-center ${over ? 'border-[#0f6b5c] bg-[#e1efeb]' : 'border-[#8fb3a8] bg-white'}`}
        data-testid="drop-zone"
      >
        <div className="text-[18px] font-semibold">여기에 이번 달 파일을 전부 끌어다 놓으세요</div>
        <div className="text-[14px] text-[#6b7772]">엑셀 · PDF · 사진 · 한 번에 여러 개 · 순서 상관없음 · 종류는 앱이 알아봅니다</div>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && send(e.target.files)} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="mt-1.5 rounded-lg border border-[#0f6b5c] bg-[#0f6b5c] px-[18px] py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
          {busy ? '읽고 저장하는 중…' : '파일 고르기'}
        </button>
        {progress ? <div role="status" className="text-[13px] text-[#6b7772] tnum">올리고 읽는 중 — {progress}</div> : null}
        {error ? <div role="alert" className="text-[13px] text-[#b4432b]">{error}</div> : null}
      </section>

      {cards.length ? (
        <div className="flex flex-col gap-2" data-testid="just-uploaded">
          <div className="text-[15px] font-bold">
            방금 올린 파일 {cards.length}개 — 저장 {savedN}
            {warnN ? ` · 경고 ${warnN}` : ''}
            {cards.length - savedN ? ` · 보류 · 실패 ${cards.length - savedN}` : ''}
          </div>
          <FileTable>
            {shown.map((c, i) => (
              <CardRow key={`${c.file_name}-${c.sheet}-${i}`} c={c} businessId={businessId} />
            ))}
            {cards.length > shown.length ? (
              <Row muted cells={[`… ${cards.length - shown.length}개 더`, '', '', cards.slice(7).every((c) => c.status === 'applied') ? '모두 저장됨' : '아래 표에서', <button key="x" type="button" onClick={() => setExpand(true)} className="text-[#0f6b5c] hover:underline">펼치기</button>]} />
            ) : null}
          </FileTable>
          <div className="text-[13px] text-[#6b7772]">저장되면 재무 현황이 바로 다시 계산됩니다(보통 1분 안). 잘못 올린 파일은 7일 안에 «되돌리기»로 무효 처리할 수 있습니다.</div>
          {cards.filter((c) => c.status === 'official' && c.official).map((c, i) => (
            <div key={`o${i}`} className="rounded-[10px] border border-[#e1e6e3] bg-white px-4 py-3">
              <div className="text-[14px] font-semibold">{c.file_name} — {c.message}</div>
              <OfficialPanel businessId={businessId} draft={c.official ?? null} accounts={accounts} fileName={c.file_name} canClose={canClose} existingYears={officialYears} />
            </div>
          ))}
        </div>
      ) : null}

      {held.length || payrollHeld.length ? (
        <div className="flex flex-col gap-2" data-testid="held">
          <div className="text-[15px] font-bold">보류 — {held.length + payrollHeld.length}건 (그 자리에서 고르면 저장)</div>
          <FileTable>
            {held.map((h) => (
              <HeldRow key={h.upload.upload_id} h={h} businessId={businessId} month={month} boss={boss} />
            ))}
            {payrollHeld.map((p) => (
              <PayrollRow key={p.hold_id} p={p} businessId={businessId} boss={boss} recent={recent} />
            ))}
          </FileTable>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-3.5" data-testid="month-strip">
        <div className="mr-2 text-[14px] font-semibold">
          {month.slice(0, 4)}년 {Number(month.slice(5, 7))}월 — 받은 것 {got} / {total}
        </div>
        {missing.map((m) => (
          <div key={m} className="rounded-full border border-dashed border-[#c9d1cd] bg-white px-2.5 py-1 text-[13px] text-[#6b7772]">
            빠짐: {m}
          </div>
        ))}
        <form action="" className="flex items-center gap-1 text-[13px]">
          <input name="month" type="month" defaultValue={month} aria-label="달" className="rounded-md border border-[#d7ddda] px-2 py-1" />
          <button className="rounded-md border border-[#d7ddda] px-2 py-1 text-[#6b7772]">달 바꾸기</button>
        </form>
        <div className="ml-auto text-[13px]">
          <Link href={overviewHref} className="text-[#0f6b5c] hover:underline">
            재무 현황 보기 ›
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[15px] font-bold">최근 올린 파일</div>
        {recentShown.length ? (
          <FileTable>
            {recentShown.map((u) => (
              <RecentRow key={u.upload_id} u={u} businessId={businessId} canRevert={revertable.includes(u.upload_id)} />
            ))}
            {recent.length > recentShown.length ? <Row muted cells={[`… ${recent.length - recentShown.length}개 더`, '', '', '', <button key="x" type="button" onClick={() => setExpand(true)} className="text-[#0f6b5c] hover:underline">펼치기</button>]} /> : null}
          </FileTable>
        ) : (
          <div className="text-[13px] text-[#6b7772]">아직 없습니다.</div>
        )}
      </div>
    </div>
  )
}

const GRID = 'grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr_0.7fr] gap-3 px-3.5 py-2.5 max-md:grid-cols-[1fr_auto] max-md:gap-x-2 max-md:gap-y-0.5'

function FileTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#e1e6e3] bg-white">
      <div className={`${GRID} border-b border-[#e1e6e3] text-[12px] text-[#6b7772] max-md:hidden`}>
        <div>파일</div>
        <div>알아본 종류</div>
        <div>달</div>
        <div>상태</div>
        <div />
      </div>
      {children}
    </div>
  )
}

function Row({ cells, muted, tone }: { cells: React.ReactNode[]; muted?: boolean; tone?: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const t = tone === 'ok' ? 'text-[#0f6b5c]' : tone === 'warn' ? 'text-[#9a4b12]' : tone === 'bad' ? 'text-[#b4432b]' : 'text-[#6b7772]'
  return (
    <div className={`${GRID} items-center border-b border-[#eef1ef] text-[14px] last:border-b-0 ${muted ? 'text-[#6b7772]' : ''}`}>
      <div className="min-w-0 break-all max-md:col-span-2 max-md:font-semibold">{cells[0]}</div>
      <div className="max-md:text-[13px] max-md:text-[#6b7772]">{cells[1]}</div>
      <div className="tnum max-md:text-right max-md:text-[13px] max-md:text-[#6b7772]">{cells[2]}</div>
      <div className={`min-w-0 ${tone ? t : ''}`}>{cells[3]}</div>
      <div className="max-md:text-right">{cells[4]}</div>
    </div>
  )
}

const kindOf = (c: { kind: string; legacy?: string; official_ids?: number[] }) => (c.official_ids?.length ? '공식 결산' : c.legacy ? LEGACY_KO[c.legacy] : (KIND_KO[c.kind] ?? '종류 모름'))

function CardRow({ c, businessId }: { c: FileCard; businessId: string }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const w = c.warnings ?? []
  const tone = c.status === 'applied' ? (w.length ? 'warn' : 'ok') : c.status === 'held' || c.status === 'official' || c.status === 'later' || c.status === 'duplicate' ? 'warn' : 'bad'
  const state =
    c.status === 'applied'
      ? `${c.message.replace(/^저장됨 · /, '저장됨 · ')}${w.length ? ` · 경고 ${w.length}` : ''}`
      : c.status === 'duplicate'
        ? '이미 올림 — 늘지 않음'
        : c.message
  const action =
    c.status === 'applied' && c.upload_id ? (
      <button type="button" disabled={busy} onClick={() => start(async () => { const r = await revertUpload(c.upload_id, businessId, '방금 올린 파일 되돌리기'); setMsg(r.error ?? '되돌렸습니다'); router.refresh() })} className="text-[#0f6b5c] hover:underline disabled:opacity-50">
        되돌리기
      </button>
    ) : c.status === 'applied' && c.official_ids?.length ? (
      <button type="button" disabled={busy} onClick={() => start(async () => { const r = await withdrawOfficialSave(c.official_ids, businessId); setMsg(r.error ?? '되돌렸습니다'); router.refresh() })} className="text-[#0f6b5c] hover:underline disabled:opacity-50">
        되돌리기
      </button>
    ) : null
  return (
    <>
      <Row tone={tone} cells={[`${c.file_name}${c.sheet && c.sheet !== 'Sheet1' ? ` «${c.sheet}»` : ''}`, kindOf(c), c.period ?? '—', state, action]} />
      {w.length || msg ? (
        <div className="border-b border-[#eef1ef] px-3.5 pb-2 text-[12px] text-[#9a4b12]">
          {msg ? <span className="text-[#6b7772]">{msg} · </span> : null}
          {w.slice(0, 4).join(' · ')}
          {w.length > 4 ? ` 외 ${w.length - 4}건` : ''}
        </div>
      ) : null}
    </>
  )
}

function RecentRow({ u, businessId, canRevert }: { u: FinUpload; businessId: string; canRevert: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const w = u.warnings ?? []
  const st: Record<string, string> = { applied: '저장됨', reverted: '되돌림', replaced: '새 값으로 바뀜', skipped: '기존 값 둠', cancelled: '취소', failed: '실패', needs_review: '보류' }
  const official = u.status === 'failed' && !!u.error?.startsWith('공식 결산으로 보냄')
  const hold = u.status === 'failed' && !!u.error?.startsWith('보류 — ')
  const tone = u.status === 'applied' ? (w.length ? 'warn' : 'ok') : u.status === 'failed' && !official && !hold ? 'bad' : 'muted'
  const state = official ? '공식 결산으로 보냄' : hold ? u.error!.slice(5) : u.status === 'failed' ? `실패 — ${u.error ?? ''}` : `${st[u.status] ?? u.status}${u.status === 'applied' ? ` · ${u.row_count}줄${w.length ? ` · 경고 ${w.length}` : ''}` : ''}`
  return (
    <>
      <Row
        tone={tone}
        cells={[
          u.file_name,
          KIND_KO[u.kind] ?? (official ? '공식 결산' : '종류 모름'),
          u.period ?? '—',
          state,
          canRevert ? (
            <button type="button" disabled={busy} onClick={() => start(async () => { const r = await revertUpload(u.upload_id, businessId, '화면에서 되돌림'); setMsg(r.error ?? '되돌렸습니다(지우지 않고 무효 처리).'); router.refresh() })} className="text-[#0f6b5c] hover:underline disabled:opacity-50">
              되돌리기
            </button>
          ) : null,
        ]}
      />
      {w.length || msg ? <div className="border-b border-[#eef1ef] px-3.5 pb-2 text-[12px] text-[#9a4b12]">{msg ? <span className="text-[#6b7772]">{msg} · </span> : null}{w.slice(0, 3).join(' · ')}</div> : null}
    </>
  )
}

function HeldRow({ h, businessId, month, boss }: { h: HeldView; businessId: string; month: string; boss: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [kind, setKind] = useState(h.upload.kind === 'unknown' ? '' : h.upload.kind)
  const [period, setPeriod] = useState(h.upload.period ?? month)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const needKind = h.hold === 'kind'
  const needPeriod = h.hold === 'period' || needKind
  const needReason = h.hold === 'closed'
  const canDo = !(needReason && !boss) && h.hold !== 'value_state' && h.hold !== 'final_exists' && !(h.hold === 'restricted' && !boss)
  return (
    <div className="border-b border-[#eef1ef] px-3.5 py-2.5 text-[14px] last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 break-all font-medium">{h.upload.file_name}</span>
        <span className="text-[#6b7772]">{KIND_KO[h.upload.kind] ?? '종류 모름'}</span>
        <span className="text-[#6b7772] tnum">{h.upload.period ?? '달 모름'}</span>
        <span className="text-[#9a4b12]">{h.message}</span>
      </div>
      {canDo ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {needKind ? (
            <select aria-label="종류" value={kind} onChange={(e) => setKind(e.target.value)} className="min-h-9 rounded-md border border-[#d7ddda] bg-white px-2 text-[14px]">
              <option value="">종류 고르기</option>
              {KIND_SPECS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.no} {k.label}
                </option>
              ))}
            </select>
          ) : null}
          {needPeriod ? <input aria-label="달" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="min-h-9 rounded-md border border-[#d7ddda] px-2 text-[14px]" /> : null}
          {needReason ? <input aria-label="이유" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="마감 달에 넣는 이유" className="min-h-9 min-w-0 flex-1 rounded-md border border-[#d7ddda] px-2 text-[14px]" /> : null}
          <button
            type="button"
            disabled={busy || (needKind && !kind)}
            onClick={() =>
              start(async () => {
                const r = await applyPendingUpload({ uploadId: h.upload.upload_id, businessId, kind: kind || undefined, period, reason: reason || undefined })
                setMsg(r.error ?? '저장했습니다.')
                if (r.ok) router.refresh()
              })
            }
            className="min-h-9 rounded-lg bg-[#0f6b5c] px-4 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? '저장 중…' : '저장'}
          </button>
          {msg ? <span role="status" className="text-[13px] text-[#6b7772]">{msg}</span> : null}
        </div>
      ) : (
        <div className="mt-1 text-[12px] text-[#6b7772]">{h.hold === 'closed' || h.hold === 'restricted' ? '대표 · CFO가 이 화면에서 풉니다.' : '파일을 고쳐 다시 올려 주세요.'}</div>
      )}
      {h.warnings.length ? <div className="mt-1 text-[12px] text-[#9a4b12]">{h.warnings.slice(0, 3).join(' · ')}</div> : null}
    </div>
  )
}

function PayrollRow({ p, businessId, boss, recent }: { p: FinPayrollHeld; businessId: string; boss: boolean; recent: FinUpload[] }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const u = recent.find((x) => x.upload_id === p.upload_id)
  const act = (save: boolean) =>
    start(async () => {
      const r = await releasePayrollHold(p.hold_id, businessId, save)
      setMsg(r.error ?? (save ? '개인 줄을 저장했습니다.' : '개인 줄을 버렸습니다.'))
      if (r.ok) router.refresh()
    })
  return (
    <div className="border-b border-[#eef1ef] px-3.5 py-2.5 text-[14px] last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{u?.file_name ?? '급여대장'}</span>
        <span className="text-[#6b7772]">급여대장</span>
        <span className="text-[#6b7772] tnum">{p.period}</span>
        <span className="text-[#9a4b12]">보류 — 개인 줄 {p.people}개(부서 합계는 저장됨){boss ? '' : ' · 대표 · CFO가 확인 뒤 저장합니다'}</span>
      </div>
      {boss ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => act(true)} className="min-h-9 rounded-lg bg-[#0f6b5c] px-4 text-[14px] font-semibold text-white disabled:opacity-50">
            개인 줄 저장
          </button>
          <button type="button" disabled={busy} onClick={() => act(false)} className="min-h-9 rounded-lg border border-[#d7ddda] px-3 text-[14px] text-[#6b7772] disabled:opacity-50">
            버리기
          </button>
          {msg ? <span role="status" className="text-[13px] text-[#6b7772]">{msg}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
