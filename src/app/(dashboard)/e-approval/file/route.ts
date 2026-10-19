import { NextResponse, type NextRequest } from 'next/server'

import { eaStore } from '@/lib/approvals/store'

/**
 * 0087 첨부 내려받기. 권한은 버킷 정책(ea_object_read_ok = 그 첨부를 가진 문서를 읽을 수 있는가)이 정한다 —
 * live는 사람 세션으로 60초 서명 주소를 받아 넘기고(정책 밖이면 서명이 안 나온다), dummy는 엔진의 같은 판정 뒤 바이트.
 * 권한 없으면 404(있는지도 말하지 않는다).
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!/^[0-9a-f-]{36}\/[0-9a-zA-Z._-]{1,120}$/.test(path)) return new NextResponse('없는 파일입니다.', { status: 404 })
  const store = await eaStore()
  const got = await store.fileGet(path).catch(() => null)
  if (!got) return new NextResponse('없는 파일이거나 볼 권한이 없습니다.', { status: 404 })
  if ('url' in got) return NextResponse.redirect(got.url)
  return new NextResponse(Buffer.from(got.bytes), { headers: { 'content-type': got.mime, 'cache-control': 'private, no-store' } })
}
