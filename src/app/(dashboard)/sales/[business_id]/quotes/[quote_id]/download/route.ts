import { contentDisposition, XLSX_CONTENT_TYPE } from '@/lib/approval-ledger-xlsx'
import { canReadSales } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { buildCustomerQuote } from '@/lib/sales/quote-xlsx'

/**
 * GET /sales/<회사>/quotes/<견적>/download — 고객용 견적서(.xlsx). 원가 · 마진 없음(lib/sales/quote-xlsx.ts).
 * 화면 주소 밑에 둔다(결재 대장 엑셀과 같은 이유 — 로그인 + 2단계 관문). 요청한 사람의 세션으로 읽는다(RLS).
 * 파일을 돌려주기 **전에** 0066 quote_download_log(확정 견적만 · 감사)를 남긴다 — 기록이 실패하면 파일도 없다.
 */
export const dynamic = 'force-dynamic'

function fail(status: number, message: string) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(_request: Request, ctx: RouteContext<'/sales/[business_id]/quotes/[quote_id]/download'>) {
  const { business_id, quote_id } = await ctx.params
  const user = await currentUser()
  if (!user) return fail(401, '로그인이 필요합니다.')
  if (!canReadSales(user, business_id)) return fail(404, '찾을 수 없습니다.')
  try {
    const repo = await getRepository()
    const [found, businesses] = await Promise.all([repo.getQuote(quote_id), repo.listBusinesses()])
    if (!found || found.quote.business_id !== business_id) return fail(404, '찾을 수 없습니다.')
    if (found.quote.status !== 'confirmed') return fail(409, '확정된 견적만 고객용 견적서를 내려받을 수 있습니다.')
    const supplier = businesses.find((b) => b.business_id === business_id)?.name ?? business_id
    const buffer = await buildCustomerQuote(found.quote, supplier).xlsx.writeBuffer()
    await repo.logQuoteDownload(quote_id, 'xlsx')
    const name = `견적서_${found.quote.customer_company}_${found.quote.product_name}_${found.quote.version}판.xlsx`
    return new Response(new Uint8Array(buffer as ArrayBuffer), {
      headers: { 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': contentDisposition(name), 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[quote download]', e instanceof Error ? e.message : String(e))
    return fail(500, '견적서를 만들지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}
