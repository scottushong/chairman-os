import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { SheetFrame } from '@/components/ui/sheet-frame'
import { embedSrc } from '@/lib/process-chart'
import { getRepository } from '@/lib/repository'

/**
 * 프로세스차트 전체 화면 (Phase 5-D).
 *
 * 대시보드 카드는 1/3 폭이라 표가 몇 칸밖에 안 보인다. 실제로 읽으려면 이 화면이 필요하다.
 *
 * 권한은 DB가 본다 — 0021의 can_read_process_charts()가 Executive 이상 + 자기 회사만
 * 내주므로, 볼 수 없는 차트는 목록에 아예 없고 여기서 404가 된다.
 * '있지만 권한이 없다'고 말하지 않는 것은 회사 상세(CH-023)와 같은 규칙이다 —
 * 그 말 자체가 그 회사에 그런 팀이 있다는 사실을 알려 준다.
 */
export default async function ProcessChartPage(props: PageProps<'/process/[id]'>) {
  const { id } = await props.params
  const repo = await getRepository()
  const [charts, businesses] = await Promise.all([repo.listProcessCharts(), repo.listBusinesses()])

  const chart = charts.find((c) => String(c.id) === id)
  if (!chart) notFound()

  const business = businesses.find((b) => b.business_id === chart.business_id)

  return (
    <div className="flex h-full flex-col px-6 py-5">
      <PageHeader
        icon="grid"
        title={chart.title}
        code="CH-055"
        description={`${business?.name ?? chart.business_id} · ${chart.team_name}`}
      >
        <a
          href={chart.embed_url}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          시트에서 편집
        </a>
        <Link
          href="/"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          대시보드로
        </Link>
      </PageHeader>

      <SheetFrame
        src={embedSrc(chart.embed_url)}
        title={chart.title}
        className="mt-4 min-h-[70vh] flex-1 rounded-lg border border-line"
      />
    </div>
  )
}
