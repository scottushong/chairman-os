/**
 * 기억 엔진 — 앞 정보 모으기(순수). 저장소(live · dummy · 시험)가 같은 대상의 연결 · 정보 · 바깥 인물 줄을 읽어 넘기면
 * 바뀜 찾기(detect.ts)가 쓰는 PriorItem으로 묶는다. 기록 단위 연결(item_id null)은 그 기록의 모든 정보에 걸린다.
 */
import type { LinkTargetType, MemoryEntity, MemoryItem, MemoryLink, PriorItem } from './types'

export interface PriorRows {
  links: Pick<MemoryLink, 'capture_id' | 'item_id' | 'target_type' | 'target_id' | 'verification_status'>[]
  items: MemoryItem[]
  entities: Pick<MemoryEntity, 'entity_id' | 'display_name'>[]
  capturedAt: Map<string, string>
}

/** 찾을 대상 → (실제 id 대상, 이름으로 찾을 바깥 인물 이름) */
export function splitTargets(targets: { target_type: LinkTargetType; target_id: string }[]): { ids: { target_type: LinkTargetType; target_id: string }[]; names: string[] } {
  const ids = targets.filter((t) => !t.target_id.startsWith('name:'))
  const names = [...new Set(targets.filter((t) => t.target_id.startsWith('name:')).map((t) => t.target_id.slice(5).trim().toLowerCase()))]
  return { ids, names }
}

export function assemblePrior(currentCaptureId: string, rows: PriorRows): PriorItem[] {
  const entName = new Map(rows.entities.map((e) => [e.entity_id, e.display_name]))
  const liveLinks = rows.links.filter((l) => l.verification_status !== 'rejected' && l.capture_id !== currentCaptureId)
  const out: PriorItem[] = []
  for (const it of rows.items) {
    if (it.capture_id === currentCaptureId) continue
    const mine = liveLinks.filter((l) => l.capture_id === it.capture_id && (l.item_id === null || l.item_id === it.item_id))
    if (mine.length === 0) continue
    const targets: PriorItem['targets'] = []
    for (const l of mine) {
      targets.push({ target_type: l.target_type, target_id: l.target_id })
      if (l.target_type === 'entity' && entName.has(l.target_id)) targets.push({ target_type: 'entity', target_id: `name:${entName.get(l.target_id)}` })
    }
    out.push({ ...it, targets, captured_at: rows.capturedAt.get(it.capture_id) ?? it.created_at })
  }
  return out
}
