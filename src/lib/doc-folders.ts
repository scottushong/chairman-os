import type { DocFolder, Team } from '@/types'

/**
 * 문서 폴더 트리 (Phase 9 블록 3) — 회사 > 팀 > 폴더.
 *
 * 회사 층과 팀 층은 이미 있는 표(businesses · teams)이고 폴더만 0038 doc_folders다. 이 파일은
 * 그 셋을 한 트리로 접고, 폴더마다 «팀 / 폴더 / 하위» 경로 문자열을 만든다(등록 폼 · 목록이 쓴다).
 */

export interface FolderNode {
  folder: DocFolder
  children: FolderNode[]
}

export interface TeamNode {
  team: Team | null
  folders: FolderNode[]
}

/** 한 회사의 트리. 팀이 없는 폴더(team_id null)는 team=null 묶음으로 맨 앞에 선다. */
export function companyTree(businessId: string, folders: DocFolder[], teams: Team[]): TeamNode[] {
  const mine = folders.filter((f) => f.business_id === businessId)
  const grow = (parent: number | null, teamId: string | null): FolderNode[] =>
    mine
      .filter((f) => f.parent_id === parent && (parent !== null || f.team_id === teamId))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((f) => ({ folder: f, children: grow(f.folder_id, teamId) }))

  const nodes: TeamNode[] = []
  const loose = grow(null, null)
  if (loose.length > 0) nodes.push({ team: null, folders: loose })
  for (const t of teams.filter((x) => x.business_id === businessId)) {
    const tf = grow(null, t.team_id)
    if (tf.length > 0) nodes.push({ team: t, folders: tf })
  }
  return nodes
}

/** folder_id → '영업 / 견적 / 2026'. 부모가 안 보이면(권한) 보이는 데까지만. */
export function folderPaths(folders: DocFolder[], teams: Team[]): Record<number, string> {
  const byId = new Map(folders.map((f) => [f.folder_id, f]))
  const out: Record<number, string> = {}
  for (const f of folders) {
    const parts: string[] = []
    let cur: DocFolder | undefined = f
    const seen = new Set<number>()
    while (cur && !seen.has(cur.folder_id)) {
      seen.add(cur.folder_id)
      parts.unshift(cur.name)
      cur = cur.parent_id !== null ? byId.get(cur.parent_id) : undefined
    }
    const team = f.team_id ? teams.find((t) => t.team_id === f.team_id)?.name : undefined
    out[f.folder_id] = [team, ...parts].filter(Boolean).join(' / ')
  }
  return out
}

/** 폴더와 그 아래 전부의 id. 폴더를 고르면 하위 폴더의 문서까지 보인다. */
export function descendantIds(folders: DocFolder[], root: number): Set<number> {
  const out = new Set<number>([root])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parent_id !== null && out.has(f.parent_id) && !out.has(f.folder_id)) {
        out.add(f.folder_id)
        grew = true
      }
    }
  }
  return out
}
