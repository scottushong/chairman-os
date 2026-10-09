import Link from 'next/link'

import { ApprovalForm, type ApprovalFormInitial } from '@/components/approvals/approval-form'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { approvalChainPreview } from '@/lib/approval-submit'
import { currentUser } from '@/lib/auth/session'
import { boss, isChairman } from '@/lib/boss'
import { kstToday } from '@/lib/chairman-project'
import { tr, type Lang } from '@/lib/i18n'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * `/approvals/new` — 양식으로 결재 올리기 (Phase 9 블록 2 · 0059 단계 결재).
 *
 * 양식(0038 approval_templates)과 회사마다 이 사람의 상사 사슬(0059 my_approval_chain)을 서버에서 읽어 내린다.
 * 올릴 수 있는 회사는 이 사람에게 보이는 회사다 — 모듈 권한(can_module)은 DB가 본다.
 *
 * ?resubmit=<결재 id> — 내가 올려 반려된 결재를 고쳐 다시 올린다(0059 재상신). 내 것이 아니거나 반려가 아니면 무시한다.
 * 판정(같은 양식 · 같은 회사 · 한 번)은 트리거가 한 번 더 한다.
 */
export default async function NewApprovalPage(props: PageProps<'/approvals/new'>) {
  await recordScreenRead({ path: '/approvals/new', kind: 'page' })

  const params = await props.searchParams
  const resubmitId = firstParam(params.resubmit)?.trim() ?? ''
  const user = await currentUser()
  const lang: Lang = user?.language ?? 'ko'
  const repo = await getRepository()
  const [templates, businessRows, decisions] = await Promise.all([
    repo.listApprovalTemplates(),
    repo.listBusinesses(),
    resubmitId ? repo.listDecisions() : Promise.resolve([]),
  ])
  const businesses = businessRows.filter((b) => b.visible).map((b) => ({ id: b.business_id, name: b.name }))
  const due = new Date(`${kstToday()}T00:00:00Z`)
  due.setUTCDate(due.getUTCDate() + 7)

  // 재상신 — 내 반려 결재만. 이미 다시 올렸으면 채우지 않고 그 건을 가리킨다(원본 한 건에 한 번).
  const original = resubmitId
    ? decisions.find(
        (d) =>
          d.decision_id === resubmitId &&
          d.status === 'Rejected' &&
          !!d.template_key &&
          !!user &&
          d.created_by === user.user_id &&
          templates.some((t) => t.template_key === d.template_key),
      )
    : undefined
  const already = original ? decisions.find((d) => d.resubmit_of === original.decision_id) : undefined
  const reason =
    original && !already
      ? ((await repo.listApprovalSteps([original.decision_id]).catch(() => [])).find((s) => s.status === 'rejected')?.note ?? null)
      : null
  const initial: ApprovalFormInitial | undefined =
    original && !already && original.template_key
      ? {
          templateKey: original.template_key,
          businessId: original.business_id,
          title: original.title,
          form: original.form ?? {},
          resubmitOf: original.decision_id,
        }
      : undefined

  // 회사마다 상사 사슬(대표 앞까지). 대표 본인은 결재선이 없다 — 올리면 바로 닫힌다.
  const chains = isChairman(user?.role)
    ? {}
    : Object.fromEntries(await Promise.all(businesses.map(async (b) => [b.id, await approvalChainPreview(repo, b.id)] as const)))

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-5 lg:px-6">
      <PageHeader
        icon="stamp"
        title={tr(lang, initial ? '결재 다시 올리기' : '결재 올리기', initial ? 'Resubmit approval' : 'New approval')}
        code="Phase 9 · Block 2"
        description={tr(
          lang,
          `양식을 고르고 항목을 채우면, 올리기 전에 결재선(직속 상사 → 기준 이상이면 상위 상사 → ${boss(user?.role)})을 먼저 보여 드립니다.`,
          'Pick a template, fill it in, and see the approval line before you submit.',
        )}
      />
      {initial ? (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-t12h text-ink-dim">
          반려된 결재{' '}
          <Link href={`/approvals?tab=done&id=${initial.resubmitOf}`} className="font-semibold text-accent tnum underline-offset-2 hover:underline">
            {initial.resubmitOf}
          </Link>
          를 고쳐 다시 올립니다 — 반려 사유: {reason ?? '—'}
        </p>
      ) : already ? (
        <p className="mt-3 rounded-lg border border-line bg-raised px-3 py-2 text-t12h text-ink-dim">
          {original?.decision_id}는 이미 다시 올렸습니다 —{' '}
          <Link href={`/approvals?id=${already.decision_id}`} className="font-semibold text-accent tnum underline-offset-2 hover:underline">
            {already.decision_id}
          </Link>
          . 아래는 새 결재로 올라갑니다.
        </p>
      ) : null}
      <ApprovalForm
        key={initial?.resubmitOf ?? 'new'}
        templates={templates}
        chains={chains}
        initial={initial}
        businesses={businesses}
        defaultDeadline={due.toISOString().slice(0, 10)}
        lang={lang}
        viewerRole={user?.role ?? null}
      />
    </div>
  )
}
