# Phase 4-A 다듬기 — 회장 첫 사용 피드백 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회장이 4-A를 처음 쓰고 낸 네 가지 — 그룹 브리핑이 잘려 실패하는 것, 캘린더에서 날짜를 눌러도 아무 일이 없는 것, 아침 루틴이 한 줄로 길게 늘어지는 것, 이니셔티브 목록이 표라 무엇이 무엇인지 한눈에 안 들어오는 것 — 을 고친다.

**Architecture:** 새 구조를 만들지 않는다. 네 항목 모두 `2026-09-18-phase-4a-initiatives.md`가 세운 길 위에 있다 — 권한은 마이그레이션의 RLS가 끝내고, 화면은 `ChairmanRepository` 계약만 보고, dummy·supabase 두 어댑터가 같은 계약을 만족한다. 유일하게 새로 들어오는 것은 Supabase Storage다(로고). 그것도 같은 원칙을 따른다: 버킷 정책을 0018 마이그레이션이 정하고, 앱은 `service_role` 없이 **요청자 본인 세션**으로 올리고 읽는다.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Supabase Postgres + RLS + Storage, TypeScript, Tailwind v4, PGlite(`check:migrations`), `node:assert/strict`(`check:*`).

**Spec:** 이 문서 맨 아래 [부록 A — 원 지시](#부록-a--원-지시-2026-09-19-chairman). 저장소에 별도 스펙 문서가 없어 받은 지시를 그대로 옮겼다. 실행자는 부록 A와 이 계획을 같이 읽는다.

**선행 계획:** `docs/superpowers/plans/2026-09-18-phase-4a-initiatives.md` — 이 계획은 그 위의 다듬기다. 거기 Global Constraints는 여기서도 전부 살아 있다.

---

## 시작 전에 확정된 것 (회장 답변 2026-09-19)

| # | 질문 | 확정 |
|---|---|---|
| **P-1** | 비공개 버킷의 로고를 화면에 어떻게 띄우나 | **서명 URL.** `initiatives.logo_url`에는 버킷 내 경로만 넣고, 서버 컴포넌트가 렌더링할 때 `createSignedUrls`로 카드 전부의 URL을 **한 번에** 발급한다(만료 1시간). 요청자 세션으로 발급하므로 Storage RLS가 그대로 적용된다 |
| **P-2** | dummy 모드에서 업로드는 | **메모리에 data URL 보관.** dummy 어댑터가 올라온 바이트를 base64 data URL로 들고 있는다. 업로드→표시 전 흐름을 원격 없이 검증한다 |
| **P-3** | production 반영 범위 | **staging까지 자동, production은 승인 후.** 커밋 → `db:push:staging` → staging 확인 → 스크린샷까지 진행하고 멈춘다. production DB push와 앱 배포는 결과 보고 후 회장 승인을 받는다 (OPERATIONS §9) |

## 실행자가 판단해 넣은 것 (되돌리기 쉬움)

| # | 무엇 | 왜 | 되돌리려면 |
|---|---|---|---|
| **P-4** | `goal`의 글자 수 상한을 500 → 2,000으로 올린다 | "기획 칸 확대"의 목적이 더 길게 쓰는 것이다. 6줄 칸을 줬는데 500자에서 막히면 칸만 커진 셈이다. `chairman_note`는 이미 5,000자다 | Task 8의 `GOAL_MAX`를 `MAX_TEXT`로 되돌린다 |
| **P-5** | 기존 단계별 표를 지우지 않고 `?view=table`로 남긴다 | 원 지시가 "칸반은 옵션으로 남겨도 됨"이다. 이 화면에 칸반은 없고 단계별 표가 그 자리다 | Task 7에서 `InitiativeTable` import와 `view` 분기를 뺀다 |
| **P-6** | Storage 읽기 정책을 `can_read_initiatives()`가 아니라 `can_write_initiatives()`로 건다 | 원 지시가 "Chairman·GroupCFO만 읽기/쓰기"다. `can_read_initiatives()`에는 AIAgent가 들어 있는데, 야간 브리핑은 이미지를 그리지 않는다 | Task 4의 정책 두 줄에서 함수 이름만 바꾼다 |

---

## Global Constraints

선행 계획의 제약이 전부 유효하다. 이 계획에서 특히 자주 걸리는 것만 다시 적는다.

- **권한은 DB에만 있다.** `canEdit` 같은 prop은 안내지 판정이 아니다. 로고 업로드도 같다 — 버튼을 숨기는 것으로 끝나지 않고 0018의 storage 정책이 다시 본다.
- **`service_role`은 없다.** 업로드·서명 URL 발급은 전부 요청자 세션 클라이언트(`createSupabaseServerClient()`)로 한다. 서비스 키를 도입하지 않는다.
- **감사 기록은 쓰기보다 먼저.** `supabase.ts`의 모든 mutator가 `before`를 읽고 `audit_log`를 넣은 **다음** 실제 쓰기를 한다. 로고 경로 변경도 `initiatives` 행 변경이므로 이 규칙에 들어온다.
- **삭제는 `action: 'update'` + `after: null`.** `audit_action` enum에 `'delete'`가 없다. 공유 enum을 고치지 않는다.
- **흐리게(opacity)는 위험색을 덮지 않는다.** `text-critical` 요소의 **어느 조상도** opacity를 가질 수 없다. 카드 그리드에서 세 번째로 이 실수를 하기 쉬운 자리다 — 정체된 건일수록 기한이 지나 있다.
- **색은 위험·승인대기에만.** 단계 뱃지에 색을 주지 않는다.
- **열거값은 `*_LABEL_KO`를 거쳐 나간다.**
- **오늘은 KST다.** `kstToday()`.
- **테스트 프레임워크는 없다.** 검증은 `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:migrations`, `check:boundaries`, `check:db-safety`, `check:finance`, 그리고 dummy 모드 dev 서버의 실제 조작이다. 새 단언은 `scripts/check-migrations.ts`에 더한다.
- **마이그레이션 번호는 0018.** 0017은 커밋되었다(`cea2f42`). 고치지 않는다.
- **커밋은 항목마다.** 원 지시가 "각 항목 커밋"이다. Task 경계가 곧 커밋 경계다.
- **`AGENTS.md`의 nextjs-agent-rules 블록**은 `next dev`가 다시 써 넣는다. diff에 나오면 같이 커밋한다.

---

## File Structure

### 새로 만드는 것

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0018_initiative_logos.sql` | `initiatives.logo_url` + `initiative-logos` 비공개 버킷 + storage 정책 2개 |
| `src/components/calendar/day-modal.tsx` | 날짜 팝업 — 그 날 항목 목록 · 일정 추가 · 수정 · 삭제(확인 1회). 클라이언트 |
| `src/components/calendar/month-grid-client.tsx` | 날짜 칸을 버튼으로 만들고 모달을 여는 클라이언트 껍데기 |
| `src/components/initiatives/initiative-cards.tsx` | 카드 그리드(3~4열). 로고·제목·유형·단계·다음행동+D-day·갱신 N일 전·목표 2줄 |
| `src/components/initiatives/initiative-logo.tsx` | 로고 이미지 또는 제목 첫 글자 원형 배지 (서버 컴포넌트) |
| `src/components/initiatives/logo-upload.tsx` | 상세 화면의 업로드·삭제 (클라이언트) |
| `src/lib/initiative-logo.ts` | 순수 규칙: 허용 MIME·최대 바이트·객체 경로·첫 글자 뽑기 |

### 고치는 것

| 파일 | 무엇을 |
|---|---|
| `src/lib/ai/anthropic.ts` | `max_tokens` 4000 → 12000 |
| `src/lib/ai/prompts/daily-brief.md` | 길이 상한 명시 (summary 5문장 · items 7개 · project_notes 각 1문장) |
| `src/app/(dashboard)/calendar/page.tsx` | `listEvents()`를 같이 읽어 모달에 넘긴다. `MonthGrid` → `MonthGridClient` |
| `src/components/calendar/month-grid.tsx` | 표시 로직(`KIND_MARK`·`isPastRisk`·셀 그리기)을 클라이언트에서 재사용하도록 분리 |
| `src/app/(dashboard)/ai/page.tsx` | 좌우 2단 레이아웃 |
| `src/types/initiative.ts` | `Initiative.logo_url: string \| null` |
| `src/lib/repository/types.ts` | 계약에 `saveInitiativeLogo` · `removeInitiativeLogo` · `signInitiativeLogos` 3개 추가 |
| `src/lib/repository/dummy.ts` | 세 메서드 메모리 구현 (data URL) |
| `src/lib/repository/supabase.ts` | 세 메서드 Storage 구현 + `INITIATIVE_COLUMNS`에 `logo_url` |
| `src/app/actions/initiatives.ts` | `saveInitiativeLogoAction` · `removeInitiativeLogoAction`, `goal` 상한 분리 |
| `src/app/(dashboard)/initiatives/page.tsx` | 단계 필터 탭 + 카드 그리드 + 서명 URL 일괄 발급 |
| `src/app/(dashboard)/initiatives/[id]/page.tsx` | 상단 로고 + 업로드 패널 |
| `src/components/initiatives/initiative-panel.tsx` | `textarea` 6줄 + 자동 확장, `goal` 상한 2,000 |
| `scripts/check-migrations.ts` | storage 스키마 스텁 + 버킷 정책 역할별 단언 |

---

## Task 1: 그룹 브리핑 잘림 수정

원 지시 1번. 그룹 브리핑이 `max_tokens`에서 잘려 `anthropic.ts:73`의 `'출력이 max_tokens에서 잘렸다.'`로 죽는다. 한도를 올리고, 동시에 프롬프트에서 길이 자체를 잡는다 — 한도만 올리면 다음에 회사가 늘었을 때 같은 자리에서 다시 잘린다.

**Files:**
- Modify: `src/lib/ai/anthropic.ts:50`
- Modify: `src/lib/ai/prompts/daily-brief.md:14-26`

**Interfaces:**
- Consumes: 없음 (기존 파일 두 곳)
- Produces: 없음 (동작만 바뀐다)

- [ ] **Step 1: `max_tokens`를 올린다**

`src/lib/ai/anthropic.ts`의 `params`에서:

```ts
    const params = {
      model,
      // 그룹 브리핑은 회사 5곳 요약 + 항목 7개 + 프로젝트별 한 줄을 한 응답에 담는다.
      // 4000에서 실제로 잘렸다(2026-09-19 회장 첫 사용). 12000은 그 세 배 여유다 —
      // 길이 자체는 daily-brief.md의 상한이 잡고, 이 숫자는 그 상한을 지킨 응답이
      // 절대 잘리지 않도록 두는 천장이다.
      max_tokens: 12_000,
      system,
      messages: [{ role: 'user' as const, content: JSON.stringify(payload) }],
    }
```

- [ ] **Step 2: 프롬프트에 길이 상한을 못 박는다**

`src/lib/ai/prompts/daily-brief.md`의 `출력 규칙:` 블록을 고친다. 세 줄만 바뀐다.

`- summary: 한국어 3~5문장.` → `- summary: 한국어 3~5문장. 5문장을 넘기지 않는다.`

`- items: 오늘 회장이 결정하거나 확인할 항목 3~7개.` → `- items: 오늘 회장이 결정하거나 확인할 항목 3~7개. 7개를 넘기지 않는다.`

`- project_notes: chairman.projects의 프로젝트마다 정확히 하나, 같은 순서로.` 아래 `action` 줄을 `action: 이번 주에 할 행동 **한 문장**. 두 문장 이상 쓰지 않는다.` 로.

그리고 `출력 규칙:` 바로 아래에 한 줄을 새로 넣는다:

```markdown
출력 규칙:
- 길이 상한은 요청이 아니라 제약이다. summary 5문장, items 7개, project_notes의 action 각 1문장을 넘기면
  응답이 중간에서 잘려 브리핑 전체가 실패로 기록된다. 넘칠 것 같으면 덜 급한 것을 빼지, 줄여 쓰지 않는다.
```

- [ ] **Step 3: 타입·린트를 돌린다**

Run: `npm run typecheck && npm run lint`
Expected: 둘 다 통과 (이 Task는 상수 하나와 마크다운만 건드린다)

- [ ] **Step 4: dummy 모드에서 수동 실행 흐름을 먼저 본다**

Run: `npm run dev` (별도 터미널, `.env.local`의 `NEXT_PUBLIC_DATA_MODE=dummy` 확인)
브라우저에서 `/ai` → Chairman으로 로그인 → **수동 실행** 버튼.

Expected: `ANTHROPIC_API_KEY`가 있으면 그룹 브리핑 행이 `Done`으로 남고, 없으면 회사마다 `Failed`가 남는다. **둘 중 어느 쪽이든 `'출력이 max_tokens에서 잘렸다.'` 문구는 나오지 않아야 한다.**
dummy는 회사 데이터가 시드라 응답이 짧다 — 이 단계가 증명하는 것은 "흐름이 살아 있다"까지다. 실제 잘림 재현은 Step 5다.

- [ ] **Step 5: 실데이터로 수동 실행해 성공을 확인한다 — 회장 승인 후**

⚠️ **이 단계는 원격 쓰기다.** 실행자는 여기서 멈추고 회장에게 한 줄로 묻는다:
> "그룹 브리핑 수동 실행을 production 데이터로 한 번 돌립니다. `ai_night_outputs`에 실행 기록 1건이 쌓이고 Anthropic API 호출이 6회 발생합니다. 진행할까요?"

승인 후:

```bash
# .env.local(production)로 dev 서버를 띄운다. NEXT_PUBLIC_DATA_MODE=live
npm run dev
```

`/ai` → **수동 실행** → 결과 줄이 `기록 6건 · 완료 6 · 실패 0`이고, **그룹 브리핑** 카드에 summary·items·project_notes가 온전히 보이면 통과.
잘림이 다시 나면 멈추고 보고한다 — `max_tokens`를 또 올리는 것이 답이 아니다(프롬프트 상한이 안 먹은 것이다).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/ai/anthropic.ts src/lib/ai/prompts/daily-brief.md
git commit -m "$(cat <<'EOF'
fix(ai): 그룹 브리핑 max_tokens 잘림 — 한도 12000 + 프롬프트 길이 상한

회장 첫 사용에서 그룹 브리핑이 max_tokens=4000에서 잘려 실패했다.
한도만 올리면 회사가 늘었을 때 같은 자리에서 다시 잘리므로
daily-brief.md에 summary 5문장 · items 7개 · action 각 1문장을 못 박았다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 캘린더 날짜 팝업 편집

원 지시 2번. `/calendar`에서 날짜를 누르면 그 날의 항목 목록과 "추가"가 든 모달이 뜬다. 이벤트를 누르면 같은 모달에서 수정·삭제한다. 페이지 이동은 없다.

**설계 판단 두 가지**

1. **`confirm()`을 쓰지 않는다.** 브라우저 모달 다이얼로그는 자동화 도구를 멈추게 하고(스크린샷 단계가 여기서 막힌다), 화면 안의 확인 상태가 "확인 한 번"이라는 요구를 똑같이 만족한다. 지우기 버튼을 누르면 그 줄이 `지운다 / 취소` 두 버튼으로 바뀐다.
2. **모달은 `ChairmanEvent`를 받는다, `CalendarItem`이 아니다.** `calendar_items` 뷰의 한 줄에는 `kind`(Trip/Meeting/…)도 `location`도 없다. 수정하려면 원본 행이 필요하다. 그래서 캘린더 페이지가 `repo.listEvents()`를 하나 더 읽는다.
3. **이벤트가 아닌 항목(다음 행동·마일스톤·결재 마감)은 모달에서 고치지 않는다.** 원본이 다른 표다. 모달에서는 기존 `href`로 가는 링크로 남는다.

**Files:**
- Create: `src/components/calendar/day-modal.tsx`
- Create: `src/components/calendar/month-grid-client.tsx`
- Modify: `src/components/calendar/month-grid.tsx` (표시 규칙을 export해 클라이언트가 같이 쓴다)
- Modify: `src/app/(dashboard)/calendar/page.tsx`

**Interfaces:**
- Consumes: `saveEventAction` / `removeEventAction` (`src/app/actions/initiatives.ts` — 시그니처 그대로. `removeEventAction(eventId, initiativeId?)`), `occursOn(item, day)` (`src/lib/calendar.ts`), `ChairmanEvent` · `CalendarItem` (`src/types`)
- Produces:
  - `KIND_MARK: Record<CalendarItemKind, string>` (month-grid.tsx에서 export)
  - `isPastRisk(item: CalendarItem, today: IsoDate): boolean` (month-grid.tsx에서 export)
  - `<MonthGridClient grid={IsoDate[][]} items={CalendarItem[]} events={ChairmanEvent[]} month={string} today={IsoDate} canEdit={boolean} />`
  - `<DayModal day={IsoDate} items={CalendarItem[]} events={ChairmanEvent[]} canEdit={boolean} onClose={() => void} />`

- [ ] **Step 1: `month-grid.tsx`의 표시 규칙을 export한다**

클라이언트가 같은 규칙으로 그려야 한다. 두 줄에 `export`를 붙이는 것이 전부다 — 로직을 복사하면 달력의 두 경로가 서로 다른 말을 하게 된다.

```ts
/** 종류는 색이 아니라 모양으로 가른다 — 넷을 다 칠하면 무엇이 급한지 안 보인다. */
export const KIND_MARK: Record<CalendarItemKind, string> = {
```

```ts
/** 색이 오르는 유일한 경우: 지난(오늘보다 이전) next_action·decision. 지나간 이벤트는 위험이 아니다. */
export function isPastRisk(item: CalendarItem, today: IsoDate): boolean {
```

`MonthGrid` 자체는 그대로 둔다 — 지우지 않는다. 클라이언트 껍데기가 못 뜨는 상황(JS 실패)에서 읽을 것이 남아야 하고, 무엇보다 diff가 작아진다.

- [ ] **Step 2: `day-modal.tsx`를 쓴다**

Create `src/components/calendar/day-modal.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { removeEventAction, saveEventAction } from '@/app/actions/initiatives'
import { Icon } from '@/components/ui/icon'
import {
  CALENDAR_ITEM_LABEL_KO, EVENT_KIND, EVENT_KIND_LABEL_KO,
  type CalendarItem, type ChairmanEvent, type EventKind, type IsoDate,
} from '@/types'

/**
 * 캘린더 날짜 팝업 (Phase 4-A 다듬기 2번).
 *
 * 한 날짜에 걸리는 것 전부를 보여 주고, 그중 **이벤트만** 이 자리에서 고친다.
 * 다음 행동·마일스톤·결재 마감은 원본이 다른 표다 — 링크로 보낸다.
 *
 * 삭제 확인에 window.confirm을 쓰지 않는다. 브라우저 모달은 이 다이얼로그 위에 또 하나를
 * 띄워 포커스 관리를 두 번 하게 만들고, 자동화(스크린샷)를 멈춘다. 지우기를 누르면
 * 그 줄이 '지운다 / 취소'로 바뀐다 — 확인은 똑같이 한 번이다.
 *
 * 저장·삭제는 event-panel.tsx와 같은 Server Action을 부른다. 그쪽이 revalidatePath로
 * /calendar를 다시 그리므로, 이 컴포넌트는 낙관적 목록(list)만 들고 있다가 닫으면 된다.
 */

interface Draft {
  eventId?: string
  title: string
  kind: EventKind
  startsOn: string
  endsOn: string
  location: string
}

function emptyDraft(day: IsoDate): Draft {
  // 새 일정의 시작일은 누른 날짜다. 비워 두면 회장이 달력에서 날짜를 골라 놓고 또 고른다.
  return { title: '', kind: 'Meeting', startsOn: day, endsOn: '', location: '' }
}

function draftOf(e: ChairmanEvent): Draft {
  return {
    eventId: e.event_id,
    title: e.title,
    kind: e.kind,
    startsOn: e.starts_on,
    endsOn: e.ends_on ?? '',
    location: e.location,
  }
}

export function DayModal({
  day,
  items,
  events,
  canEdit,
  onClose,
}: {
  day: IsoDate
  /** 이 날에 걸리는 calendar_items 전부 (호출자가 occursOn으로 이미 걸렀다) */
  items: CalendarItem[]
  /** 이 날에 걸리는 events 원본 (수정 대상) */
  events: ChairmanEvent[]
  canEdit: boolean
  onClose: () => void
}) {
  const [list, setList] = useState(events)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // 열리면 포커스를 안으로 들인다. 안 하면 Tab이 뒤의 달력을 훑는다.
  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 이벤트가 아닌 항목만 링크로 남긴다. 이벤트는 아래 목록에서 고친다.
  const others = items.filter((it) => it.kind !== 'event')

  async function submit() {
    if (!draft || busy) return
    setBusy(true)
    setError(null)
    const result = await saveEventAction({
      event_id: draft.eventId,
      title: draft.title,
      kind: draft.kind,
      starts_on: draft.startsOn,
      ends_on: draft.endsOn,
      location: draft.location,
    })
    setBusy(false)
    if (result.error || !result.saved) {
      setError(result.error ?? '저장하지 못했습니다.')
      return
    }
    const saved = result.saved
    setList((l) => [...l.filter((e) => e.event_id !== saved.event_id), saved])
    setDraft(null)
  }

  async function remove(e: ChairmanEvent) {
    if (busy) return
    setBusy(true)
    setError(null)
    // 두 번째 인자는 이 이벤트가 걸린 이니셔티브다. 안 넘기면 그 상세 화면이 갱신되지 않는다.
    const result = await removeEventAction(e.event_id, e.initiative_id ?? undefined)
    setBusy(false)
    setConfirming(null)
    if (result.error) {
      setError(result.error)
      return
    }
    setList((l) => l.filter((x) => x.event_id !== e.event_id))
  }

  const sorted = [...list].sort((a, b) => a.starts_on.localeCompare(b.starts_on))
  const [, m, d] = day.split('-')

  return (
    // 바깥을 누르면 닫힌다. 안쪽 클릭이 올라와 닫히지 않게 stopPropagation을 건다.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${Number(m)}월 ${Number(d)}일 일정`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-line bg-panel p-4 shadow-xl outline-none"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold tnum">
            {Number(m)}월 {Number(d)}일
            <span className="ml-2 text-[11px] font-normal text-ink-muted">
              {items.length}건
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded px-1.5 py-0.5 text-[12px] text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
            {error}
          </p>
        ) : null}

        {/* 이벤트 — 이 자리에서 고친다 */}
        <ul className="mt-3 divide-y divide-line-soft">
          {sorted.map((e) => (
            <li key={e.event_id} className="py-2">
              {draft?.eventId === e.event_id ? (
                <EventForm
                  draft={draft}
                  setDraft={setDraft}
                  onSubmit={submit}
                  onCancel={() => setDraft(null)}
                  busy={busy}
                />
              ) : confirming === e.event_id ? (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-dim">
                    «{e.title}» 을(를) 지웁니다.
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(e)}
                    disabled={busy}
                    className="shrink-0 rounded bg-critical px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
                  >
                    {busy ? '지우는 중…' : '지운다'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={busy}
                    className="shrink-0 rounded px-2 py-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!canEdit) return
                      setError(null)
                      setDraft(draftOf(e))
                    }}
                    disabled={!canEdit}
                    aria-label={canEdit ? `${e.title} 고치기` : undefined}
                    className="min-w-0 flex-1 rounded px-1 py-0.5 text-left transition-colors enabled:hover:bg-raised"
                  >
                    <p className="truncate text-[12.5px] font-semibold">
                      {e.title}
                      <span className="ml-1.5 text-[11px] font-normal text-ink-muted">
                        {EVENT_KIND_LABEL_KO[e.kind]}
                      </span>
                    </p>
                    {e.location ? (
                      <p className="truncate text-[11px] text-ink-muted">{e.location}</p>
                    ) : null}
                  </button>
                  <span className="shrink-0 text-[11px] text-ink-dim tnum">
                    {e.ends_on && e.ends_on !== e.starts_on ? `${e.starts_on} ~ ${e.ends_on}` : ''}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setConfirming(e.event_id)}
                      aria-label={`${e.title} 지우기`}
                      className="shrink-0 rounded px-1 text-[11px] text-ink-muted hover:text-critical"
                    >
                      삭제
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>

        {/* 이벤트가 아닌 것 — 원본이 다른 표다. 링크로 보낸다 */}
        {others.length > 0 ? (
          <ul className="mt-2 space-y-1 border-t border-line-soft pt-2">
            {others.map((it) => (
              <li key={`${it.kind}-${it.source_id}`}>
                <Link
                  href={it.href}
                  className="block truncate text-[11.5px] text-ink-dim hover:text-ink hover:underline"
                >
                  <span className="text-ink-muted">{CALENDAR_ITEM_LABEL_KO[it.kind]}</span> · {it.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {sorted.length === 0 && others.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-ink-muted">이 날에는 아무것도 없습니다.</p>
        ) : null}

        {/* 새 일정 */}
        {canEdit && draft && !draft.eventId ? (
          <div className="mt-3 rounded-lg bg-raised/60 p-2.5">
            <EventForm
              draft={draft}
              setDraft={setDraft}
              onSubmit={submit}
              onCancel={() => setDraft(null)}
              busy={busy}
            />
          </div>
        ) : null}

        {canEdit && !draft ? (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setConfirming(null)
              setDraft(emptyDraft(day))
            }}
            className="mt-3 flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            <Icon name="plus" className="size-3" />
            추가
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** 추가와 수정이 같은 폼이다 — draft.eventId 유무로만 갈린다. */
function EventForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  busy,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
}) {
  const field =
    'mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-normal text-ink outline-none placeholder:text-ink-muted focus:border-accent'
  const label = 'block text-[10px] font-semibold tracking-[0.08em] text-ink-muted'

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className={`${label} sm:col-span-2`}>
        제목
        <input
          autoFocus
          value={draft.title}
          maxLength={500}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className={field}
        />
      </label>
      <label className={label}>
        종류
        <select
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as EventKind })}
          className={field}
        >
          {EVENT_KIND.map((k) => (
            <option key={k} value={k}>
              {EVENT_KIND_LABEL_KO[k]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        장소
        <input
          value={draft.location}
          maxLength={300}
          onChange={(e) => setDraft({ ...draft, location: e.target.value })}
          className={field}
        />
      </label>
      <label className={label}>
        시작일
        <input
          type="date"
          value={draft.startsOn}
          onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
          className={field}
        />
      </label>
      <label className={label}>
        종료일
        <input
          type="date"
          value={draft.endsOn}
          onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
          className={field}
        />
      </label>
      <div className="flex items-center gap-1.5 sm:col-span-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded px-2 py-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
        >
          취소
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `month-grid-client.tsx`를 쓴다**

Create `src/components/calendar/month-grid-client.tsx`:

```tsx
'use client'

import { useState } from 'react'

import { DayModal } from '@/components/calendar/day-modal'
import { KIND_MARK, isPastRisk } from '@/components/calendar/month-grid'
import { occursOn } from '@/lib/calendar'
import { CALENDAR_ITEM_LABEL_KO, type CalendarItem, type ChairmanEvent, type IsoDate } from '@/types'

const WEEKDAY_KO = ['월', '화', '수', '목', '금', '토', '일']
const MAX_PER_CELL = 3

/**
 * 달력 격자의 클라이언트판 (Phase 4-A 다듬기 2번).
 *
 * 서버판 MonthGrid와 그리는 규칙이 같다 — KIND_MARK와 isPastRisk를 그 파일에서 가져온다.
 * 복사하면 두 격자가 서로 다른 날을 빨갛게 칠하는 날이 온다.
 *
 * 달라진 것은 하나다: 칸이 <div>가 아니라 <button>이고, 누르면 DayModal이 뜬다.
 * 칸 안의 항목은 이제 <Link>가 아니다 — 링크를 남기면 항목을 누를 때는 페이지가 넘어가고
 * 여백을 누를 때만 모달이 떠서, 같은 칸이 두 가지로 동작한다. 항목 링크는 모달 안에 있다.
 */
export function MonthGridClient({
  grid,
  items,
  events,
  month,
  today,
  canEdit,
}: {
  grid: IsoDate[][]
  items: CalendarItem[]
  events: ChairmanEvent[]
  month: string
  today: IsoDate
  canEdit: boolean
}) {
  const [open, setOpen] = useState<IsoDate | null>(null)

  const dayItems = (day: IsoDate) => items.filter((it) => occursOn(it, day))
  // events에는 ends_on이 null인 하루짜리가 있다. calendar_items와 같은 기준으로 센다.
  const dayEvents = (day: IsoDate) =>
    events.filter((e) => e.starts_on <= day && day <= (e.ends_on ?? e.starts_on))

  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-ink-muted">
        {WEEKDAY_KO.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.flat().map((day) => {
          const all = dayItems(day)
          const shown = all.slice(0, MAX_PER_CELL)
          const overflow = all.length - shown.length
          const inMonth = day.slice(0, 7) === month
          const isToday = day === today

          return (
            <button
              key={day}
              type="button"
              onClick={() => setOpen(day)}
              aria-label={`${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일, ${all.length}건`}
              className={[
                'min-h-[92px] rounded-md border p-1.5 text-left transition-colors hover:border-accent',
                isToday ? 'border-2 border-ink' : 'border-line-soft',
              ].join(' ')}
            >
              {/* opacity는 이 컨테이너가 아니라 안쪽 무채색 요소에만 건다 — 컨테이너에 걸면
                  그 안의 text-critical까지 40%로 죽어 가장 위험한 칸에서 신호가 가장 약해진다. */}
              <div
                className={[
                  'text-[11px] tnum',
                  isToday ? 'font-bold text-ink' : 'text-ink-dim',
                  inMonth ? '' : 'opacity-40',
                ].join(' ')}
              >
                {Number(day.slice(8, 10))}
              </div>

              <div className="mt-1 space-y-0.5">
                {shown.map((it) => {
                  const risk = isPastRisk(it, today)
                  return (
                    <span
                      key={`${it.kind}-${it.source_id}-${day}`}
                      title={CALENDAR_ITEM_LABEL_KO[it.kind]}
                      className={[
                        'flex items-center gap-1 truncate text-[10.5px] leading-tight',
                        risk ? 'text-critical' : 'text-ink-dim',
                        !risk && !inMonth ? 'opacity-40' : '',
                      ].join(' ')}
                    >
                      <span aria-hidden className="shrink-0">
                        {KIND_MARK[it.kind]}
                      </span>
                      <span className="truncate">{it.title}</span>
                    </span>
                  )
                })}
                {overflow > 0 ? (
                  <div className={['text-[10px] text-ink-muted', inMonth ? '' : 'opacity-40'].join(' ')}>
                    +{overflow}
                  </div>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>

      {open ? (
        <DayModal
          day={open}
          items={dayItems(open)}
          events={dayEvents(open)}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: 캘린더 페이지가 events와 역할을 같이 읽게 한다**

`src/app/(dashboard)/calendar/page.tsx`:

import 줄을 고친다:

```ts
import { MonthGridClient } from '@/components/calendar/month-grid-client'
import { TwoWeekList } from '@/components/calendar/two-week-list'
import { PageHeader } from '@/components/layout/page-header'
import { currentUser } from '@/lib/auth/session'
```

(`import { MonthGrid } ...` 줄을 지운다.)

데이터 읽는 부분:

```ts
  const repo = await getRepository()
  // 이벤트 원본을 같이 읽는다. calendar_items 뷰에는 kind(Trip/Meeting/…)도 location도 없어
  // 모달에서 고칠 수가 없다. 전건이라 한 번 더 읽어도 수십 행이다.
  const [items, events, user] = await Promise.all([
    repo.listCalendarItems(from, to),
    repo.listEvents(),
    currentUser(),
  ])
  const canEdit = user?.role === 'Chairman' || user?.role === 'GroupCFO'
```

설명 주석에 한 줄을 더한다 (파일 상단 JSDoc `* 주소창의 month 값은...` 아래):

```
 * 날짜 칸을 누르면 그 날의 팝업이 뜬다(다듬기 2번). 칸이 <button>이라 격자 자체는
 * 클라이언트 컴포넌트다 — 질의와 범위 계산은 그대로 서버에 남는다.
```

그리고 렌더링:

```tsx
        <MonthGridClient
          grid={grid}
          items={items}
          events={events}
          month={month}
          today={today}
          canEdit={canEdit}
        />
```

- [ ] **Step 5: 타입·린트·빌드**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 전부 통과.
자주 걸리는 것: `month-grid.tsx`에서 `export`를 빼먹으면 `KIND_MARK` import가 깨진다. `MonthGrid`가 더 이상 쓰이지 않아 lint가 unused를 낼 수 있는데, **export된 컴포넌트라 unused가 아니다** — 그대로 둔다.

- [ ] **Step 6: dummy 모드에서 직접 눌러 본다**

Run: `npm run dev` (dummy)
1. `/initiatives`에서 건 하나를 만들고 상세에서 일정 2건을 넣는다 (dummy는 시드가 비어 있다).
2. `/calendar`로 가서 그 날짜 칸을 누른다 → 모달이 뜨고 2건이 보인다.
3. 이벤트를 누른다 → 같은 모달 안에서 폼이 열린다. 제목을 고치고 저장 → 목록이 바뀐다. **주소가 안 바뀐다.**
4. 삭제를 누른다 → `지운다 / 취소`가 뜬다. 취소 → 그대로. 다시 삭제 → 지운다 → 사라진다.
5. **추가** → 시작일이 누른 날짜로 채워져 있다. 저장 → 목록에 붙는다.
6. Esc / 바깥 클릭 / ✕ 셋 다 닫는다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/calendar/ "src/app/(dashboard)/calendar/page.tsx"
git commit -m "$(cat <<'EOF'
feat(calendar): 날짜 클릭 팝업에서 일정 추가·수정·삭제

날짜 칸을 버튼으로 바꾸고 그 날의 항목을 모달에 모았다. 이벤트는 모달 안에서
고치고 지운다(페이지 이동 없음). 이벤트가 아닌 항목은 원본이 다른 표라 링크로 남긴다.

삭제 확인에 window.confirm을 쓰지 않았다 — 다이얼로그 위의 다이얼로그다.
지우기를 누르면 그 줄이 '지운다 / 취소'로 바뀐다. 확인은 한 번이다.
audit_log는 removeEvent가 이미 before 전체 + after:null로 남긴다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 아침 루틴 2단 레이아웃

원 지시 3번. `/ai`를 좌우 2단으로. 왼쪽 = D-day 카운터 + 선언문, 오른쪽 = 오늘·이번 주 + AI 브리핑. 1024px 이하는 세로. 왼쪽은 sticky.

**설계 판단 두 가지**

1. **`lg:`가 아니라 `min-[1025px]:`를 쓴다.** Tailwind의 `lg`는 `min-width: 1024px`라, 정확히 1024px에서 2단이 된다. 지시는 "1024px **이하**에서는 세로"다. 1px 때문에 커스텀 변형을 쓰는 것이 과해 보이지만, 이 화면은 회장이 매일 아침 여는 유일한 화면이고 지시가 숫자를 명시했다.
2. **sticky 왼쪽 칸에 `max-h` + `overflow-y-auto`를 같이 준다.** 선언문은 전문이라 뷰포트보다 길 수 있다. `sticky`만 주면 칸이 뷰포트보다 클 때 그냥 같이 스크롤되어 고정이 안 된다.

**Files:**
- Modify: `src/app/(dashboard)/ai/page.tsx:77-168`

**Interfaces:**
- Consumes: `ProjectCounters` · `Manifesto` · `TodayAndWeek` · `RunNightBrief` (전부 기존 시그니처 그대로)
- Produces: 없음

- [ ] **Step 1: 상단 JSDoc의 순서 설명을 고친다**

지금 주석은 "위에서 아래로 읽는 순서 그대로 놓는다"고 말한다. 더 이상 사실이 아니다.

```
/**
 * /ai — 회장의 아침 루틴 (Phase 3-B, 다듬기 3번에서 2단으로).
 *
 * 좌우 2단이다. 왼쪽은 **바뀌지 않는 것**(장기 프로젝트 D-day, 선언문)이고
 * 오른쪽은 **오늘 바뀐 것**(오늘·이번 주, 야간 브리핑)이다. 왼쪽은 스크롤해도 따라온다 —
 * 오른쪽의 브리핑을 읽는 내내 D-day와 선언문이 눈에 남아 있어야 우선순위가 그 기준으로 매겨진다.
 *
 * 1024px 이하에서는 한 줄로 쌓인다(min-[1025px]). 그때의 순서는 예전과 같다:
 * 카운터 → 선언문 → 오늘·이번 주 → 브리핑.
 *
 * 야간 브리핑 전문 (Phase 3-A 블록 4, CH-019의 전체 화면).
 * ... (아래 기존 설명 그대로 유지)
 */
```

- [ ] **Step 2: 반환 JSX를 2단으로 바꾼다**

`return (` 이후 `<PageHeader>...</PageHeader>` 까지는 그대로 두고, 그 **다음**부터 끝까지를 아래로 교체한다.

```tsx
      <div className="mt-4 grid gap-6 min-[1025px]:grid-cols-[minmax(0,380px)_minmax(0,1fr)] min-[1025px]:gap-8">
        {/* 왼쪽 — 바뀌지 않는 것. 스크롤해도 따라온다.
            max-h와 overflow를 같이 준다: 선언문 전문이 뷰포트보다 길면 sticky만으로는
            칸이 통째로 스크롤을 타 고정이 풀린다. */}
        <div className="min-[1025px]:sticky min-[1025px]:top-4 min-[1025px]:max-h-[calc(100vh-2rem)] min-[1025px]:self-start min-[1025px]:overflow-y-auto min-[1025px]:pr-2">
          {activeProjects.length > 0 ? <ProjectCounters projects={activeProjects} today={today} /> : null}

          {manifesto.body ? (
            <div className={activeProjects.length > 0 ? 'mt-6' : ''}>
              <Manifesto body={manifesto.body} />
            </div>
          ) : null}

          {isChairman && activeProjects.length === 0 && !manifesto.body ? (
            <p className="rounded-xl border border-dashed border-line bg-panel/60 p-4 text-[12px] text-ink-muted">
              아직 장기 프로젝트와 선언문이 없습니다.{' '}
              <Link href="/settings/chairman" className="text-accent underline-offset-2 hover:underline">
                회장 루틴 설정
              </Link>
              에서 넣으면 이 칸 맨 위에 올라옵니다.
            </p>
          ) : null}
        </div>

        {/* 오른쪽 — 오늘 바뀐 것 */}
        <div className="min-w-0">
          <TodayAndWeek
            todayItems={todayItems}
            upcoming={upcomingInitiatives}
            stale={staleInitiatives}
            today={today}
          />

          <h2 className="mt-8 flex items-center gap-1.5 text-[13px] font-semibold">
            <Icon name="sparkles" className="size-4 text-ink-dim" />
            AI 브리핑
          </h2>

          {dates.length === 0 ? (
            <p className="mt-6 rounded-xl border border-line-soft bg-panel p-6 text-[12.5px] text-ink-muted">
              아직 브리핑이 없습니다. 첫 Cron은 오늘 23:00(KST)에 돕니다.
            </p>
          ) : (
            <div className="mt-2.5 pb-6">
              {/* 2단 안에서는 날짜 목록을 세로로 세울 폭이 없다. 가로 한 줄로 둔다. */}
              <nav aria-label="브리핑 날짜" className="mb-3">
                <ul className="flex gap-1 overflow-x-auto">
                  {dates.map((d) => (
                    <li key={d}>
                      <Link
                        href={`/ai?date=${d}`}
                        aria-current={d === date ? 'page' : undefined}
                        className={`block rounded-lg px-3 py-2 text-[12.5px] whitespace-nowrap tnum transition-colors ${
                          d === date
                            ? 'bg-panel font-semibold text-ink'
                            : 'text-ink-muted hover:bg-panel/60 hover:text-ink-dim'
                        }`}
                      >
                        {d}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              <div className="space-y-6">
                {shown.map((run, i) => (
                  <RunSection
                    key={run.run_id ?? `legacy-${run.date}`}
                    run={run}
                    businesses={businesses}
                    anchors={i === 0}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

주의: `TodayAndWeek`는 자기 안에 `mt-8 ... border-b ... pb-10`을 들고 있다. 2단에서 위쪽 여백이 과하면 그 컴포넌트의 `mt-8`을 `mt-0`으로 바꾸지 말고, 여기서 감싸는 `<div>`에 조정하지도 말고 **그대로 둔다** — 세로 배치(1024px 이하)에서는 그 여백이 맞다. 2단에서만 어색하면 `TodayAndWeek`의 최상위 className을 `mt-8 min-[1025px]:mt-0`으로 고친다.

- [ ] **Step 3: 타입·린트·빌드**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 통과. `Manifesto`의 `mx-auto max-w-[720px]`가 380px 칸 안에서는 그냥 꽉 찬다 — 정상이다.

- [ ] **Step 4: 폭을 바꿔 가며 본다**

Run: `npm run dev` (dummy). Chairman으로 로그인.
1. `/settings/chairman`에서 장기 프로젝트 1건과 선언문 몇 문단을 넣는다 (dummy는 비어 있다).
2. `/ai` — 1440px: 왼쪽에 카운터+선언문, 오른쪽에 오늘·이번 주 + 브리핑.
3. 오른쪽을 스크롤한다 → 왼쪽이 따라온다.
4. 선언문을 뷰포트보다 길게 넣어 본다 → 왼쪽 칸 **안에서** 스크롤되고 칸 자체는 고정.
5. 브라우저 폭을 1024px로 줄인다 → **세로로 쌓인다.** 1025px에서 2단.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(dashboard)/ai/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ai): 아침 루틴 2단 — 왼쪽 D-day·선언문 고정, 오른쪽 오늘·브리핑

왼쪽은 바뀌지 않는 것(장기 프로젝트 D-day, 선언문), 오른쪽은 오늘 바뀐 것
(오늘·이번 주, 야간 브리핑)이다. 브리핑을 읽는 내내 D-day가 눈에 남는다.

1024px 이하는 세로로 쌓인다(min-[1025px] — Tailwind lg는 1024를 포함해 지시와 1px 어긋난다).
sticky에 max-h/overflow를 같이 줬다. 선언문 전문이 뷰포트보다 길면 sticky만으로는 고정이 풀린다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 0018 마이그레이션 — `logo_url` + 비공개 버킷

원 지시 4-a의 DB 쪽. 이 Task 하나가 통째로 끝나야 다음 Task가 시작된다 — 스키마가 코드보다 먼저다(OPERATIONS §9, 0015·0016과 같다).

**Files:**
- Create: `supabase/migrations/0018_initiative_logos.sql`
- Modify: `scripts/check-migrations.ts` (SUPABASE_STUBS + 새 단언)

**Interfaces:**
- Produces:
  - `initiatives.logo_url text` — null 허용. **버킷 내 객체 경로**이지 URL이 아니다
  - Storage 버킷 id `initiative-logos`, `public = false`
  - 정책 `initiative_logos_read` · `initiative_logos_write` on `storage.objects`

- [ ] **Step 1: 마이그레이션을 쓴다**

Create `supabase/migrations/0018_initiative_logos.sql`:

```sql
-- =====================================================================
-- Chairman OS — 0018_initiative_logos
-- 출처: Phase 4-A 다듬기 4-a (회장 첫 사용 피드백, 2026-09-19)
--
-- 무엇이 없어서 만드나
--   이니셔티브가 열네 건을 넘어가면 제목만으로는 목록에서 건을 못 찾는다. 회장이 아는 것은
--   상대 회사의 로고다. 카드 그리드(다듬기 4-b)의 왼쪽 자리가 그것을 위한 칸이다.
--
-- 왜 Storage인가 — CLAUDE.md는 '링크만 보관한다'고 했는데
--   그 원칙은 Vault 문서(계약서·실사 자료)의 **파일 실체**에 대한 것이다. 사내 스토리지에
--   두고 Chairman OS는 링크만 든다. 로고는 Vault 문서가 아니다 — 수십 KB짜리 상표 이미지고,
--   사내 스토리지에 올려 링크를 손으로 붙여 넣으라고 하면 회장이 로고를 넣지 않는다.
--   그 대신 비공개 버킷 + RLS로 가둔다. 판단이 바뀌면 이 마이그레이션 하나만 되돌린다.
--
-- 왜 비공개인가
--   어느 회사 로고가 여기 있는지가 곧 '회장이 지금 누구와 협상 중인가'다. 0017이 시드를
--   git에 안 넣은 것과 같은 이유다. 공개 버킷은 경로만 알면 로그인 없이 열린다.
--   화면은 볼 때마다 요청자 세션으로 서명 URL을 발급해 쓴다(만료 1시간).
--
-- 권한
--   Chairman · GroupCFO   읽기 · 쓰기
--   AIAgent               없음 — 0017의 다른 표와 다르다. 야간 브리핑은 이미지를 그리지 않는다.
--   그 외 역할             없음
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 로고 경로 칸
--    이름은 logo_url이지만 들어가는 값은 'ini_001/logo' 꼴의 **버킷 내 객체 경로**다.
--    비공개 버킷이라 영구 URL이라는 것이 없다. 칸 이름을 documents.storage_url과 맞췄다.
--    한 건에 객체 하나다(경로가 id로 정해진다) — 다시 올리면 덮어쓰고 고아 객체가 안 생긴다.
-- ---------------------------------------------------------------------
alter table initiatives
  add column if not exists logo_url text;                     -- [일반] null = 로고 없음

comment on column initiatives.logo_url is
  'initiative-logos 버킷 안의 객체 경로(ini_001/logo). 공개 URL이 아니다 — 비공개 버킷이라 볼 때마다 서명 URL을 발급한다. null이면 제목 첫 글자 배지로 떨어진다.';

-- ---------------------------------------------------------------------
-- 2. 비공개 버킷
--    이미 있으면 건드리지 않는다. public을 true로 되돌리지도 않는다 —
--    누가 콘솔에서 공개로 바꿔 뒀다면 그건 사람이 내린 결정이고, 이 파일이
--    조용히 뒤집으면 왜 바뀌었는지 아무도 모른다. 대신 아래 do 블록이 소리를 낸다.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('initiative-logos', 'initiative-logos', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'initiative-logos' and public) then
    raise warning 'initiative-logos 버킷이 공개로 설정되어 있다. 0018의 전제가 깨진다 — 콘솔에서 비공개로 되돌린다.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. 정책
--    bucket_id로 범위를 끊는다. storage.objects에는 다른 버킷의 정책도 함께 산다 —
--    permissive라 이 두 줄은 이 버킷에만 권한을 **더한다**.
--
--    읽기에 can_read_initiatives()가 아니라 can_write_initiatives()를 쓴다.
--    저쪽에는 AIAgent가 들어 있는데 야간 브리핑은 이미지를 읽지 않는다.
--    원 지시도 'Chairman·GroupCFO만 읽기/쓰기'다.
-- ---------------------------------------------------------------------
create policy initiative_logos_read on storage.objects for select
  using (bucket_id = 'initiative-logos' and can_write_initiatives());

create policy initiative_logos_write on storage.objects for all
  using (bucket_id = 'initiative-logos' and can_write_initiatives())
  with check (bucket_id = 'initiative-logos' and can_write_initiatives());

commit;
```

- [ ] **Step 2: `check-migrations.ts`에 storage 스텁을 넣는다**

PGlite에는 `storage` 스키마가 없다. 0018이 통째로 실패한다. `auth`를 흉내 낸 것과 같은 방식으로 최소한만 세운다.

`scripts/check-migrations.ts`의 `SUPABASE_STUBS`:

```ts
const SUPABASE_STUBS = `
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon;
  create role authenticated;

  -- Supabase Storage 최소 흉내 (0018). 실제 storage 스키마에는 훨씬 많은 칸이 있지만
  -- 0018이 건드리는 것은 buckets 세 칸과 objects의 bucket_id뿐이다.
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`
```

- [ ] **Step 3: 역할별 단언을 더한다**

`scripts/check-migrations.ts`의 RLS 절, `integrationBlockedTables` 단언 **뒤**에 넣는다. `as(uid, sql)` 헬퍼와 `UID` 맵은 이미 그 파일에 있다 — 기존 이니셔티브 단언(227~275행)과 같은 모양으로 쓴다.

```ts
  // ── 0018 initiative-logos 버킷 ─────────────────────────────────────
  // 버킷이 비공개로 만들어졌는가. 공개면 경로만 알면 로그인 없이 열린다.
  assert.equal(
    (await db.query<{ public: boolean }>(
      `select public from storage.buckets where id = 'initiative-logos'`,
    )).rows[0]?.public,
    false,
    '0018: initiative-logos 버킷이 비공개가 아니다',
  )

  // Chairman·GroupCFO는 올린다.
  await as(UID.chairman, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_001/logo')`)
  await as(UID.cfo, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_002/logo')`)

  // Chairman은 읽는다.
  assert.equal(
    (await as(UID.chairman, `select count(*)::int as n from storage.objects where bucket_id = 'initiative-logos'`))
      .rows[0]?.n,
    2,
    '0018: Chairman이 로고를 못 읽는다',
  )

  // AIAgent는 못 읽고 못 쓴다 — 0017의 다른 표와 다른 점이다.
  assert.equal(
    (await as(UID.agent, `select count(*)::int as n from storage.objects where bucket_id = 'initiative-logos'`))
      .rows[0]?.n,
    0,
    '0018: AIAgent에게 로고가 보인다 (can_write_initiatives여야 한다)',
  )
  await assert.rejects(
    as(UID.agent, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_003/logo')`),
    '0018: AIAgent가 로고를 올릴 수 있다',
  )

  // Member(회사 담당자)는 존재 자체를 몰라야 한다.
  assert.equal(
    (await as(UID.member, `select count(*)::int as n from storage.objects where bucket_id = 'initiative-logos'`))
      .rows[0]?.n,
    0,
    '0018: Member에게 로고가 보인다',
  )
  await assert.rejects(
    as(UID.member, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_004/logo')`),
    '0018: Member가 로고를 올릴 수 있다',
  )
```

기존 단언의 `as(...)` 반환 모양(`.rows[0]`인지 다른 것인지)을 **먼저 227~275행에서 확인하고 그 모양에 맞춘다.** 위 코드는 `PGlite.query`의 `{ rows }` 형태를 가정한 것이다.

- [ ] **Step 4: 마이그레이션 검사를 돌린다**

Run: `npm run check:migrations`
Expected: 0001~0018 전부 적용되고 새 단언 6개가 통과.
실패하면: `gen_random_uuid()`가 없다는 오류면 스텁에서 `id uuid primary key default gen_random_uuid()`를 `id bigserial primary key`로 바꾼다 (0018은 id를 건드리지 않는다).

- [ ] **Step 5: 나머지 검사도 돌린다**

Run: `npm run check:db-safety && npm run check:boundaries && npm run check:finance && npm run typecheck && npm run lint`
Expected: 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/0018_initiative_logos.sql scripts/check-migrations.ts
git commit -m "$(cat <<'EOF'
feat(db): 0018 — initiatives.logo_url + initiative-logos 비공개 버킷

버킷은 비공개다. 어느 회사 로고가 있는지가 곧 '회장이 지금 누구와 협상 중인가'라,
0017이 시드를 git에 안 넣은 것과 같은 이유로 공개로 두지 않는다.
읽기·쓰기 모두 can_write_initiatives() — AIAgent는 뺐다. 야간 브리핑은 이미지를 안 그린다.

logo_url에 들어가는 값은 URL이 아니라 버킷 내 객체 경로다(주석에 명시).
check-migrations에 storage 스키마 스텁과 역할별 단언 6개를 더했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 로고 저장소 계약 + 두 어댑터 + Server Action

원 지시 4-a의 앱 쪽 배관. 화면은 아직 안 바뀐다 — 이 Task가 끝나면 Task 6이 UI만 붙인다.

**Files:**
- Create: `src/lib/initiative-logo.ts`
- Modify: `src/types/initiative.ts` (`Initiative.logo_url`)
- Modify: `src/lib/repository/types.ts` (계약 3개)
- Modify: `src/lib/repository/dummy.ts`
- Modify: `src/lib/repository/supabase.ts`
- Modify: `src/app/actions/initiatives.ts`

**Interfaces:**
- Produces:
  - `LOGO_BUCKET = 'initiative-logos'`
  - `LOGO_MAX_BYTES = 2_097_152`
  - `LOGO_MIME: readonly ['image/png', 'image/jpeg', 'image/webp']`
  - `logoPath(initiativeId: string): string` → `'ini_001/logo'`
  - `logoInitial(title: string): string` → 제목 첫 글자 1자
  - `repo.saveInitiativeLogo(initiativeId: string, file: LogoUpload, actor: AuditActor): Promise<string>` — 저장된 **경로**를 준다
  - `repo.removeInitiativeLogo(initiativeId: string, actor: AuditActor): Promise<void>`
  - `repo.signInitiativeLogos(paths: string[]): Promise<Record<string, string>>` — 경로 → 표시 가능한 URL. 발급 못 한 경로는 맵에 없다
  - `LogoUpload = { bytes: ArrayBuffer; contentType: string }`
  - `saveInitiativeLogoAction(formData: FormData): Promise<ActionState>`
  - `removeInitiativeLogoAction(initiativeId: unknown): Promise<ActionState>`

- [ ] **Step 1: 순수 규칙 파일**

Create `src/lib/initiative-logo.ts`:

```ts
/**
 * 이니셔티브 로고의 순수 규칙 (Phase 4-A 다듬기 4-a).
 *
 * 화면·Server Action·두 어댑터가 같은 상한과 같은 경로 규칙을 봐야 한다.
 * 세 곳에 따로 적으면 브라우저는 통과시키고 서버가 거절하는 조합이 생긴다.
 */

export const LOGO_BUCKET = 'initiative-logos'

/** 2MB. 상표 이미지는 수십 KB면 충분하다. 이 상한은 실수로 사진을 올리는 것을 잡는 자리다. */
export const LOGO_MAX_BYTES = 2_097_152

/**
 * SVG를 뺐다. <img>는 SVG 안의 스크립트를 실행하지 않지만, 서명 URL을 새 탭에서 열면
 * 같은 파일이 문서로 열린다. 로고에 SVG가 꼭 필요한 상황이 아니라 뺀다.
 */
export const LOGO_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const
export type LogoMime = (typeof LOGO_MIME)[number]

/**
 * 한 건에 객체 하나. 확장자를 붙이지 않는다 — 다시 올릴 때 PNG→JPG로 바뀌면
 * 경로가 달라져 옛 객체가 고아로 남는다. 서명 URL은 저장된 content-type으로 나간다.
 */
export function logoPath(initiativeId: string): string {
  return `${initiativeId}/logo`
}

/**
 * 로고가 없을 때의 원형 배지 글자. 제목 첫 글자 1자다.
 * 한글 음절·한자·라틴 알파벳 모두 한 글자로 떨어진다. 이모지는 서로게이트 쌍이라
 * [...title][0]으로 뽑는다 — title[0]을 쓰면 깨진 반쪽이 나온다.
 */
export function logoInitial(title: string): string {
  const first = [...title.trim()][0]
  return first ? first.toUpperCase() : '·'
}
```

- [ ] **Step 2: 타입과 계약**

`src/types/initiative.ts`의 `Initiative`에 한 칸:

```ts
  status: InitiativeStatus
  /** 0018 initiative-logos 버킷 안의 객체 경로. URL이 아니다 — 비공개 버킷이라 볼 때마다 서명한다. */
  logo_url: string | null
  updated_at: IsoDateTime
```

`src/lib/repository/types.ts` — `removeInitiativeDoc` 근처, 이니셔티브 블록 안에:

```ts
  /**
   * 로고를 올린다(0018 initiative-logos). 저장된 **경로**를 돌려준다 — URL이 아니다.
   * 어댑터가 initiatives.logo_url까지 같이 쓴다. 두 번 부르지 않게 한 메서드로 묶었다 —
   * 객체만 올라가고 칸이 안 바뀌면 화면에서 영영 안 보이는 고아 객체가 된다.
   */
  saveInitiativeLogo(initiativeId: string, file: LogoUpload, actor: AuditActor): Promise<string>
  /** 객체와 logo_url을 같이 비운다. */
  removeInitiativeLogo(initiativeId: string, actor: AuditActor): Promise<void>
  /**
   * 경로 → 화면에 걸 수 있는 URL. 목록 전체를 한 번에 넘긴다 — 카드마다 부르면
   * 14장짜리 그리드가 서명 요청 14번이 된다. 발급하지 못한 경로는 맵에 없다(없는 파일 등).
   */
  signInitiativeLogos(paths: string[]): Promise<Record<string, string>>
```

같은 파일 아래쪽, `EventInput` 근처:

```ts
/** 로고 업로드 한 건. File을 그대로 넘기지 않는다 — 어댑터가 브라우저 타입을 알 이유가 없다. */
export interface LogoUpload {
  bytes: ArrayBuffer
  contentType: string
}
```

`src/lib/repository/index.ts`의 `export type { ... }` 목록에 `LogoUpload`를 알파벳 순으로 넣는다.

- [ ] **Step 3: dummy 어댑터**

`src/lib/repository/dummy.ts`. 메모리 배열 선언부(96~101행) 옆에:

```ts
/**
 * 다듬기 4-a. dummy에는 Storage가 없다. 올라온 바이트를 data URL로 들고 있는다 —
 * 그래야 업로드→표시 전 흐름을 원격 Supabase 없이 검증할 수 있다(회장 확인 방식).
 * 키는 supabase 어댑터가 쓰는 것과 같은 경로다. 두 어댑터의 logo_url 값이 같은 모양이어야
 * 화면이 분기를 모른 채 돌아간다.
 */
const memoryLogos = new Map<string, string>()
```

`removeInitiativeDoc` 뒤에 세 메서드:

```ts
  async saveInitiativeLogo(initiativeId: string, file: LogoUpload, actor: AuditActor) {
    const target = memoryInitiatives.find((i) => i.initiative_id === initiativeId)
    if (!target) throw new Error('initiatives: 고칠 건이 없다.')
    const path = logoPath(initiativeId)
    const base64 = Buffer.from(file.bytes).toString('base64')
    memoryLogos.set(path, `data:${file.contentType};base64,${base64}`)
    target.logo_url = path
    target.updated_at = new Date().toISOString()
    if (actor.role !== 'Chairman' && actor.role !== 'GroupCFO') {
      console.warn(`[dummy] save initiative logo by ${actor.role} — 실제로는 0018 정책이 막는다.`)
    }
    return path
  },

  async removeInitiativeLogo(initiativeId: string, actor: AuditActor) {
    const target = memoryInitiatives.find((i) => i.initiative_id === initiativeId)
    if (!target) throw new Error('Dummy initiatives: mutation affected 0 rows.')
    memoryLogos.delete(logoPath(initiativeId))
    target.logo_url = null
    target.updated_at = new Date().toISOString()
    if (actor.role !== 'Chairman' && actor.role !== 'GroupCFO') {
      console.warn(`[dummy] remove initiative logo by ${actor.role} — 메모리에만 남는다.`)
    }
  },

  async signInitiativeLogos(paths: string[]) {
    // dummy의 '서명 URL'은 data URL 그 자체다. 만료가 없다.
    const out: Record<string, string> = {}
    for (const p of paths) {
      const url = memoryLogos.get(p)
      if (url) out[p] = url
    }
    return out
  },
```

같은 파일의 `saveInitiative`에서 새 건을 만들 때 `logo_url: null`이 빠지지 않게 한다 — `InitiativeInput`이 `Omit<Initiative, 'initiative_id' | 'updated_at'>`이라 타입이 잡아 준다. import에 `type LogoUpload`와 `logoPath`를 더한다.

- [ ] **Step 4: supabase 어댑터**

`src/lib/repository/supabase.ts`.

`INITIATIVE_COLUMNS`(438행)에 칸을 더한다:

```ts
const INITIATIVE_COLUMNS =
  'initiative_id,title,kind,business_id,stage,goal,target_date,' +
  'next_action,next_action_date,next_action_owner,blocker,status,logo_url,updated_at'
```

`removeInitiativeDoc` 뒤에:

```ts
    /**
     * 다듬기 4-a. 객체를 올리고 initiatives.logo_url까지 같이 쓴다.
     *
     * 순서: Storage 업로드 → audit_log → 칸 쓰기.
     * 이 파일의 하드 룰("감사가 쓰기보다 먼저")은 **DB 쓰기**에 대한 것이다. Storage 업로드를
     * 감사 뒤로 미루면 '올렸다는 기록은 남고 파일은 없는' 상태가 된다. 순서를 이렇게 두면
     * 최악이 '객체는 있는데 아무 건도 안 가리키는' 것인데, 경로가 건 id로 정해져 있어
     * 다음 업로드가 덮어쓴다. 고아가 쌓이지 않는다.
     *
     * upsert: true. 다시 올리면 덮어쓴다 — 경로가 하나라 그래야 한다.
     * 권한은 보지 않는다. 0018 initiative_logos_write가 Chairman·GroupCFO만 통과시킨다.
     */
    async saveInitiativeLogo(initiativeId: string, file: LogoUpload, actor: AuditActor): Promise<string> {
      const before = await this.getInitiative(initiativeId)
      if (!before) throw new Error('initiatives: 고칠 건이 없다. (없거나 볼 권한이 없다)')

      const path = logoPath(initiativeId)
      const { error: upErr } = await sb.storage.from(LOGO_BUCKET).upload(path, file.bytes, {
        contentType: file.contentType,
        upsert: true,
        // 같은 경로를 덮어쓰므로 오래 캐시하면 바꾼 로고가 한참 안 바뀐다.
        cacheControl: '60',
      })
      if (upErr) {
        throw new Error(
          `Supabase storage ${LOGO_BUCKET}: ${upErr.message} ` +
            '(0018 initiative_logos_write — Chairman·GroupCFO만 올린다)',
        )
      }

      if (before.logo_url !== path) {
        const { error: auditError } = await sb.from('audit_log').insert({
          actor_user_id: actor.user_id,
          actor_role: actor.role,
          action: 'update',
          entity_table: 'initiatives',
          entity_id: initiativeId,
          business_id: before.business_id,
          before: { logo_url: before.logo_url },
          after: { logo_url: path },
        })
        if (auditError) throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)

        const { error } = await sb
          .from('initiatives')
          .update({ logo_url: path })
          .eq('initiative_id', initiativeId)
        if (error) {
          throw new Error(
            `Supabase initiatives ${error.code ?? '?'}: ${error.message} ` +
              '(0017 initiatives_write — 로고는 올라갔고 칸이 안 바뀌었다)',
          )
        }
      }
      return path
    },

    async removeInitiativeLogo(initiativeId: string, actor: AuditActor): Promise<void> {
      const before = await this.getInitiative(initiativeId)
      if (!before) throw new Error('initiatives: 고칠 건이 없다.')
      if (!before.logo_url) return

      // 기록이 먼저다. 여기서부터는 DB 쓰기라 하드 룰이 그대로 적용된다.
      const { error: auditError } = await sb.from('audit_log').insert({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'update',
        entity_table: 'initiatives',
        entity_id: initiativeId,
        business_id: before.business_id,
        before: { logo_url: before.logo_url },
        after: { logo_url: null },
        note: '로고 삭제',
      })
      if (auditError) throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)

      const { error } = await sb
        .from('initiatives')
        .update({ logo_url: null })
        .eq('initiative_id', initiativeId)
      if (error) throw new Error(`Supabase initiatives ${error.code ?? '?'}: ${error.message}`)

      // 칸이 먼저 비워졌으니 객체 삭제가 실패해도 화면은 로고 없음으로 떨어진다.
      // 남은 객체는 다음 업로드가 같은 경로에 덮어쓴다 — 조용히 무시하지 말고 로그는 남긴다.
      const { error: rmErr } = await sb.storage.from(LOGO_BUCKET).remove([before.logo_url])
      if (rmErr) console.error('[initiative-logo] 객체 삭제 실패', before.logo_url, rmErr.message)
    },

    /**
     * 목록 전체를 한 번에 서명한다. 요청자 세션으로 발급하므로 0018 정책이 그대로 적용된다 —
     * 볼 권한이 없는 사람에게는 발급 자체가 실패하고 맵이 빈다.
     */
    async signInitiativeLogos(paths: string[]): Promise<Record<string, string>> {
      if (paths.length === 0) return {}
      const { data, error } = await sb.storage.from(LOGO_BUCKET).createSignedUrls(paths, 3600)
      if (error) {
        // 로고가 안 보이는 것이 화면 전체가 안 보이는 것보다 낫다. 던지지 않는다.
        console.error('[initiative-logo] 서명 실패', error.message)
        return {}
      }
      const out: Record<string, string> = {}
      for (const row of data ?? []) {
        if (row.signedUrl && row.path) out[row.path] = row.signedUrl
      }
      return out
    },
```

import에 `LOGO_BUCKET`, `logoPath`(`@/lib/initiative-logo`)와 `type LogoUpload`를 더한다.

- [ ] **Step 5: Server Action**

`src/app/actions/initiatives.ts` 맨 아래에:

```ts
/**
 * 로고 업로드 (다듬기 4-a). FormData로 받는다 — 파일은 Server Action의 직렬화를 태울 수 없다.
 *
 * 브라우저 <input accept>는 안내다. 상한(2MB)과 형식은 여기서 다시 본다 —
 * accept는 파일 선택창의 필터일 뿐 드래그·붙여넣기로 뚫린다.
 *
 * 권한은 보지 않는다. 0018 initiative_logos_write가 거부하면 failure()가 문구를 만든다.
 */
export async function saveInitiativeLogoAction(formData: FormData): Promise<ActionState> {
  const id = String(formData.get('initiative_id') ?? '').trim()
  if (!id) return { error: '어느 건인지 알 수 없습니다.' }

  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) return { error: '파일을 고르세요.' }
  if (file.size > LOGO_MAX_BYTES) {
    return { error: `2MB를 넘길 수 없습니다. (현재 ${(file.size / 1_048_576).toFixed(1)}MB)` }
  }
  if (!LOGO_MIME.includes(file.type as LogoMime)) {
    return { error: 'PNG · JPG · WebP만 올릴 수 있습니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.saveInitiativeLogo(
      id,
      { bytes: await file.arrayBuffer(), contentType: file.type },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    return failure(e)
  }

  revalidatePath('/initiatives')
  revalidatePath(`/initiatives/${id}`)
  return {}
}

export async function removeInitiativeLogoAction(initiativeId: unknown): Promise<ActionState> {
  const id = typeof initiativeId === 'string' ? initiativeId.trim() : ''
  if (!id) return { error: '어느 건인지 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.removeInitiativeLogo(id, { user_id: user.user_id, role: user.role })
  } catch (e) {
    return failure(e, 'delete')
  }

  revalidatePath('/initiatives')
  revalidatePath(`/initiatives/${id}`)
  return {}
}
```

파일 상단 import에:

```ts
import { LOGO_MAX_BYTES, LOGO_MIME, type LogoMime } from '@/lib/initiative-logo'
```

`failure()`의 정책 이름 정규식에 새 정책을 더한다 — 빠지면 로고 권한 거부가 '잠시 후 다시 시도'로 잘못 안내된다:

```ts
  const deniedByPolicy =
    /initiatives_write|initiative_docs_write|events_write|initiative_notes_all|initiative_logos_write|42501|PGRST301/.test(message)
```

그리고 `failure()` 위 JSDoc의 정책 목록에 `initiative_logos_write`를 더한다.

- [ ] **Step 6: 검사**

Run: `npm run typecheck && npm run lint && npm run build && npm run check:boundaries`
Expected: 통과. `check:boundaries`가 어댑터 두 개의 계약 일치를 보므로, 한쪽에만 메서드를 넣으면 여기서 걸린다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/initiative-logo.ts src/types/initiative.ts src/lib/repository/ src/app/actions/initiatives.ts
git commit -m "$(cat <<'EOF'
feat(initiatives): 로고 저장소 계약 + dummy·supabase 어댑터 + Server Action

saveInitiativeLogo는 객체 업로드와 logo_url 쓰기를 한 메서드로 묶었다. 나누면
객체만 올라가고 칸이 안 바뀌는 고아가 생긴다. 서명 URL은 목록 전체를 한 번에
발급한다(signInitiativeLogos) — 카드마다 부르면 14장 그리드가 14요청이 된다.

dummy는 data URL을 메모리에 든다. 업로드→표시를 원격 없이 검증하기 위해서다.
failure()의 정책 정규식에 initiative_logos_write를 더했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 로고 UI — 배지 · 업로드 패널

**Files:**
- Create: `src/components/initiatives/initiative-logo.tsx`
- Create: `src/components/initiatives/logo-upload.tsx`
- Modify: `src/app/(dashboard)/initiatives/[id]/page.tsx`

**Interfaces:**
- Consumes: `logoInitial` (`@/lib/initiative-logo`), `saveInitiativeLogoAction` · `removeInitiativeLogoAction`
- Produces:
  - `<InitiativeLogo title={string} src={string | undefined} size="sm" | "lg" />`
  - `<LogoUpload initiativeId={string} title={string} src={string | undefined} canEdit={boolean} />`

- [ ] **Step 1: 배지 컴포넌트**

Create `src/components/initiatives/initiative-logo.tsx`:

```tsx
import { logoInitial } from '@/lib/initiative-logo'

/**
 * 로고 또는 제목 첫 글자 원형 배지 (다듬기 4-a).
 *
 * src는 이미 서명된 URL이다 — 이 컴포넌트는 경로를 모른다. 부모(서버 컴포넌트)가
 * signInitiativeLogos로 목록 전체를 한 번에 받아 나눠 준다.
 *
 * 배지에 색을 주지 않는다(요구사항서 2번). 로고가 없다는 것은 위험이 아니다.
 *
 * <img>를 쓰고 next/image를 쓰지 않는다. 서명 URL은 1시간마다 값이 바뀌어
 * 최적화 캐시가 매번 빗나가고, 그 캐시에 비공개 이미지가 남는다.
 */
export function InitiativeLogo({
  title,
  src,
  size = 'sm',
}: {
  title: string
  /** 서명된 URL. 없으면 첫 글자 배지로 떨어진다. */
  src?: string
  size?: 'sm' | 'lg'
}) {
  const box = size === 'lg' ? 'size-14 text-[20px]' : 'size-9 text-[13px]'

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`${box} shrink-0 rounded-full border border-line-soft bg-raised object-contain`}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center rounded-full border border-line-soft bg-raised font-semibold text-ink-dim`}
    >
      {logoInitial(title)}
    </span>
  )
}
```

`alt=""`인 이유: 배지 옆에 늘 제목이 글자로 함께 있다. `alt`에 제목을 또 넣으면 스크린 리더가 같은 이름을 두 번 읽는다.

- [ ] **Step 2: 업로드 패널**

Create `src/components/initiatives/logo-upload.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'

import { removeInitiativeLogoAction, saveInitiativeLogoAction } from '@/app/actions/initiatives'
import { InitiativeLogo } from '@/components/initiatives/initiative-logo'
import { LOGO_MAX_BYTES, LOGO_MIME } from '@/lib/initiative-logo'

/**
 * 상세 화면 상단의 로고 (다듬기 4-a).
 *
 * 파일은 Server Action의 인자로 직렬화되지 않는다 — FormData로 보낸다.
 * 상한·형식을 여기서 한 번 보는 것은 친절이지 판정이 아니다. 진짜 문은
 * saveInitiativeLogoAction과 0018 initiative_logos_write다.
 *
 * 성공하면 revalidatePath가 이 화면을 다시 그린다. 낙관적 미리보기를 들지 않는다 —
 * 새 서명 URL이 서버에서 와야 하고, 그 사이 data URL을 띄우면 실패했을 때
 * 화면에만 있는 로고가 남는다.
 */
export function LogoUpload({
  initiativeId,
  title,
  src,
  canEdit,
}: {
  initiativeId: string
  title: string
  src?: string
  canEdit: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File) {
    setError(null)
    if (file.size > LOGO_MAX_BYTES) {
      setError(`2MB를 넘길 수 없습니다. (현재 ${(file.size / 1_048_576).toFixed(1)}MB)`)
      return
    }
    if (!LOGO_MIME.includes(file.type as (typeof LOGO_MIME)[number])) {
      setError('PNG · JPG · WebP만 올릴 수 있습니다.')
      return
    }
    const body = new FormData()
    body.set('initiative_id', initiativeId)
    body.set('logo', file)
    setBusy(true)
    const result = await saveInitiativeLogoAction(body)
    setBusy(false)
    if (ref.current) ref.current.value = ''
    if (result.error) setError(result.error)
  }

  async function remove() {
    setBusy(true)
    setError(null)
    const result = await removeInitiativeLogoAction(initiativeId)
    setBusy(false)
    if (result.error) setError(result.error)
  }

  return (
    <div className="flex items-center gap-3">
      <InitiativeLogo title={title} src={src} size="lg" />

      {canEdit ? (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => ref.current?.click()}
              disabled={busy}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
            >
              {busy ? '올리는 중…' : src ? '로고 바꾸기' : '로고 올리기'}
            </button>
            {src ? (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded px-2 py-1 text-[11px] text-ink-muted transition-colors hover:text-critical disabled:opacity-40"
              >
                지우기
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-[10.5px] text-ink-muted">PNG · JPG · WebP, 2MB 이하</p>
          <input
            ref={ref}
            type="file"
            accept={LOGO_MIME.join(',')}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pick(f)
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="min-w-0 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: 상세 화면에 붙인다**

`src/app/(dashboard)/initiatives/[id]/page.tsx`:

import에:

```ts
import { LogoUpload } from '@/components/initiatives/logo-upload'
```

`Promise.all` 뒤, `notFound()` 다음에:

```ts
  // 로고가 있을 때만 서명한다. 없으면 요청 자체가 없다.
  const logoUrls = initiative.logo_url ? await repo.signInitiativeLogos([initiative.logo_url]) : {}
  const logoSrc = initiative.logo_url ? logoUrls[initiative.logo_url] : undefined
```

`<PageHeader>` **바로 뒤**, 2단 grid **앞**에:

```tsx
      <div className="mt-4">
        <LogoUpload
          initiativeId={id}
          title={initiative.title}
          src={logoSrc}
          canEdit={canEdit}
        />
      </div>
```

(그 아래 `<div className="mt-4 grid gap-4 xl:...">`를 `mt-3.5`로 줄인다.)

- [ ] **Step 4: 검사**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 통과. `<img>` 사용에 대해 `@next/next/no-img-element` 경고가 나면, `initiative-logo.tsx`의 그 줄 위에 이유와 함께 `{/* eslint-disable-next-line @next/next/no-img-element -- 서명 URL은 1시간마다 바뀌어 next/image 캐시가 매번 빗나가고, 그 캐시에 비공개 이미지가 남는다 */}`를 붙인다.

- [ ] **Step 5: dummy에서 올려 본다**

Run: `npm run dev` (dummy). Chairman.
1. `/initiatives`에서 건 하나 생성 → 상세로 이동.
2. 상단에 제목 첫 글자 원형 배지가 있다.
3. **로고 올리기** → PNG 하나 선택 → 잠시 뒤 배지가 이미지로 바뀐다.
4. 2MB 넘는 파일 → `2MB를 넘길 수 없습니다.` (서버까지 안 간다)
5. `.gif` 하나를 강제로 고른다(accept를 무시하고) → `PNG · JPG · WebP만 올릴 수 있습니다.`
6. **지우기** → 첫 글자 배지로 돌아간다.

- [ ] **Step 6: 커밋**

```bash
git add src/components/initiatives/initiative-logo.tsx src/components/initiatives/logo-upload.tsx "src/app/(dashboard)/initiatives/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(initiatives): 상세 상단 로고 업로드 · 첫 글자 배지 폴백

로고가 없으면 제목 첫 글자 원형 배지다. 이모지 제목도 깨지지 않게 [...title][0]로 뽑는다.
next/image가 아니라 <img>다 — 서명 URL은 1시간마다 바뀌어 최적화 캐시가 매번 빗나가고,
그 캐시에 비공개 이미지가 남는다.

낙관적 미리보기를 넣지 않았다. 실패했을 때 화면에만 있는 로고가 남는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 카드 그리드 + 단계 필터 탭

원 지시 4-b. 단계별 표 대신 카드 그리드(3~4열). 각 카드 = 로고 · 제목 · 유형 · 단계 뱃지 · 다음 행동 + D-day · 갱신 N일 전 (+ 4-c의 목표 2줄). 단계 필터 탭은 위에.

**Files:**
- Create: `src/components/initiatives/initiative-cards.tsx`
- Modify: `src/app/(dashboard)/initiatives/page.tsx`

**Interfaces:**
- Consumes: `initiativeClock` · `isStale` · `stalenessDays` (`@/lib/initiative`), `InitiativeLogo`, `FilterChips`
- Produces: `<InitiativeCards initiatives={Initiative[]} businesses={Business[]} logos={Record<string,string>} today={IsoDate} hasAny={boolean} />`

- [ ] **Step 1: 카드 그리드**

Create `src/components/initiatives/initiative-cards.tsx`:

```tsx
import Link from 'next/link'

import { InitiativeLogo } from '@/components/initiatives/initiative-logo'
import { initiativeClock, isStale, stalenessDays } from '@/lib/initiative'
import {
  INITIATIVE_KIND_LABEL_KO, INITIATIVE_STAGE_LABEL_KO,
  type Business, type Initiative, type IsoDate,
} from '@/types'

/**
 * 이니셔티브 카드 그리드 (다듬기 4-b). 단계별 표(initiative-table.tsx)를 대신한다.
 *
 * 표는 한 줄에 네 값을 나란히 놓는다. 건이 열네 개를 넘어가면 회장이 찾는 방식이
 * '제목 읽기'가 아니라 '로고 알아보기'로 바뀌는데, 줄 높이 한 줄에는 로고가 안 들어간다.
 * 그래서 카드다. 단계는 소제목이 아니라 위의 필터 탭이 가른다 — 여섯 단계를 소제목으로
 * 늘어놓으면 카드 그리드가 여섯 토막이 나서 3~4열의 의미가 없어진다.
 *
 * 색 규칙은 표와 같다. 지난 다음 행동만 빨강, 14일 넘게 손 안 댄 건은 흐리게.
 * **흐리게는 카드 전체가 아니라 제목·메타·목표에만 건다.** 정체와 지연은 강하게 겹쳐서,
 * 카드에 opacity를 걸면 하필 가장 급한 카드에서 빨간 D-day가 꺼진다 — 표와 달력에서
 * 두 번 반복한 실수다. 세 번째는 없다.
 */
export function InitiativeCards({
  initiatives,
  businesses,
  logos,
  today,
  hasAny,
}: {
  initiatives: Initiative[]
  businesses: Business[]
  /** 경로 → 서명된 URL. 페이지가 한 번에 발급해 넘긴다. */
  logos: Record<string, string>
  today: IsoDate
  /** 필터 없이도 하나도 없는가. '조건에 안 맞음'과 '아직 없음'을 갈라야 한다. */
  hasAny: boolean
}) {
  if (initiatives.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-line bg-panel/60 p-6 text-center text-[12px] text-ink-muted">
        {hasAny ? '이 조건에 맞는 건이 없습니다.' : '아직 등록된 이니셔티브가 없습니다. 위에서 새 건을 만들어 보세요.'}
      </p>
    )
  }
  const nameOf = new Map(businesses.map((b) => [b.business_id, b.name]))

  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {initiatives.map((i) => {
        const clock = initiativeClock(i, today)
        const stale = isStale(i, today)
        const dim = stale ? 'opacity-55' : ''
        return (
          <li key={i.initiative_id}>
            <Link
              href={`/initiatives/${i.initiative_id}`}
              className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3.5 transition-colors hover:border-accent"
            >
              <div className="flex items-start gap-2.5">
                <InitiativeLogo
                  title={i.title}
                  src={i.logo_url ? logos[i.logo_url] : undefined}
                />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[13.5px] leading-snug font-semibold text-ink ${dim}`}>
                    {i.title}
                  </p>
                  <p className={`mt-0.5 truncate text-[11px] text-ink-muted ${dim}`}>
                    {INITIATIVE_KIND_LABEL_KO[i.kind]}
                    {i.business_id ? ` · ${nameOf.get(i.business_id) ?? i.business_id}` : ''}
                  </p>
                </div>
                {/* 단계 뱃지. 색을 주지 않는다 — 단계는 위험이 아니다. */}
                <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[10px] font-semibold text-ink-dim">
                  {INITIATIVE_STAGE_LABEL_KO[i.stage]}
                </span>
              </div>

              {/* 4-c: 목표 2줄까지 */}
              {i.goal ? (
                <p className={`mt-2.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-dim ${dim}`}>
                  {i.goal}
                </p>
              ) : null}

              {/* 아래쪽에 붙인다 — 카드 높이가 제각각이어도 다음 행동 줄은 같은 높이에 선다. */}
              <div className="mt-auto pt-3">
                {i.next_action ? (
                  <div className="flex items-baseline gap-2">
                    <span className={`min-w-0 flex-1 truncate text-[12px] text-ink-dim ${dim}`}>
                      {i.next_action}
                    </span>
                    {clock ? (
                      <span
                        className={`shrink-0 text-[12px] font-semibold tnum ${
                          clock.overdue ? 'text-critical' : 'text-ink'
                        }`}
                      >
                        {clock.label}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className={`text-[11px] text-ink-muted ${dim}`}>다음 행동 없음</p>
                )}

                {stale ? (
                  <p className="mt-1 text-[10.5px] text-ink-muted tnum">갱신 {stalenessDays(i, today)}일 전</p>
                ) : null}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 2: 목록 페이지 — 단계 필터 탭과 서명 URL**

`src/app/(dashboard)/initiatives/page.tsx`.

import에:

```ts
import { InitiativeCards } from '@/components/initiatives/initiative-cards'
```

`@/types` import에 `INITIATIVE_STAGE`, `INITIATIVE_STAGE_LABEL_KO`, `type InitiativeStage`를 더한다.

상단 JSDoc을 고친다:

```
/**
 * /initiatives — 회사 밖에서 굴러가는 건 목록 (Phase 4-A, 다듬기 4-b에서 카드 그리드로).
 *
 * 카드 그리드다(3~4열). 표였을 때는 로고가 들어갈 자리가 없었다 — 건이 열네 개를 넘으면
 * 회장이 찾는 방식은 제목 읽기가 아니라 로고 알아보기다.
 * 단계는 소제목이 아니라 맨 위 필터 탭이 가른다.
 *
 * 기본 필터는 status=Active다. 접은 건까지 늘 보이면 목록이 쓰레기통이 된다.
 * 단계 필터의 기본은 '전체'다 — 회장이 처음 여는 화면에서 무언가가 미리 숨어 있으면 안 된다.
 *
 * 필터는 URL에 있다(lib/query.ts). 칩의 숫자는 '나머지 필터가 걸린 상태에서 이걸 누르면
 * 몇 건이 보이나'라, 각자 자기 필터만 뺀 채로 센다.
 *
 * 표로 보고 싶으면 ?view=table. 카드가 기본이다(원 지시 4-b).
 */
```

필터 계산에 stage를 더한다:

```ts
  const kind = oneOf(firstParam(params.kind), INITIATIVE_KIND)
  const status = oneOf(firstParam(params.status), INITIATIVE_STATUS) ?? 'Active'
  const stage = oneOf(firstParam(params.stage), INITIATIVE_STAGE)
  const business = firstParam(params.business)
  const view = firstParam(params.view) === 'table' ? 'table' : 'cards'

  const match = (i: Initiative, skip?: 'kind' | 'status' | 'business' | 'stage') =>
    (skip === 'kind' || !kind || i.kind === kind) &&
    (skip === 'status' || i.status === status) &&
    (skip === 'stage' || !stage || i.stage === stage) &&
    (skip === 'business' || !business || i.business_id === business)

  const byStatus = initiatives.filter((i) => match(i, 'status'))
  const byKind = initiatives.filter((i) => match(i, 'kind'))
  const byStage = initiatives.filter((i) => match(i, 'stage'))
  const byBusiness = initiatives.filter((i) => match(i, 'business'))

  const shown = orderInitiatives(initiatives.filter((i) => match(i)))

  // 보이는 카드의 로고만 한 번에 서명한다. 카드마다 부르면 14장 그리드가 14요청이 된다.
  const logos = await repo.signInitiativeLogos(
    shown.map((i) => i.logo_url).filter((p): p is string => Boolean(p)),
  )
```

기존 `statusOptions` / `kindOptions` / `businessOptions`의 `withParams(...)` 인자에 `stage`를 전부 더한다(안 그러면 단계 필터가 다른 칩을 누를 때마다 풀린다). 그리고 `stageOptions`를 새로 만든다:

```ts
  const stageOptions: FilterOption[] = [
    { label: '전체', href: withParams(BASE, { kind, status, stage: undefined, business }), active: !stage },
    ...INITIATIVE_STAGE.map((s) => ({
      label: INITIATIVE_STAGE_LABEL_KO[s],
      href: withParams(BASE, { kind, status, stage: s, business }),
      active: stage === s,
      count: byStage.filter((i) => i.stage === s).length,
    })),
  ]
```

`oneOf`의 두 번째 인자 타입이 `readonly InitiativeStage[]`로 맞는지 확인한다 — `INITIATIVE_STAGE`는 `as const`라 그대로 들어간다.

필터 줄의 **맨 위**에 단계를 놓는다(원 지시: "단계별 필터 탭 상단에"):

```tsx
      <div className="mt-4 space-y-2">
        <FilterChips label="단계" options={stageOptions} />
        <FilterChips label="상태" options={statusOptions} />
        <FilterChips label="유형" options={kindOptions} />
        <FilterChips label="회사" options={businessOptions} />
      </div>
```

목록 렌더링:

```tsx
      {view === 'table' ? (
        <InitiativeTable initiatives={shown} businesses={businesses} today={today} hasAny={initiatives.length > 0} />
      ) : (
        <InitiativeCards
          initiatives={shown}
          businesses={businesses}
          logos={logos}
          today={today}
          hasAny={initiatives.length > 0}
        />
      )}
```

`PageHeader`의 children에 보기 전환 링크를 더한다:

```tsx
        <Link
          href={withParams(BASE, { kind, status, stage, business, view: view === 'table' ? undefined : 'table' })}
          className="text-[12px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {view === 'table' ? '카드로 보기' : '표로 보기'}
        </Link>
```

`withParams`가 `view` 키를 받는지(임의 키를 받는 시그니처인지) `src/lib/query.ts`에서 먼저 확인한다. 고정 키만 받는 모양이면 `view`를 더한다.

- [ ] **Step 3: 검사**

Run: `npm run typecheck && npm run lint && npm run build`

- [ ] **Step 4: dummy에서 본다**

Run: `npm run dev` (dummy)
1. 건을 5~6개 만들고 단계를 섞어 놓는다. 한둘에 로고를 올린다.
2. `/initiatives` — 3~4열 카드. 로고 있는 카드는 이미지, 없는 카드는 첫 글자 배지.
3. 단계 탭을 누른다 → 그 단계만 남고, 다른 칩(상태·유형·회사)이 풀리지 않는다.
4. 브라우저 폭을 줄인다 → 4열 → 3열 → 2열 → 1열.
5. 다음 행동일이 지난 건 하나를 만든다 → D+n이 빨갛다. 그 건의 `updated_at`을 14일 이상 과거로 만들 수 없으니(dummy는 방금 만든다) 정체 흐리게는 staging에서 본다.
6. **표로 보기** → 기존 단계별 표. **카드로 보기** → 돌아온다.

- [ ] **Step 5: 커밋**

```bash
git add src/components/initiatives/initiative-cards.tsx "src/app/(dashboard)/initiatives/page.tsx"
git commit -m "$(cat <<'EOF'
feat(initiatives): 카드 그리드 + 단계 필터 탭 (표는 ?view=table로 남김)

건이 열네 개를 넘으면 회장이 찾는 방식은 제목 읽기가 아니라 로고 알아보기다.
표의 줄 높이에는 로고가 안 들어간다. 단계는 소제목이 아니라 위의 필터 탭이 가른다 —
여섯 단계를 소제목으로 늘어놓으면 그리드가 여섯 토막이 나 3~4열의 의미가 없어진다.

흐리게는 카드 전체가 아니라 제목·메타·목표에만 걸었다. 카드에 걸면 하필
가장 급한 카드에서 빨간 D-day가 꺼진다(표·달력에서 두 번 반복한 실수).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 기획 칸 확대

원 지시 4-c. 상세 편집의 `goal`·`chairman_note`를 6줄 이상 + 자동 확장으로. (목록 카드의 목표 2줄은 Task 7에서 이미 넣었다.)

**Files:**
- Modify: `src/components/initiatives/initiative-panel.tsx` (`FieldEditor` textarea, `InitiativeNotePanel`, `EDIT_FIELDS`)
- Modify: `src/app/actions/initiatives.ts` (`goal` 상한 분리)

**Interfaces:**
- Consumes: 기존 `FieldMeta` 구조
- Produces: `FieldMeta.rows?: number` — textarea의 최소 줄 수. 없으면 3

- [ ] **Step 1: `goal`의 상한을 올린다 (P-4)**

`src/app/actions/initiatives.ts`:

```ts
const MAX_TEXT = 500
/** 목표는 '무엇을 얻는가'를 적는 기획 칸이다. 한 줄 제목과 같은 상한을 쓸 이유가 없다(다듬기 4-c). */
const GOAL_MAX = 2_000
/** 회장 개인 메모는 판단을 적는 자리라 한 칸보다 길다 — 그래도 문서 전체를 실수로 붙여 넣는 사고는 잡는다. */
const NOTE_MAX = 5_000
```

`saveInitiativeField`의 텍스트 분기:

```ts
  if (TEXT_FIELDS.includes(field as (typeof TEXT_FIELDS)[number])) {
    const limit = field === 'goal' ? GOAL_MAX : MAX_TEXT
    if (raw.length > limit) {
      return { error: `${limit.toLocaleString()}자를 넘길 수 없습니다. (현재 ${raw.length.toLocaleString()}자)` }
    }
    if (field === 'title' && !raw) return { error: '제목은 비울 수 없습니다.' }
    patch = { [field as string]: raw }
  } else if (...)
```

`initiatives.goal`은 0017에서 `text not null default ''`라 DB 제약이 없다 — 마이그레이션이 필요 없다.

- [ ] **Step 2: `FieldMeta`에 `rows`를 더하고 `goal`을 6줄로**

`src/components/initiatives/initiative-panel.tsx`:

```ts
interface FieldMeta {
  field: InitiativeField
  label: string
  input: FieldInput
  placeholder?: string
  maxLength?: number
  /** textarea의 최소 줄 수. 자동 확장은 여기서 시작해 위로만 간다. */
  rows?: number
}

const MAX_LENGTH = 500
/** actions/initiatives.ts의 GOAL_MAX와 같은 값이어야 한다 — 다르면 화면이 통과시킨 글이 서버에서 잘린다. */
const GOAL_MAX_LENGTH = 2_000

const EDIT_FIELDS: readonly FieldMeta[] = [
  { field: 'title', label: '제목', input: 'text', placeholder: '이 건의 이름', maxLength: MAX_LENGTH },
  { field: 'goal', label: '목표', input: 'textarea', placeholder: '성사되면 무엇을 얻는가', maxLength: GOAL_MAX_LENGTH, rows: 6 },
  { field: 'target_date', label: '목표일', input: 'date' },
  { field: 'next_action', label: '다음 행동', input: 'text', placeholder: '다음에 할 일', maxLength: MAX_LENGTH },
  { field: 'next_action_date', label: '다음 행동일', input: 'date' },
  { field: 'next_action_owner', label: '담당자', input: 'text', placeholder: '누가', maxLength: MAX_LENGTH },
  { field: 'blocker', label: '막힌 것', input: 'textarea', placeholder: '무엇이 막고 있나', maxLength: MAX_LENGTH, rows: 3 },
  { field: 'business_id', label: '연결된 회사', input: 'business' },
] as const
```

`body(meta)`의 `<FieldEditor>` 호출에 `rows={meta.rows}`를 넘긴다.

- [ ] **Step 3: `FieldEditor`에 자동 확장을 넣는다**

같은 파일. `FieldEditor`의 props에 `rows?: number`를 더하고, textarea 분기를 고친다:

```tsx
      {input === 'textarea' ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autoGrow(e.currentTarget)
          }}
          // 열릴 때 이미 긴 글이면 처음부터 그 높이로 뜬다. onChange만으로는 첫 렌더에 안 걸린다.
          ref={(el) => {
            ref.current = el as never
            if (el) autoGrow(el)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={label}
          rows={rows ?? 3}
          maxLength={maxLength}
          disabled={busy}
          className={`${shared} resize-y overflow-hidden`}
        />
      ) : input === 'date' ? (
```

⚠️ 위 조각은 `ref`를 두 번 쓴다 — React에서 같은 prop을 두 번 주면 뒤엣것만 남는다. **하나로 합친다:**

```tsx
      {input === 'textarea' ? (
        <textarea
          ref={(el) => {
            ;(ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
            if (el) autoGrow(el)
          }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autoGrow(e.currentTarget)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={label}
          rows={rows ?? 3}
          maxLength={maxLength}
          disabled={busy}
          className={`${shared} resize-y overflow-hidden`}
        />
      ) : ...
```

`ref`가 `useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null)`로 선언되어 있어 타입이 시끄러우면, textarea 전용 ref를 하나 더 두는 편이 낫다:

```ts
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = input === 'textarea' ? areaRef.current : ref.current
    el?.focus()
    if (input === 'text' || input === 'textarea') el?.select?.()
    if (input === 'textarea' && areaRef.current) autoGrow(areaRef.current)
  }, [input])
```

그리고 textarea에는 `ref={areaRef}`만 준다.

파일 맨 아래에 헬퍼:

```ts
/**
 * 내용에 맞춰 위로만 자란다 (다듬기 4-c).
 *
 * height를 'auto'로 한 번 되돌린 뒤 scrollHeight를 읽는다 — 안 그러면 글을 지울 때
 * 높이가 줄지 않는다(scrollHeight가 현재 height보다 작아질 수 없다).
 * rows가 최소 높이를 잡으므로 여기서 하한을 따로 두지 않는다. overflow-hidden이
 * 스크롤바가 잠깐 나타났다 사라지는 깜빡임을 막는다.
 */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
```

- [ ] **Step 4: 회장 메모도 같게 한다**

같은 파일의 `InitiativeNotePanel`을 찾아(파일 뒷부분) 그 안의 `<textarea>`에 `rows={6}`, `className`에 `overflow-hidden`, `onChange`에 `autoGrow(e.currentTarget)`를 더한다. 이미 `rows`가 6 이상이면 자동 확장만 더한다.

- [ ] **Step 5: 검사**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 통과. ref 타입 오류가 나면 Step 3의 `areaRef` 분리안을 쓴다.

- [ ] **Step 6: dummy에서 쳐 본다**

Run: `npm run dev` (dummy)
1. 상세 → **목표** 칸을 누른다 → 6줄짜리 textarea가 열린다.
2. Enter로 줄을 늘린다 → 칸이 같이 자란다. 스크롤바가 안 생긴다.
3. 지운다 → 6줄까지 줄어들고 더는 안 줄어든다.
4. Ctrl+Enter로 저장 → 읽기 상태로 돌아가고 문단이 보존된다.
5. 600자짜리 글을 붙여 넣는다 → 저장된다(예전 상한 500을 넘는다).
6. **막힌 것** 칸은 3줄로 열린다 — 바뀌지 않았다.
7. 회장 메모도 6줄 + 자동 확장.

- [ ] **Step 7: 커밋**

```bash
git add src/components/initiatives/initiative-panel.tsx src/app/actions/initiatives.ts
git commit -m "$(cat <<'EOF'
feat(initiatives): 목표·회장 메모 6줄 + 자동 확장, 목표 상한 2000자

칸만 키우고 상한을 500자로 두면 6줄을 채우기 전에 막힌다. 목표는 '무엇을 얻는가'를
적는 기획 칸이라 제목과 같은 상한을 쓸 이유가 없다. 화면과 Server Action의 상한을
같은 값으로 맞췄다 — 다르면 화면이 통과시킨 글이 서버에서 잘린다.

자동 확장은 height를 auto로 되돌린 뒤 scrollHeight를 읽는다. 안 그러면 글을 지울 때
높이가 줄지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 전체 검증 · staging 반영 · 스크린샷

원 지시의 "staging push"와 "스크린샷". production은 여기서 하지 않는다 (P-3).

- [ ] **Step 1: 전체 검사를 한 번에 돌린다**

```bash
npm run typecheck && npm run lint && npm run build \
  && npm run check:migrations && npm run check:db-safety \
  && npm run check:boundaries && npm run check:finance
```

Expected: 전부 통과. 하나라도 실패하면 **여기서 멈추고 고친다.** staging에 밀지 않는다.

- [ ] **Step 2: 작업 트리가 깨끗한지 본다**

Run: `git status --short`
Expected: 비어 있다. `AGENTS.md`가 떠 있으면(`next dev`가 다시 썼다) 같이 커밋한다.

- [ ] **Step 3: staging에 DB를 민다**

```bash
npm run db:push:staging --  --dry-run
```

먼저 dry-run으로 **무엇이 밀리는지** 본다. 0018 하나만 나와야 한다. 다른 것이 같이 나오면 멈추고 보고한다 — `db push`는 밀린 것을 **전부** 적용한다.

(`--dry-run` 전달 방식은 `scripts/db-push.mjs`를 먼저 읽고 맞춘다. 받지 않으면 `supabase db push --linked --dry-run`을 직접 쓰되, link된 ref가 `itpenmxyracfhyormcep`(staging)인지 `supabase projects list`로 먼저 확인한다.)

확인되면:

```bash
npm run db:push:staging
```

- [ ] **Step 4: staging에서 버킷을 확인한다**

Supabase 콘솔(staging `itpenmxyracfhyormcep`) → Storage → `initiative-logos`가 있고 **Public이 꺼져** 있는지 본다. 켜져 있으면 끈다(0018의 `raise warning`이 이미 경고했을 것이다).

- [ ] **Step 5: staging Preview 배포와 확인**

OPERATIONS §1 "Vercel Preview를 staging Supabase에 붙인다"를 따른다. 배포 후 §1의 배포 후 확인 4단계를 돌린다.
그 위에 이번 변경분:
- `/ai` 2단, 스크롤 시 왼쪽 고정, 1024px 이하 세로
- `/calendar` 날짜 클릭 → 모달 → 추가·수정·삭제
- `/initiatives` 카드 그리드, 단계 탭, 로고 업로드 → 카드와 상세에 표시
- **다른 역할로 로그인해 본다**: Member 계정으로 `/initiatives`에 가면 아무것도 안 보여야 한다. 로고 서명 URL도 발급되지 않는다.
- 상세 → **이력**에 로고 변경이 `logo_url` before/after로 남아 있는지 본다.

- [ ] **Step 6: 스크린샷 4장**

`.screenshots/`에 날짜와 무엇인지가 드러나는 이름으로 저장한다(`2026-09-18-phase-4a-calendar-multiday.jpg`가 본이다). 폭은 1440px.

```
.screenshots/2026-09-19-polish-1-group-brief.png     — /ai 그룹 브리핑이 온전히 나온 화면
.screenshots/2026-09-19-polish-2-calendar-modal.png  — /calendar 날짜 팝업(수정 폼이 열린 상태)
.screenshots/2026-09-19-polish-3-ai-two-column.png   — /ai 2단 (왼쪽 D-day·선언문 / 오른쪽 오늘·브리핑)
.screenshots/2026-09-19-polish-4-initiative-cards.png — /initiatives 카드 그리드 (로고 있는 카드 포함)
```

- [ ] **Step 7: 스크린샷 커밋**

```bash
git add .screenshots/
git commit -m "$(cat <<'EOF'
docs: 4-A 다듬기 staging 확인 스크린샷 4장

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: 회장에게 보고하고 멈춘다**

production으로 넘어가지 않는다 (P-3). 보고에 넣을 것:
- 커밋 8개의 SHA와 한 줄 요약
- staging에서 확인한 것과 확인하지 못한 것
- **production 반영에 필요한 것**: `supabase link --project-ref nndvspgnljivkvihxlzj` → `supabase db push` (0018) → 앱 배포 → `npm run db:push:staging`으로 link 되돌리기 (OPERATIONS §9 11~12)
- 0018은 `add column if not exists` + 새 버킷·정책이라 **구버전 앱과 호환된다** — 앱 롤백이 DB 롤백을 요구하지 않는다

---

## Self-Review

**1. 스펙 커버리지**

| 원 지시 | Task |
|---|---|
| 1. max_tokens 4000→12000 | Task 1 Step 1 |
| 1. daily-brief.md 길이 명시 | Task 1 Step 2 |
| 1. 수동 실행으로 성공 확인 | Task 1 Step 4~5 |
| 2. 날짜 클릭 → 목록 + 추가 팝업 | Task 2 Step 2~3 |
| 2. 이벤트 클릭 → 같은 모달에서 수정·삭제 | Task 2 Step 2 |
| 2. 페이지 이동 없이 | Task 2 Step 3 (칸이 button, 항목 링크는 모달 안으로) |
| 2. 삭제 확인 한 번 | Task 2 Step 2 (`confirming` 상태) |
| 2. audit_log | 기존 `removeEvent`가 이미 남긴다 — Task 9 Step 5에서 확인 |
| 3. 좌우 2단, 왼쪽 D-day+선언문 | Task 3 Step 2 |
| 3. 오른쪽 오늘·이번 주 + 브리핑 | Task 3 Step 2 |
| 3. 1024px 이하 세로 | Task 3 Step 2 (`min-[1025px]`) |
| 3. 왼쪽 sticky | Task 3 Step 2 (+ max-h/overflow) |
| 4-a. logo_url 칸 | Task 4 Step 1 |
| 4-a. 비공개 버킷 + RLS | Task 4 Step 1 Step 3 |
| 4-a. 상세에서 업로드 | Task 6 Step 2~3 |
| 4-a. 카드와 상세 상단에 표시 | Task 6 Step 3, Task 7 Step 1 |
| 4-a. 로고 없으면 첫 글자 배지 | Task 6 Step 1 |
| 4-b. 카드 그리드 3~4열 | Task 7 Step 1 |
| 4-b. 로고·제목·유형·단계·다음행동+D-day·갱신 N일 전 | Task 7 Step 1 |
| 4-b. 단계별 필터 탭 상단 | Task 7 Step 2 |
| 4-b. 칸반 옵션으로 | Task 7 Step 2 (`?view=table`, P-5) |
| 4-c. goal·chairman_note 6줄 자동 확장 | Task 8 Step 2~4 |
| 4-c. 카드에서 goal 2줄 | Task 7 Step 1 (`line-clamp-2`) |
| 각 항목 커밋 | Task 1·2·3·4·5·6·7·8 각 마지막 Step |
| staging push | Task 9 Step 3 |
| production push | **하지 않는다** — P-3에 따라 승인 대기 |
| 스크린샷 | Task 9 Step 6 (3장 → 4장. 4번이 뒤에 추가되었다) |

**2. 미검증 지점 — 실행자가 먼저 확인할 것**

이 계획을 쓰면서 읽지 않은 파일이 셋 있다. 해당 Step에서 먼저 열어 보고 맞춘다.
- `src/lib/query.ts` — `withParams`가 임의 키(`stage`·`view`)를 받는가 (Task 7 Step 2)
- `scripts/db-push.mjs` — `--dry-run`을 넘기는 방법 (Task 9 Step 3)
- `scripts/check-migrations.ts`의 `as()` 반환 모양 (Task 4 Step 3)
- `src/components/initiatives/initiative-panel.tsx`의 `InitiativeNotePanel` textarea 현재 `rows` (Task 8 Step 4)

**3. 타입 일관성**

- `logo_url`은 `Initiative`(types), `INITIATIVE_COLUMNS`(supabase), 0018 SQL 세 곳에 같은 이름으로 있다.
- `logoPath(id)`는 dummy·supabase 둘 다 같은 함수를 쓴다 — 두 어댑터의 `logo_url` 값이 같은 모양이라 화면이 분기를 모른다.
- `signInitiativeLogos`의 반환은 `Record<경로, URL>`. 상세(Task 6 Step 3)와 목록(Task 7 Step 2)이 같은 방식으로 읽는다: `i.logo_url ? logos[i.logo_url] : undefined`.
- `GOAL_MAX`(action) = `GOAL_MAX_LENGTH`(panel) = 2,000. 값이 갈리면 화면이 통과시킨 글을 서버가 거절한다.
- `KIND_MARK` · `isPastRisk`는 `month-grid.tsx` 한 곳에만 있고 클라이언트가 import한다.

---

## 부록 A — 원 지시 (2026-09-19, Chairman)

```
[4-A 다듬기 — 회장 첫 사용 피드백]

1) 브리핑 실패 수정
   그룹 브리핑이 max_tokens에서 잘림. anthropic.ts max_tokens 4000 → 12000.
   daily-brief.md에 "summary 5문장 이내, items 7개 이내, project_notes 각 1문장" 명시해 길이도 잡아라.
   수동 실행으로 그룹 브리핑 성공 확인.

2) 캘린더 팝업 편집
   /calendar에서 날짜 클릭 → 그 날짜의 이벤트 목록 + "추가" 팝업(모달).
   이벤트 클릭 → 같은 모달에서 수정·삭제. 페이지 이동 없이.
   삭제는 확인 한 번. audit_log.

3) 아침 루틴 2단 레이아웃
   /ai를 좌우 2단으로: 왼쪽 = D-day 카운터 + 선언문(부 패러다임) / 오른쪽 = 오늘·이번 주 + AI 브리핑.
   1024px 이하에서는 세로로. 왼쪽 컬럼은 스크롤 시 고정(sticky).

각 항목 커밋 → staging push → production push. 스크린샷 3장.

4) 이니셔티브 화면 개선 (회장 피드백)
   a. 로고: initiatives에 logo_url 추가. Supabase Storage 비공개 버킷 'initiative-logos'
      (Chairman·GroupCFO만 읽기/쓰기, RLS). 상세 화면에서 이미지 업로드 → 카드와 상세 상단에 표시.
      로고 없으면 제목 첫 글자 원형 배지.
   b. 카드 박스형 그리드: 칸반 컬럼 대신 카드 그리드(3~4열). 각 카드 = 로고 · 제목 · 유형 · 단계 뱃지
      · 다음 행동 + D-day · 갱신 N일 전. 단계별 필터 탭 상단에. 칸반은 옵션으로 남겨도 됨.
   c. 기획 칸 확대: 상세 편집에서 goal(목표)·chairman_note(회장 메모) textarea를
      6줄 이상, 자동 확장으로. 목록 카드에서도 goal 2줄까지 보이게.
```

**원 지시와 저장소가 어긋나는 지점**

- "칸반 컬럼 대신" — 이 화면에 칸반은 없다. 단계별로 묶은 **표**가 그 자리다(`initiative-table.tsx`). 그것을 카드 그리드로 바꾼다.
- "chairman_note" — 실제 이름은 `initiative_notes.note`다. 0017이 회장 메모를 별도 표로 뺐다(RLS는 행 단위라 한 표 안에서 칸만 가릴 수 없다). 화면에서는 `InitiativeNotePanel`이다.
- "Supabase Storage" — CLAUDE.md는 "Vault 문서의 파일 실체는 사내 스토리지에 두고 Chairman OS는 링크만 보관한다"고 정했다. 로고는 Vault 문서가 아니라고 보고 예외로 둔다. 판단 근거는 0018의 머리 주석에 적었다.
