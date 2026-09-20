import { PageHeader } from '@/components/layout/page-header'
import { ProcessChartManager } from '@/components/settings/process-chart-manager'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 프로세스차트 등록 (Phase 5-D). 팀별 구글 시트 게시 링크를 연결한다.
 *
 * 편집은 Chairman·GroupCFO만 — 0021의 can_write_process_charts()가 판정한다.
 * 여기서 canEdit을 넘기는 것은 없는 버튼을 보여 주지 않으려는 것뿐이다.
 */
export default async function ProcessChartsSettingsPage() {
  const repo = await getRepository()
  const [charts, businesses, user] = await Promise.all([
    repo.listProcessCharts(),
    repo.listBusinesses(),
    currentUser(),
  ])

  const canEdit = user?.role === 'Chairman' || user?.role === 'GroupCFO'

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <PageHeader
        icon="grid"
        title="프로세스차트"
        code="CH-055"
        description="팀별 업무 프로세스 시트를 대시보드에 연결합니다. 시트 내용은 옮기지 않고 링크만 보관합니다."
      />
      <div className="mt-4">
        <ProcessChartManager charts={charts} businesses={businesses} canEdit={canEdit} />
      </div>
    </div>
  )
}
