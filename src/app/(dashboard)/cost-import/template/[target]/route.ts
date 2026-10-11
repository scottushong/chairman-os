import { contentDisposition, XLSX_CONTENT_TYPE } from '@/lib/approval-ledger-xlsx'
import { currentUser } from '@/lib/auth/session'
import { buildImportTemplate, templateFileName } from '@/lib/cost-import/template'
import { IMPORT_TARGETS, type ImportTarget } from '@/lib/cost-import/types'

/**
 * GET /cost-import/template/<대상> — 원가 엔진 엑셀 넣기의 **빈 양식**(칸 이름 · 예시 한 줄 · 설명 시트).
 * 실제 자료 0 — 저장소를 부르지 않는다(lib/cost-import/template.ts). 회장 결정 2026-10-11: 원가 엔진에서 내려받을 수 있는 것은
 * 이 빈 양식뿐이다(대표 예외 제외). 화면 주소 밑에 두어 로그인 · 2단계 관문을 탄다. BOM 양식은 대표만(직원에게 BOM 기능을 드러내지 않는다).
 */
export const dynamic = 'force-dynamic'

function fail(status: number, message: string) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(_request: Request, ctx: RouteContext<'/cost-import/template/[target]'>) {
  const user = await currentUser()
  if (!user) return fail(401, '로그인이 필요합니다.')
  const { target } = await ctx.params
  if (!IMPORT_TARGETS.includes(target as ImportTarget)) return fail(404, '찾을 수 없습니다.')
  if (target === 'bom' && user.role !== 'Chairman') return fail(404, '찾을 수 없습니다.')
  const buffer = await buildImportTemplate(target as ImportTarget).xlsx.writeBuffer()
  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': contentDisposition(templateFileName(target as ImportTarget)),
      'Cache-Control': 'no-store',
    },
  })
}
