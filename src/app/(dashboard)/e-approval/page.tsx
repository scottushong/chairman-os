import Link from 'next/link'
import { redirect } from 'next/navigation'
import { canSeeInvestment } from '@/lib/investment/screen-rules'

import { EaCompose } from '@/components/e-approval/ea-compose'
import { EaDetail } from '@/components/e-approval/ea-detail'
import { C, FOLLOWUP_TONE, Pill, STATUS_TONE } from '@/components/e-approval/parts'
import { eaStore } from '@/lib/approvals/store'
import {
  DOC_STATUS_LABEL,
  EA_BOX_HINT,
  EA_BOX_LABEL,
  EA_BOXES,
  FOLLOWUP_STATUS_LABEL,
  eaErrorText,
  shortDate,
  STEP_STATUS_LABEL,
  type EaBox,
  type EaCounts,
  type EaDocView,
  type EaListRow,
} from '@/lib/approvals/types'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { featureOn } from '@/lib/features-server'
import { firstParam, oneOf, withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * 0087 «전자결재» — 시안 docs/specs/2026-10-19-approvals-mock.png 그대로: 위 탭 일곱(건수) · 왼쪽 목록 · 오른쪽 상세. 기본 탭 «결재할 문서».
 * 모바일(lg 아래)은 목록과 상세를 나눠 보여 주고 «← 목록으로»로 돌아간다.
 * 목록 · 건수 · 상세는 전부 서버가 권한을 본다(live = ea_list · ea_counts · ea_doc). 홈 위젯도 같은 함수다(lib/approvals/widget.ts).
 * 스위치 approvals(0087 · 기본 대표만 · 회사 줄을 켜면 그 회사 전원). 예전 «결재»(/approvals · 결재 대장)는 그대로 둔다.
 * 직원 화면이다 — «회장»이 들어가지 않는다(역할 단계는 «대표»).
 */
export const dynamic = 'force-dynamic'

const BASE = '/e-approval'
const MINE_FILTER = ['all', 'in_progress', 'rejected', 'approved', 'withdrawn'] as const
const MINE_LABEL: Record<(typeof MINE_FILTER)[number], string> = { all: '전체', in_progress: '진행 중', rejected: '반려', approved: '승인 완료', withdrawn: '회수' }
const REF_FILTER = ['all', 'unconfirmed', 'confirmed'] as const
const REF_LABEL: Record<(typeof REF_FILTER)[number], string> = { all: '전체', unconfirmed: '미확인', confirmed: '확인' }
const FU_FILTER = ['all', 'waiting', 'doing', 'done'] as const
const FU_LABEL: Record<(typeof FU_FILTER)[number], string> = { all: '전체', waiting: '처리 대기', doing: '처리 중', done: '처리 완료' }

export default async function EApprovalPage(props: PageProps<'/e-approval'>) {
  const params = await props.searchParams
  const user = await currentUser()
  if (!user) redirect('/login')
  const repo = await getRepository()
  const businesses = (await repo.listBusinesses().catch(() => [])).filter((b) => b.status !== 'Archived').sort((a, b) => a.sort_order - b.sort_order)
  const open = (await Promise.all(businesses.map(async (b) => ((await featureOn(user, 'approvals', b.business_id)) ? b : null)))).filter((b) => b !== null)
  if (!open.length) {
    return (
      <div className={`${C.bg} min-h-full p-4 sm:p-6`}>
        <div className={`${C.card} max-w-xl px-5 py-6`}>
          <h1 className="text-[18px] font-bold text-[#1f2329]">전자결재</h1>
          <p className="mt-2 text-[14px] text-[#6b7280]">지금은 쓸 수 없는 기능입니다. 회사에서 전자결재를 켜면 이 자리에 결재할 문서가 보입니다.</p>
        </div>
      </div>
    )
  }

  const box: EaBox = oneOf(firstParam(params.box), EA_BOXES) ?? 'todo'
  const q = firstParam(params.q)?.trim().slice(0, 60) || ''
  const docParam = firstParam(params.doc)
  const docId = docParam && /^[0-9a-f-]{36}$/i.test(docParam) ? docParam : null
  const formFilter = firstParam(params.form) || ''
  const from = firstParam(params.from) || ''
  const to = firstParam(params.to) || ''
  const st = firstParam(params.st) || 'all'
  const newParam = firstParam(params.new)
  const editParam = firstParam(params.edit)

  const store = await eaStore()
  let counts: EaCounts | null = null
  let rows: EaListRow[] = []
  let detail: EaDocView | null = null
  let loadError: string | null = null
  const forms = await store.forms().catch(() => [])
  try {
    ;[counts, rows] = await Promise.all([store.counts(), store.list(box, q || null)])
  } catch (e) {
    loadError = eaErrorText(e)
  }

  // 목록 거르기(제목 · 기안자 검색은 서버 · 나머지는 여기서).
  const filtered = rows.filter((r) => {
    if (formFilter && r.form_key !== formFilter) return false
    const day = (r.submitted_at ?? r.updated_at).slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    if (box === 'mine' && st !== 'all' && r.status !== st) return false
    if (box === 'refs' && st === 'unconfirmed' && r.ref_confirmed) return false
    if (box === 'refs' && st === 'confirmed' && !r.ref_confirmed) return false
    if (box === 'followups' && st !== 'all' && r.followup_status !== st) return false
    return true
  })
  const selectedId = docId ?? filtered[0]?.doc_id ?? null
  if (selectedId && !loadError) detail = await store.detail(selectedId).catch(() => null)
  const denied = !!docId && !detail && !loadError

  // 작성 화면(새 문서 · 이어서 쓰기)
  const composing = newParam && newParam !== '1' ? forms.find((f) => f.form_key === newParam && f.active) : null
  let editView: EaDocView | null = null
  if (editParam && /^[0-9a-f-]{36}$/i.test(editParam)) editView = await store.detail(editParam).catch(() => null)
  const editForm = editView && editView.doc.status === 'draft' && editView.me.drafter ? forms.find((f) => f.form_key === editView!.doc.form_key) : null

  const href = (p: Record<string, string | null | undefined>) => withParams(BASE, { box, q: q || null, form: formFilter || null, from: from || null, to: to || null, st: st !== 'all' ? st : null, ...p })
  const isChair = user.role === 'Chairman'

  return (
    <div className={`${C.bg} flex min-h-full flex-col pb-20 lg:pb-6`}>
      <nav aria-label="전자결재 탭" className="border-b border-[#e3e6eb] bg-white">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:px-5">
          <div className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
            {EA_BOXES.map((b) => (
              <Link
                key={b}
                href={withParams(BASE, { box: b })}
                aria-current={b === box && !newParam && !editParam ? 'page' : undefined}
                className={`shrink-0 rounded-md px-3 py-2 text-[14px] whitespace-nowrap ${b === box && !newParam && !editParam ? 'bg-[#eaf0fd] font-semibold text-[#2f5bd3]' : 'text-[#1f2329] hover:bg-[#f4f6f9]'}`}
              >
                {EA_BOX_LABEL[b]} <span className="ml-1 tnum">{counts ? counts[b] : '·'}</span>
              </Link>
            ))}
          </div>
          <Link href={withParams(BASE, { box, new: '1' })} className={`${C.btn} shrink-0`}>
            새 문서 작성
          </Link>
        </div>
      </nav>

      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold text-[#1f2329]">{newParam || editParam ? '새 문서 작성' : EA_BOX_LABEL[box]}</h1>
            <p className="mt-0.5 text-[14px] text-[#6b7280]">{newParam || editParam ? '양식을 고르고 내용을 채운 뒤 상신합니다.' : EA_BOX_HINT[box]}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Pill tone="blue">내 권한의 문서만 표시</Pill>
            <Link href="/e-approval/settings" className="text-[#2f5bd3] hover:underline">
              개인 설정
            </Link>
            {isChair ? (
              <Link href="/e-approval/admin" className="text-[#2f5bd3] hover:underline">
                관리
              </Link>
            ) : null}
            {store.mode === 'dummy' ? <Pill tone="orange">개발용 dummy — 실제 결재 아님</Pill> : null}
          </div>
        </div>

        {newParam === '1' ? (
          <section className={`${C.card} px-4 py-5 sm:px-6`}>
            <h2 className="text-[16px] font-semibold text-[#1f2329]">양식 선택</h2>
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {forms
                .filter((f) => f.active)
                .map((f) => (
                  <li key={f.form_key}>
                    <Link href={withParams(BASE, { box: 'drafts', new: f.form_key })} className="flex h-full flex-col gap-1 rounded-md border border-[#e3e6eb] px-3 py-3 hover:border-[#3361e0] hover:bg-[#f7f9fe]">
                      <span className="text-[15px] font-semibold text-[#1f2329]">{f.name_ko}</span>
                      <span className="text-[12px] text-[#6b7280]">
                        {f.attachment_required ? '첨부 필요 · ' : ''}
                        {f.followup_kind ? `승인 뒤 ${f.followup_kind}` : '후속 처리 없음'}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ) : composing || editForm ? (
          <EaCompose
            form={(editForm ?? composing)!}
            forms={forms.filter((f) => f.active && (f.form_key !== 'investment' || canSeeInvestment(user)))}
            people={await store.people().catch(() => [])}
            businesses={open.map((b) => ({ business_id: b.business_id, name: b.name }))}
            initial={editForm ? editView : null}
            favorites={(await store.mySettings().catch(() => null))?.favorites ?? []}
            mode={store.mode}
            me={{ name: user.name, dept: null }}
          />
        ) : editParam ? (
          <Empty text="이어서 쓸 수 있는 임시저장 문서가 아닙니다(이미 상신했거나 권한이 없습니다)." />
        ) : loadError ? (
          <Empty text={`목록을 불러오지 못했습니다 — ${loadError}`} tone="bad" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
            <section className={`${C.card} ${docId ? 'hidden lg:flex' : 'flex'} min-w-0 flex-col overflow-hidden`}>
              <form action={BASE} className="flex flex-col gap-2 border-b border-[#eceef2] p-3">
                <input type="hidden" name="box" value={box} />
                <input name="q" defaultValue={q} placeholder="제목·기안자 검색" className={C.input} aria-label="제목·기안자 검색" />
                <details className="text-[13px]" open={!!(formFilter || from || to || st !== 'all')}>
                  <summary className="cursor-pointer text-[#6b7280]">상태 · 양식 · 기간</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {box === 'mine' || box === 'refs' || box === 'followups' ? (
                      <select name="st" defaultValue={st} className={C.input} aria-label="상태">
                        {(box === 'mine' ? MINE_FILTER : box === 'refs' ? REF_FILTER : FU_FILTER).map((k) => (
                          <option key={k} value={k}>
                            {box === 'mine' ? MINE_LABEL[k as keyof typeof MINE_LABEL] : box === 'refs' ? REF_LABEL[k as keyof typeof REF_LABEL] : FU_LABEL[k as keyof typeof FU_LABEL]}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <select name="form" defaultValue={formFilter} className={C.input} aria-label="양식">
                      <option value="">모든 양식</option>
                      {forms.map((f) => (
                        <option key={f.form_key} value={f.form_key}>
                          {f.name_ko}
                        </option>
                      ))}
                    </select>
                    <input type="date" name="from" defaultValue={from} className={C.input} aria-label="시작일" />
                    <input type="date" name="to" defaultValue={to} className={C.input} aria-label="종료일" />
                    <button type="submit" className={`${C.btnLine} col-span-2`}>
                      거르기
                    </button>
                  </div>
                </details>
              </form>
              {box === 'mine' || box === 'refs' || box === 'followups' ? (
                <div className="flex gap-1 overflow-x-auto border-b border-[#eceef2] px-3 py-2">
                  {(box === 'mine' ? MINE_FILTER : box === 'refs' ? REF_FILTER : FU_FILTER).map((k) => (
                    <Link key={k} href={href({ st: k === 'all' ? null : k, doc: null })} className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] ${st === k ? 'bg-[#eaf0fd] text-[#2f5bd3]' : 'text-[#4b5563] hover:bg-[#f4f6f9]'}`}>
                      {box === 'mine' ? MINE_LABEL[k as keyof typeof MINE_LABEL] : box === 'refs' ? REF_LABEL[k as keyof typeof REF_LABEL] : FU_LABEL[k as keyof typeof FU_LABEL]}
                    </Link>
                  ))}
                </div>
              ) : null}
              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-[14px] text-[#6b7280]">{q || formFilter || from || to || st !== 'all' ? '검색 결과가 없습니다.' : emptyText(box)}</div>
              ) : (
                <ul>
                  {filtered.map((r) => (
                    <li key={r.doc_id}>
                      <Link
                        href={href({ doc: r.doc_id })}
                        className={`flex flex-col gap-1.5 border-b border-[#eceef2] px-4 py-3.5 ${r.doc_id === selectedId ? 'border-l-[3px] border-l-[#3361e0] bg-[#eef3fd] pl-[13px]' : 'hover:bg-[#f7f9fc]'}`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">{rowBadges(box, r)}</div>
                        <div className="text-[15px] break-words text-[#1f2329]">{r.title}</div>
                        <div className="flex items-center justify-between gap-2 text-[12px] text-[#4b5563]">
                          <span className="min-w-0 truncate">
                            {r.drafter_name}
                            {r.drafter_dept ? ` · ${r.drafter_dept}` : ''} · {r.form_name}
                          </span>
                          <span className="shrink-0 tnum">{shortDate(r.submitted_at ?? r.updated_at)}</span>
                        </div>
                        <div className="text-[13px] text-[#4b5563]">{rowLine(box, r)}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className={`${docId ? 'flex' : 'hidden lg:flex'} min-w-0 flex-col`}>
              {detail ? (
                <EaDetail view={detail} box={box} mode={store.mode} backHref={href({ doc: null })} today={kstToday()} />
              ) : denied ? (
                <Empty text="이 문서를 볼 권한이 없거나 없는 문서입니다." back={href({ doc: null })} />
              ) : (
                <Empty text={filtered.length ? '왼쪽에서 문서를 고르세요.' : '선택한 문서가 없습니다.'} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function emptyText(box: EaBox) {
  return {
    todo: '지금 내 차례인 문서가 없습니다.',
    planned: '결재 예정인 문서가 없습니다.',
    mine: '올린 문서가 없습니다.',
    drafts: '임시저장한 문서가 없습니다.',
    history: '처리한 기록이 없습니다.',
    refs: '참조 · 공유받은 문서가 없습니다.',
    followups: '맡은 후속 처리가 없습니다.',
  }[box]
}

function rowBadges(box: EaBox, r: EaListRow) {
  const out = [
    <Pill key="s" tone={STATUS_TONE[r.status]}>
      {DOC_STATUS_LABEL[r.status]}
    </Pill>,
  ]
  if (r.overdue) out.push(<Pill key="o" tone="orange">{r.my_role === 'agree' ? '합의' : '검토'} 기한 지남</Pill>)
  if (r.as_proxy && box === 'todo') out.push(<Pill key="p" tone="gray">대결</Pill>)
  if (r.version > 1) out.push(<Pill key="v" tone="gray">{r.version}판</Pill>)
  if (box === 'refs') out.push(<Pill key="r" tone={r.ref_confirmed ? 'green' : 'orange'}>{r.ref_confirmed ? '확인' : '미확인'}</Pill>)
  if (box === 'followups' && r.followup_status) out.push(<Pill key="f" tone={FOLLOWUP_TONE[r.followup_status]}>{FOLLOWUP_STATUS_LABEL[r.followup_status]}</Pill>)
  return out
}

function rowLine(box: EaBox, r: EaListRow) {
  if (box === 'history') return `내 결과 ${r.my_result ? STEP_STATUS_LABEL[r.my_result] : '—'}${r.as_proxy ? '(대결)' : ''} · 문서 ${DOC_STATUS_LABEL[r.status]}`
  if (box === 'planned') return `지금 ${r.current_label} · 내 예정 역할 ${r.my_role === 'agree' ? '합의' : '승인'}`
  if (box === 'followups') return `${r.followup_kind ?? '후속'} · 문서 ${DOC_STATUS_LABEL[r.status]}`
  return r.current_label
}

function Empty({ text, tone, back }: { text: string; tone?: 'bad'; back?: string }) {
  return (
    <div className={`${C.card} flex flex-col items-center gap-3 px-4 py-12 text-center text-[14px] ${tone === 'bad' ? 'text-[#b4372b]' : 'text-[#6b7280]'}`}>
      {text}
      {back ? (
        <Link href={back} className="text-[13px] text-[#2f5bd3] lg:hidden">
          ← 목록으로
        </Link>
      ) : null}
    </div>
  )
}
