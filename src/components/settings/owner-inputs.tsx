'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { saveInventoryMethodAction, setCostManagerAction, uploadGoogleServiceAccountAction } from '@/app/actions/owner-inputs'
import {
  INVENTORY_METHOD_LABEL,
  INVENTORY_METHODS,
  MEMO_MAX,
  methodAgreement,
  PL_METHOD_LABEL,
  isInventoryMethod,
  type InventoryMethod,
  type OwnerInputRow,
} from '@/lib/owner-inputs'

/**
 * /settings «받을 것» 카드 넷(0089 5절 · 대표만 — 부르는 화면이 대표에게만 그리고, 액션 · DB도 대표만 받는다).
 * 카드마다: 비어 있으면 «아직 없음», 받았으면 받은 때 · 누가. **AI를 부르지 않는다.** 구글 키 본문은 화면에 오지 않는다(이메일 · 프로젝트 id만).
 */

export interface OwnerInputsProps {
  /** null = DB 0089 전(저장소 없음). */
  rows: OwnerInputRow[] | null
  businesses: { business_id: string; name: string }[]
  /** 원가 관리 권한자로 고를 수 있는 사람(활성 · 사람 · 대표 아님). costing = 이미 원가 권한이 있는 회사들. */
  people: { user_id: string; name: string; role: string; business_ids: string[]; group: boolean; costing: string[] }[]
  /** user_id → 이름(받은 사람 표시). */
  names: Record<string, string>
  /** 회사 → 0075 월별 손익 평가방법(monthly_wa · statement · null = 못 읽음). */
  plMethods: Record<string, string | null>
  /** 0063 BOM 상태(못 읽으면 null). */
  bom: { keyReady: boolean; realAllowed: boolean } | null
  /** 앱 서버에 GOOGLE_SHEETS_SA_JSON이 있는가(동기화가 지금 쓰는 자리). */
  sheetsEnv: boolean
}

const input = 'min-w-0 rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink'
const btn = 'min-h-9 rounded-md border border-line px-3 text-t11h text-ink-dim hover:border-accent hover:text-ink disabled:opacity-40'

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function OwnerInputs(p: OwnerInputsProps) {
  if (p.rows === null) {
    return <p className="rounded-lg bg-raised px-3 py-2.5 text-t11 text-ink-muted">«받을 것» 저장소가 아직 없습니다(DB 0089 전). 운영 반영 뒤에 카드가 섭니다.</p>
  }
  const rows = p.rows
  const find = (item: OwnerInputRow['item_key'], scope: string) => rows.find((r) => r.item_key === item && r.scope === scope) ?? null
  return (
    <div className="grid gap-2 lg:grid-cols-2" data-testid="owner-inputs">
      <RealBomCard {...p} find={find} />
      <InventoryCard {...p} find={find} />
      <GoogleCard {...p} find={find} />
      <CostManagerCard {...p} find={find} />
    </div>
  )
}

type Find = (item: OwnerInputRow['item_key'], scope: string) => OwnerInputRow | null

function Card({ title, state, children, testId }: { title: string; state: 'none' | 'got' | 'warn'; children: React.ReactNode; testId: string }) {
  const badge = state === 'got' ? ['받음', 'text-ok'] : state === 'warn' ? ['확인 필요', 'text-warning'] : ['아직 없음', 'text-ink-muted']
  return (
    <div className="min-w-0 rounded-lg bg-raised px-3 py-2.5" data-testid={testId}>
      <p className="flex flex-wrap items-center gap-1.5 text-t11h font-semibold text-ink">
        {title}
        <span className={`rounded bg-panel px-1.5 py-0.5 text-t9h font-normal ${badge[1]}`}>{badge[0]}</span>
      </p>
      <div className="mt-1 space-y-1.5 text-t10h text-ink-muted">{children}</div>
    </div>
  )
}

function Received({ row, names }: { row: OwnerInputRow | null; names: Record<string, string> }) {
  if (!row) return <p>아직 없음</p>
  return (
    <p>
      받은 때 <b className="font-semibold text-ink-dim">{when(row.received_at)}</b> · 누가{' '}
      <b className="font-semibold text-ink-dim">{(row.received_by && names[row.received_by]) || '—'}</b>
    </p>
  )
}

function BizSelect({ value, onChange, businesses, label }: { value: string; onChange: (v: string) => void; businesses: OwnerInputsProps['businesses']; label: string }) {
  return (
    <label className="block">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${input} block w-full`}>
        {businesses.map((b) => (
          <option key={b.business_id} value={b.business_id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ---------------------------------------------------------------- 1. 진짜 BOM */

function RealBomCard({ businesses, names, bom, find }: OwnerInputsProps & { find: Find }) {
  const [biz, setBiz] = useState(businesses[0]?.business_id ?? '')
  const got = businesses.map((b) => ({ b, row: find('real_bom', b.business_id) })).filter((x) => x.row)
  const row = find('real_bom', biz)
  return (
    <Card title="1. 진짜 BOM (R2 엑셀)" state={got.length > 0 ? 'got' : 'none'} testId="owner-input-real_bom">
      <p>R2에서 내보낸 배합표 엑셀을 기존 «BOM 넣기» 화면에서 올립니다(코드가 읽음 · AI로 가지 않음 · 저장은 암호문). 넣기가 끝나면 여기 «받음»이 적힙니다 — 판 수만, 내용은 적지 않습니다.</p>
      {got.length > 0 ? (
        <ul className="space-y-0.5">
          {got.map(({ b, row: r }) => (
            <li key={b.business_id}>
              {b.name}: 받은 때 <b className="font-semibold text-ink-dim">{when(r!.received_at)}</b> · 누가 <b className="font-semibold text-ink-dim">{(r!.received_by && names[r!.received_by]) || '—'}</b> · {String(r!.summary.rows ?? '—')}판
            </li>
          ))}
        </ul>
      ) : (
        <p>아직 없음</p>
      )}
      <p>
        BOM 암호 키: <b className="font-semibold text-ink-dim">{bom ? (bom.keyReady ? '준비됨' : '없음') : '—'}</b> · 진짜 BOM 받기:{' '}
        <b className="font-semibold text-ink-dim">{bom ? (bom.realAllowed ? '켜짐' : '꺼짐(가짜만)') : '—'}</b>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <BizSelect value={biz} onChange={setBiz} businesses={businesses} label="회사" />
        <Link href={`/costs/${biz}/bom/import`} className={`${btn} inline-flex items-center`}>
          {row ? '다시 올리기' : 'R2 엑셀 올리러 가기'}
        </Link>
      </div>
    </Card>
  )
}

/* ---------------------------------------------------------------- 2. 세무사 재고평가방법 */

function InventoryCard({ businesses, names, plMethods, find }: OwnerInputsProps & { find: Find }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [biz, setBiz] = useState(businesses[0]?.business_id ?? '')
  const row = find('inventory_method', biz)
  const saved = isInventoryMethod(row?.summary.method) ? row.summary.method : null
  const [method, setMethod] = useState<InventoryMethod | ''>(saved ?? '')
  const [memo, setMemo] = useState(typeof row?.summary.memo === 'string' ? row.summary.memo : '')
  const [msg, setMsg] = useState<string | null>(null)
  const pl = plMethods[biz] ?? null
  const agree = saved ? methodAgreement(saved, pl) : 'unknown'
  const anyGot = businesses.some((b) => find('inventory_method', b.business_id))
  return (
    <Card title="2. 세무사 재고평가방법" state={agree === 'differs' ? 'warn' : anyGot ? 'got' : 'none'} testId="owner-input-inventory_method">
      <p>세무사가 확인해 준 방법을 «세무사 확인값»으로 적습니다. 월별 손익 설정(«회계 · 재무» 손익계산서 탭 아래)은 바꾸지 않고, 다르면 여기 경고만 띄웁니다.</p>
      <BizSelect
        value={biz}
        onChange={(v) => {
          setBiz(v)
          const r = find('inventory_method', v)
          setMethod(isInventoryMethod(r?.summary.method) ? r.summary.method : '')
          setMemo(typeof r?.summary.memo === 'string' ? r.summary.memo : '')
          setMsg(null)
        }}
        businesses={businesses}
        label="회사"
      />
      <Received row={row} names={names} />
      {saved ? (
        <p>
          세무사 확인값: <b className="font-semibold text-ink-dim">{INVENTORY_METHOD_LABEL[saved]}</b> · 월별 손익 설정:{' '}
          <b className="font-semibold text-ink-dim">{pl ? (PL_METHOD_LABEL[pl] ?? pl) : '못 읽음'}</b>
        </p>
      ) : null}
      {agree === 'differs' ? (
        <p className="text-warning" role="alert" data-testid="inventory-warning">
          다릅니다 — 월별 손익은 아직 «{PL_METHOD_LABEL[pl ?? ''] ?? pl}»로 계산합니다. 세무사 방법으로 맞추려면 월별 손익 설정에서 «재고금액명세서 금액 그대로»를 고르거나 세무사와 상의하세요.
        </p>
      ) : null}
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            const x = await saveInventoryMethodAction({ businessId: biz, method, memo })
            setMsg(x.error ?? x.ok ?? null)
            if (x.ok) router.refresh()
          })
        }}
      >
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="sr-only">평가방법</legend>
          {INVENTORY_METHODS.map((m) => (
            <label key={m} className="inline-flex items-center gap-1 text-t11h text-ink-dim">
              <input type="radio" name="inv-method" value={m} checked={method === m} onChange={() => setMethod(m)} />
              {INVENTORY_METHOD_LABEL[m]}
            </label>
          ))}
        </fieldset>
        <label className="block">
          메모(선택 · {MEMO_MAX}자까지)
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={MEMO_MAX} rows={2} className={`${input} block w-full`} />
        </label>
        <button className={btn} disabled={busy || !method}>
          저장
        </button>
        {msg ? <p aria-live="polite">{msg}</p> : null}
      </form>
    </Card>
  )
}

/* ---------------------------------------------------------------- 3. 구글 서비스 계정 */

function GoogleCard({ names, sheetsEnv, find }: OwnerInputsProps & { find: Find }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const row = find('google_sa', 'group')
  return (
    <Card title="3. 구글 서비스 계정 (시트 읽기)" state={row ? 'got' : 'none'} testId="owner-input-google_sa">
      <p>구글 클라우드에서 내려받은 키 파일(JSON)을 올립니다. 키는 비밀 저장소(Vault)에만 들어가고, 이 화면에는 이메일 · 프로젝트만 보입니다. 올린 뒤 내려받은 파일은 지우세요.</p>
      <Received row={row} names={names} />
      {row ? (
        <p>
          서비스 계정 <b className="font-semibold text-ink-dim" data-testid="sa-email">{String(row.summary.client_email ?? '—')}</b> · 프로젝트{' '}
          <b className="font-semibold text-ink-dim">{String(row.summary.project_id ?? '—')}</b>
        </p>
      ) : null}
      <p>
        시트 동기화가 지금 쓰는 자리(앱 서버 환경변수): <b className="font-semibold text-ink-dim">{sheetsEnv ? '있음' : '없음'}</b> — Vault의 키를 동기화가 읽게 바꾸는 것은 다음 단계입니다.
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const f = fileRef.current?.files?.[0]
          if (!f) {
            setMsg('키 파일(JSON)을 고르세요.')
            return
          }
          const fd = new FormData()
          fd.set('file', f)
          start(async () => {
            const x = await uploadGoogleServiceAccountAction(fd)
            setMsg(x.error ?? x.ok ?? null)
            if (fileRef.current) fileRef.current.value = ''
            if (x.ok) router.refresh()
          })
        }}
      >
        <input ref={fileRef} type="file" accept=".json,application/json" aria-label="서비스 계정 키 파일(JSON)" className="min-w-0 max-w-full text-t11h text-ink-dim" />
        <button className={btn} disabled={busy}>
          {row ? '바꿔 올리기' : '올리기'}
        </button>
        {msg ? <p className="w-full" aria-live="polite">{msg}</p> : null}
      </form>
    </Card>
  )
}

/* ---------------------------------------------------------------- 4. 원가 관리 권한자 */

function CostManagerCard({ businesses, people, names, find }: OwnerInputsProps & { find: Find }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [biz, setBiz] = useState(businesses[0]?.business_id ?? '')
  const [who, setWho] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const row = find('cost_manager', biz)
  const pick = people.filter((x) => x.group || x.business_ids.includes(biz))
  const holders = people.filter((x) => x.costing.includes(biz))
  const anyGot = businesses.some((b) => find('cost_manager', b.business_id))
  const picked = row && typeof row.summary.user_id === 'string' ? names[row.summary.user_id] ?? '—' : null
  return (
    <Card title="4. 원가 관리 권한자" state={anyGot ? 'got' : 'none'} testId="owner-input-cost_manager">
      <p>회사 직원 중 한 사람을 고르면 그 회사의 «원가 관리» 권한을 줍니다(회사마다 셋까지 · 조회는 모두 기록). 빼는 것은 사용자 · 권한 화면에서.</p>
      <BizSelect
        value={biz}
        onChange={(v) => {
          setBiz(v)
          setWho('')
          setMsg(null)
        }}
        businesses={businesses}
        label="회사"
      />
      <Received row={row} names={names} />
      {picked ? (
        <p>
          고른 사람: <b className="font-semibold text-ink-dim">{picked}</b>
        </p>
      ) : null}
      <p>지금 원가 권한이 있는 사람: {holders.length > 0 ? holders.map((h) => h.name).join(', ') : '없음'}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            const x = await setCostManagerAction({ businessId: biz, userId: who })
            setMsg(x.error ?? x.ok ?? null)
            if (x.ok) router.refresh()
          })
        }}
      >
        <label className="block min-w-0 flex-1">
          사람
          <select value={who} onChange={(e) => setWho(e.target.value)} className={`${input} block w-full`}>
            <option value="">— 고르기 —</option>
            {pick.map((x) => (
              <option key={x.user_id} value={x.user_id}>
                {x.name} · {x.role}
                {x.costing.includes(biz) ? ' (권한 있음)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button className={btn} disabled={busy || !who}>
          권한 주기
        </button>
        {msg ? <p className="w-full" aria-live="polite">{msg}</p> : null}
      </form>
      <Link href="/settings/users" className="inline-block underline-offset-2 hover:underline">
        사용자 · 권한 화면
      </Link>
    </Card>
  )
}
