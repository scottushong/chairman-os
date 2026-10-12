import { redirect } from 'next/navigation'

/**
 * 예전 주소 (Phase 5-D). 0071부터 프로세스 차트는 사이드 메뉴 «프로세스 차트»(/process-charts)에 산다 —
 * 시트 연결 관리(대표 · CFO)도 그 화면 아래로 옮겼다. 북마크가 깨지지 않게 새 주소로 보낸다.
 */
export default function ProcessChartsSettingsPage(): never {
  redirect('/process-charts')
}
