# Phase 5 — 글래스 리디자인 + 4-A 다듬기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chairman OS를 다크 고정에서 **라이트 웜 글래스**로 옮기되 아침 루틴(`/ai`)만 다크 글래스로 남기고, 그 위에 대시보드 재배치·이니셔티브 로고/카드·위치/날씨/체크인을 얹는다. 명조(Noto Serif KR) 헤드라인과 골드 강조는 유지한다.

**Architecture:** 토큰 이름을 하나도 바꾸지 않는다. `globals.css`가 이미 못 박아 두었듯 **이름이 API**다 — 42개 파일 948곳이 `bg-panel`·`text-ink-dim` 같은 이름을 쓴다. 2026-09-07의 청회색→웜차콜 교체가 그랬던 것처럼, 값만 바꾼다. 두 테마는 `@theme`의 기본값(라이트) + `[data-theme="dark"]`의 재정의로 갈린다. `/ai`는 라우트 그룹을 옮겨 자기 셸을 갖는다 — 중첩 레이아웃으로는 사이드바를 **대체**할 수 없기 때문이다.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (`@theme`), Supabase Postgres + RLS + Storage, TypeScript, PGlite(`check:migrations`), Open-Meteo(키 없음), 손으로 그린 인라인 SVG 차트.

**Spec:** 이 문서 맨 아래 [부록 A — 원 지시](#부록-a--원-지시-2026-09-19-chairman).

**선행:** `docs/superpowers/plans/2026-09-19-phase-4a-polish.md` — 그 계획의 Task 1·2는 이미 끝났고(블록 0·4), Task 4는 0018로 끝났다. 남은 Task 5가 이 계획의 **P5-A**로 들어온다.

---

## 이미 끝난 것 (다시 하지 않는다)

| 원 지시 | 상태 | 커밋 |
|---|---|---|
| **블록 0** 브리핑 max_tokens + 프롬프트 상한 | ✅ 완료. **실데이터 수동 실행 확인** — 기록 6건·완료 6·실패 0, 그룹 브리핑 summary+items 7개+project_notes 1개 온전 | `00e8d94` |
| **블록 4** 캘린더 날짜 팝업 (추가·수정·삭제, 확인 1회, `audit_log`) | ✅ 완료. dummy 런타임 검증 — 모달에서 제목 수정 후에도 이니셔티브 연결 유지 | `130f8ff`, `b4874e3` |
| **블록 3의 DB층** `initiatives.logo_url` + `initiative-logos` 비공개 버킷 + RLS | ✅ 0018. 보안 리뷰 2라운드 통과, 정책 4개 전부 `bucket_id` 단언으로 고정 | `a69c7ae`, `abb3aa8`, (+라운드 2) |
| `/ai` 2단 sticky | ⚠️ 완료했으나 **P5-5c가 다시 쓴다**. sticky `max-h` 계산(스크롤 컨테이너는 `<main>`)은 그대로 살린다 | `38599c7`, `24f32ed` |

---

## 확정된 것

| # | 결정 | 근거 |
|---|---|---|
| **P-7** | glass-card 전환 범위 = **블록 2·3·5 화면 + 셸(사이드바·헤더·시스템바)만.** 재무·업무·문서·결재·설정은 토큰만 바뀌어 따라온다 | 회장 확답. 매일 보는 화면부터 끝내고 범위를 줄인다 |
| **P-8** | `chairman_checkins`는 **0019 신설**. 0018은 다시 열지 않는다 | 회장 확답. 0018은 보안 리뷰를 통과했고 성격이 다르다. 되돌릴 때 따로 되돌린다 |
| **P-9** | 토큰 **이름을 하나도 바꾸지 않는다**. `@theme` 기본값=라이트, `[data-theme="dark"]`가 재정의 | `globals.css:9-10` — 948곳이 이 이름을 쓴다. 이름을 건드리면 토큰 교체가 아니라 전면 수정이 된다 |
| **P-10** | `/ai`를 `(dashboard)` 그룹에서 **`(morning)` 그룹으로 옮긴다**. URL은 `/ai` 그대로 | 중첩 레이아웃은 부모 셸 **안에** 그려진다. 사이드바를 아이콘 레일로 **대체**하려면 형제 레이아웃이어야 한다 |
| **P-11** | 블록 순서를 그대로 따르지 않는다. **P5-A(로고 백엔드)를 블록 1보다 먼저** 한다 | 스타일과 무관한 백엔드다. 반대로 이니셔티브 카드 UI를 블록 1보다 먼저 만들면 같은 카드를 두 번 만든다 |

---

## Global Constraints

**모든 Task의 요구사항에 묵시적으로 포함된다.**

- **토큰 이름 불변.** 새 색이 필요하면 값을 바꾸거나 `@theme`에 **새 이름을 더한다**. 기존 이름의 의미를 바꾸지 않는다.
- **권한은 DB에만 있다.** `canEdit` 같은 prop은 안내지 판정이 아니다. 실제 문은 RLS다.
- **`service_role`은 없다.** 모든 원격 접근은 요청자 세션으로.
- **감사 기록은 쓰기보다 먼저.** `supabase.ts`의 모든 mutator가 `before`를 읽고 `audit_log`를 넣은 다음 쓴다.
- **삭제는 `action:'update'` + `after:null`.** `audit_action` enum에 `delete`가 없다.
- **색은 위험·승인대기에만.** 글래스로 바뀌어도 이 규칙은 그대로다. 골드는 강조(활성·Chairman 표식)지 상태가 아니다.
- **흐리게(opacity)는 위험색을 덮지 않는다.** `text-critical` 요소의 **어느 조상도** `opacity-*`를 가질 수 없다. 이 프로젝트가 세 번 어긴 규칙이다.
- **열거값은 `*_LABEL_KO`를 거쳐 나간다.**
- **오늘은 KST다.** `kstToday()`.
- **한국어 주석.** 평서형(`~다`) 보고체로 *왜*를 적는다. 주변 파일의 밀도에 맞춘다.
- **테스트 프레임워크는 없다.** 검증은 `npm run typecheck` · `lint` · `build` · `check:migrations` · `check:db-safety` · `check:boundaries` · `check:finance`, 그리고 dummy dev 서버의 실제 조작이다.
- **dummy 검증은 `NEXT_PUBLIC_DATA_MODE=dummy npm run dev`.** `.env.local`은 **live + production**이다. 에이전트는 그 파일을 고치지 않는다.
- **브라우저 워크스루와 스크린샷은 컨트롤러가 한다.** 로그인이 production Supabase auth를 지나 구현자에게 자격증명이 필요해지기 때문이다.
- **새 의존성 금지.** 차트도 지금처럼 손으로 그린 인라인 SVG다.
- **마이그레이션 번호: 0019 하나만 새로 만든다.** 0018 이하는 건드리지 않는다.
- 브랜치는 `master`. push·merge 금지(컨트롤러가 한다). `git clean`·`git reset --hard` 금지.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- `AGENTS.md`가 수정되어 나타나면(`next dev`가 다시 쓴다) 같이 커밋한다.

---

## 토큰 2세트 — 확정표

기존 이름 24개를 그대로 쓴다. 라이트가 기본(`@theme`), 다크가 재정의(`[data-theme="dark"]`).

| 토큰 | 라이트 (기본) | 다크 (`/ai`) | 쓰는 곳 |
|---|---|---|---|
| `--color-app` | `#f6ede0` (그라데이션 베이스) | `#0c1224` | body 바탕, 모달 오버레이 |
| `--color-nav` | `rgba(255,255,255,.45)` | `rgba(255,255,255,.04)` | 사이드바·헤더·시스템바 |
| `--color-panel` | `rgba(255,255,255,.55)` | `rgba(255,255,255,.06)` | **카드 (121곳)** |
| `--color-raised` | `rgba(255,255,255,.72)` | `rgba(255,255,255,.10)` | 입력·hover·가라앉은 면 (109곳) |
| `--color-line` | `rgba(255,255,255,.85)` | `rgba(255,255,255,.16)` | 구분선·입력 테두리 |
| `--color-line-soft` | `rgba(255,255,255,.70)` | `rgba(255,255,255,.12)` | **카드 테두리 (97곳)** |
| `--color-ink` | `#1e1a16` | `#e9e6f2` | 본문 (783곳) |
| `--color-ink-dim` | `#4a3f34` | `#c9c5da` | 보조 (217곳) |
| `--color-ink-muted` | `#8a7a68` | `#b7b3c8` | 흐린 글자 (383곳) |
| `--color-accent` | `#b8862b` | `#e0a23a` | 활성·버튼·링크 (155곳) |
| `--color-accent-soft` | `#f2e3c8` | `#4a3416` | 아바타 바탕 (2곳) |
| `--color-gold` | `#b8862b` | `#e0a23a` | 왕관 표식 (25곳) |
| `--color-critical` | `#b23a2a` | `#e8735a` | 위험 (155곳) |
| `--color-warning` | `#b06a2a` | `#d97b4a` | 주의 (41곳) |
| `--color-ok` | `#2c6b2a` | `#7fb069` | 정상 (19곳) |
| `--color-info` | `#7a6a52` | `#d0a878` | 참고 (5곳) |
| `--color-positive` | `#2c6b2a` | `#7fb069` | 증감 + |
| `--color-negative` | `#b23a2a` | `#e8735a` | 증감 − |
| `--color-biz-*` 5개 | 그대로 두되 라이트에서 명도 −12% | 현재 값 | `business-card.tsx`에만 |

**새로 더하는 이름** (기존 이름의 의미를 바꾸지 않기 위해):

| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--color-glass-shadow` | `rgba(90,60,30,.10)` | `rgba(0,0,0,.35)` | 카드 그림자 |
| `--radius-glass` | `26px` | `26px` | 카드 radius (24~28 중앙값) |
| `--blur-glass` | `24px` | `24px` | `backdrop-filter` |
| `--gradient-app` | 아래 라디얼 3겹 | 아래 라디얼 3겹 | body 배경 |
| `--color-dday-from/via/to` | `#f6d08e`/`#e79d57`/`#cf6d3d` | 동일 | D-day 카드 골드 그라데이션 |

배경 그라데이션:
```
라이트: radial-gradient(at 15% 8%, #f7d9b4 0%, transparent 55%),
        radial-gradient(at 85% 5%, #f0b58a 0%, transparent 50%),
        radial-gradient(at 50% 100%, #d9c1e6 0%, transparent 55%),
        linear-gradient(#f6ede0, #ead8c6)
다크:   radial-gradient(at 85% 8%, #3a2a5c 0%, transparent 55%),
        radial-gradient(at 10% 85%, #16345c 0%, transparent 50%),
        radial-gradient(at 90% 95%, #7a3d2a 0%, transparent 45%),
        linear-gradient(#0c1224, #0a0f1d)
```

**대비 보정 규칙(`globals.css:89-118`)은 테마별로 갈라야 한다.** 지금 규칙은 어두운 배경 전용이다 — `bg-critical/10` + `text-critical` 조합의 글자를 **밝게**(`#f0a58f`) 올린다. 흰 글래스 카드 위에서는 정반대라 뱃지가 녹는다. P5-1이 라이트용 보정을 따로 쓰고 **실측(AA 4.5:1)으로 확인**한다.

---

## File Structure

### 새로 만드는 것

| 파일 | 책임 |
|---|---|
| `src/components/ui/glass-card.tsx` | 글래스 카드 하나. `as`(태그)·`tone`(기본/강조/위험)·`padding` prop. `backdrop-filter` 폴백 포함 |
| `src/components/layout/world-clocks.tsx` | 헤더의 세계시간 칩 (서울·호치민·토론토·두바이). 클라이언트, `Intl.DateTimeFormat` |
| `src/components/layout/rail-sidebar.tsx` | `/ai` 전용 76px 아이콘 레일 |
| `src/app/(morning)/layout.tsx` | `/ai` 셸. `data-theme="dark"` + 아이콘 레일 |
| `src/app/(morning)/ai/page.tsx` | `(dashboard)/ai/page.tsx`에서 이동 |
| `src/components/dashboard/dday-hero.tsx` | 히어로 좌측 400px D-day 카드 (골드 그라데이션) |
| `src/components/morning/greeting-clock.tsx` | 인사 + 큰 시계 + 세계시간 |
| `src/components/morning/weather-panel.tsx` | 현재 위치 날씨 + 관심 도시 |
| `src/components/morning/checkin-panel.tsx` | 오늘 체크인 (컨디션·수면·체중·식사) |
| `src/components/morning/use-geolocation.ts` | 브라우저 위치 허용 → 좌표, 거부/실패 시 null |
| `src/lib/weather.ts` | Open-Meteo 호출 + 코드→한국어 라벨. 서버 전용, 30분 캐시 |
| `src/lib/geo.ts` | Vercel IP 헤더 폴백(`x-vercel-ip-*`) + 관심 도시 좌표표 |
| `src/types/checkin.ts` | `ChairmanCheckin` + 컨디션 라벨 |
| `supabase/migrations/0019_chairman_checkins.sql` | 체크인 표 + RLS(Chairman 전용) |

### 고치는 것

| 파일 | 무엇을 |
|---|---|
| `src/app/globals.css` | 토큰 2세트, 배경 그라데이션, 글래스 유틸, 테마별 대비 보정 |
| `src/app/layout.tsx` | `<html data-theme="light">` |
| `src/components/layout/sidebar.tsx` | 글래스 패널, 활성=흰 필, **하단 프로필**, 워드마크 `<Link href="/">` (P5-6에서 별도 커밋) |
| `src/components/layout/header.tsx` | 글래스, 세계시간 칩, 날씨 칩 |
| `src/components/layout/system-bar.tsx` | 글래스 |
| `src/app/(dashboard)/layout.tsx` | 글래스 셸 |
| `src/app/(dashboard)/page.tsx` | 히어로 2단 → 회사 카드 → KPI → 이니셔티브+브리핑 2단 |
| `src/components/dashboard/*.tsx` | `GlassCard` 사용으로 교체 (57곳 중 대시보드 몫) |
| `src/components/initiatives/*` | 카드 그리드·로고·기획 칸 (P5-A·P5-3) |
| `src/lib/repository/{types,dummy,supabase}.ts` | 로고 3메서드(P5-A) + 체크인 3메서드(P5-5a) |
| `src/lib/ai/night-brief.ts`, `prompts/daily-brief.md` | 체크인 컨디션을 `chairman`에 실어 보내고, 낮으면 첫 줄에 보류 권고 |
| `scripts/check-migrations.ts` | 0019 RLS 단언 |

---

## Task 목록 (블록마다 커밋)

| # | 이름 | 블록 | 성격 |
|---|---|---|---|
| **P5-A** | 로고 저장소 계약 + 두 어댑터 + Server Action | 3 | 백엔드. 스타일 무관 |
| **P5-1** | 토큰 2세트 + `GlassCard` + 셸 | 1 | 기반. 나머지가 전부 이 위에 선다 |
| **P5-2** | 대시보드 재배치 | 2 | 레이아웃 |
| **P5-3** | 이니셔티브 카드 그리드 + 로고 업로드 + 기획 칸 | 3 | UI |
| **P5-5a** | 0019 `chairman_checkins` + 계약 + 어댑터 | 5 | DB |
| **P5-5b** | 위치 + 날씨 (Open-Meteo) | 5 | 서버 fetch |
| **P5-5c** | `(morning)` 그룹 이동 + 다크 셸 + 상단 3칸 + 2단 본문 | 5 | 가장 큼 |
| **P5-5d** | 체크인 → 야간 브리핑 연동 | 5 | AI |
| **P5-6** | 사이드바 워드마크 `<Link href="/">` | — | 별도 커밋 |
| **P5-7** | 전체 검증 + 스크린샷 4장 + staging → production | — | 컨트롤러 |

---

## P5-A: 로고 저장소 계약 + 두 어댑터 + Server Action

선행 계획(`2026-09-19-phase-4a-polish.md`)의 **Task 5** 그대로다. 그 문서의 Task 5 본문이 이 Task의 요구사항이고, 아래 정정만 덧붙는다.

**Files:** `src/lib/initiative-logo.ts`(신규), `src/types/initiative.ts`, `src/lib/repository/{types,index,dummy,supabase}.ts`, `src/app/actions/initiatives.ts`

**Interfaces — Produces:**
- `LOGO_BUCKET='initiative-logos'`, `LOGO_MAX_BYTES=2_097_152`, `LOGO_MIME=['image/png','image/jpeg','image/webp']`
- `logoPath(id): string` → `'ini_001/logo'`, `logoInitial(title): string`
- `repo.saveInitiativeLogo(id, {bytes,contentType}, actor): Promise<string>`
- `repo.removeInitiativeLogo(id, actor): Promise<void>`
- `repo.signInitiativeLogos(paths: string[]): Promise<Record<string,string>>`
- `saveInitiativeLogoAction(formData)`, `removeInitiativeLogoAction(id)`

**선행 계획에서 정정할 것 (그 문서의 누락):**

- [ ] **`createInitiative`의 객체 리터럴에 `logo_url: null`을 더한다.** `InitiativeInput = Omit<Initiative,'initiative_id'|'updated_at'>`라, `Initiative`에 칸이 생기면 `src/app/actions/initiatives.ts:166-173`의 리터럴이 타입 오류를 낸다. 선행 계획은 dummy 어댑터만 언급하고 이 자리를 빠뜨렸다.
- [ ] **`failure()`의 정책 정규식에 `initiative_logos_write`를 넣는다.** 빠지면 로고 권한 거부가 '잠시 후 다시 시도'로 잘못 안내된다. 0018이 정책을 넷으로 쪼갰으므로 `initiative_logos_(read|write_insert|write_update|write_delete)`를 전부 잡는 패턴으로 쓴다.
- [ ] **`INITIATIVE_COLUMNS`에 `logo_url`을 더한다** (`src/lib/repository/supabase.ts:438`).

**검증:** `typecheck`·`lint`·`build`·`check:boundaries`(두 어댑터 계약 일치를 본다). dev 서버 금지 — 컨트롤러가 P5-3 뒤에 한 번에 확인한다.

---

## P5-1: 토큰 2세트 + GlassCard + 셸

이 Task가 나머지 전부의 바닥이다. 여기서 틀리면 948곳이 같이 틀린다.

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/layout/{sidebar,header,system-bar}.tsx`, `src/app/(dashboard)/layout.tsx`
- Create: `src/components/ui/glass-card.tsx`

**Interfaces — Produces:**
```ts
export function GlassCard(props: {
  children: React.ReactNode
  /** 기본 div. 의미가 있으면 article/section/aside로. */
  as?: 'div' | 'article' | 'section' | 'aside'
  /** 'plain' 기본 | 'accent' 골드 테두리(그룹 브리핑 등) | 'danger' 위험 테두리 */
  tone?: 'plain' | 'accent' | 'danger'
  /** Tailwind 패딩 클래스. 기본 'p-5'. */
  padding?: string
  className?: string
  id?: string
}): React.ReactElement
```

- [ ] **Step 1: 토큰을 두 세트로 가른다**

`globals.css`의 `@theme` 블록은 **라이트 기본값**이 된다. 위 [토큰 2세트 확정표](#토큰-2세트--확정표)의 라이트 열을 그대로 넣는다. 이름은 하나도 바꾸지 않는다. 그 아래에:

```css
/**
 * 다크는 아침 루틴(/ai) 한 화면뿐이다. 토큰 이름을 그대로 두고 값만 덮는다 —
 * Tailwind v4의 .bg-panel은 background-color: var(--color-panel)로 나가므로,
 * 이 선택자 안에서 그 변수를 다시 정의하면 하위 트리 전체가 따라온다.
 * 이름을 바꾸는 길은 없다: 42개 파일 948곳이 이 이름을 쓴다(위 주석).
 */
[data-theme='dark'] {
  --color-app: #0c1224;
  /* …확정표의 다크 열 전부… */
}
```

- [ ] **Step 2: 배경과 `color-scheme`을 테마별로**

`html { color-scheme: dark }`는 무조건이었다. 이제:
```css
html { color-scheme: light; }
html:has([data-theme='dark']), [data-theme='dark'] { color-scheme: dark; }
body { background: var(--gradient-app); background-attachment: fixed; color: var(--color-ink); }
```
`background-attachment: fixed`가 필요한 이유를 주석에 적는다 — 스크롤할 때 라디얼 그라데이션이 같이 흘러가면 글래스 카드 뒤로 색이 밀려 보인다.

- [ ] **Step 3: 대비 보정을 테마별로 가른다 — 숫자로 확인한다**

기존 `globals.css:89-118`의 규칙 전체를 `[data-theme='dark']` 안으로 옮기고, 라이트용을 새로 쓴다. 라이트에서는 톤 배경(`bg-critical/10` 등)이 **밝으므로 글자를 어둡게 내린다**:

```css
/* 라이트 — 톤 배경이 밝다. 글자를 내려야 읽힌다(다크와 정반대). */
:is(.bg-critical\/5,.bg-critical\/10,.bg-critical\/15,.bg-critical\/20).text-critical { color: #8f2a1d; }
:is(.bg-warning\/5,.bg-warning\/10,.bg-warning\/15,.bg-warning\/20).text-warning { color: #8a4f18; }
:is(.bg-ok\/5,.bg-ok\/10,.bg-ok\/15,.bg-ok\/20).text-ok { color: #1f4f1d; }
/* 솔리드 톤 위의 글자는 라이트에서도 어둡다 — accent(#b8862b)가 여전히 밝은 색이다. */
:is(.bg-accent,.bg-gold,.bg-warning,.bg-ok,.bg-critical):is(.text-white,.text-ink,.text-ink-dim) { color: #1e1a16; }
```

**보고서에 대비비를 계산해 적는다.** 위 6조합 각각에 대해 (전경, 배경 실효색, 대비비)를 쓰고 4.5:1을 넘는지 표로 낸다. 배경 실효색은 글래스 카드(`rgba(255,255,255,.55)`)가 그라데이션 위에 얹힌 값 위에 톤 10%를 더한 것이다 — 근사해도 되지만 근사했다고 밝힌다. **4.5:1을 못 넘는 조합이 하나라도 있으면 값을 조정하고 다시 계산한다.**

- [ ] **Step 4: `GlassCard`**

```tsx
/**
 * 글래스 카드 하나. 이 앱의 카드 면은 전부 이것을 지난다(Phase 5).
 *
 * backdrop-filter를 모르는 브라우저에서는 배경이 반투명한 채로 남아 글자가 안 읽힌다.
 * @supports로 갈라 미지원이면 불투명도를 올린다 — 흐림이 없으면 대비로 버텨야 한다.
 */
export function GlassCard({ as: Tag = 'div', tone = 'plain', padding = 'p-5', className = '', ...rest }) {
  const toneClass =
    tone === 'accent' ? 'border-accent/35' : tone === 'danger' ? 'border-critical/40' : 'border-line-soft'
  return (
    <Tag
      className={`glass rounded-[--radius-glass] border ${toneClass} ${padding} ${className}`}
      {...rest}
    />
  )
}
```
`.glass`는 `globals.css`에 둔다 — `backdrop-filter`와 `@supports` 폴백은 유틸리티 클래스로 표현하기 나쁘다:
```css
.glass {
  background: var(--color-panel);
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  box-shadow: 0 12px 40px var(--color-glass-shadow);
}
/* 흐림이 없으면 배경이 비쳐 글자가 안 읽힌다. 불투명도로 버틴다. */
@supports not (backdrop-filter: blur(1px)) {
  .glass { background: color-mix(in srgb, var(--color-panel) 100%, white 26%); }
  [data-theme='dark'] .glass { background: color-mix(in srgb, var(--color-panel) 100%, black 42%); }
}
```

- [ ] **Step 5: 셸 세 개를 글래스로**

`sidebar.tsx`(`bg-nav` → 글래스 패널), `header.tsx`, `system-bar.tsx`. 셋 다 지금 `bg-nav border-line-soft`를 똑같이 쓰므로 같이 바꾼다.
사이드바 활성 메뉴는 `bg-accent text-white`에서 **흰색 필**로: `bg-white/80 text-ink font-semibold shadow-sm`. (골드 배경 위 흰 글자 문제가 사라지므로 `globals.css`의 솔리드 보정 대상에서 빠진다 — 그래도 규칙은 남겨 둔다, 버튼들이 아직 쓴다.)

- [ ] **Step 6: 사이드바 하단 프로필**

지금 사이드바에는 프로필이 없고 헤더에 있다. 하단 `기업(A,B,C) 추가` 위에 프로필 블록을 넣는다: 아바타 원 + `홍석현` + `회장 · Edison S. Hong`.
영문 표기는 **지어내지 않는다** — `user_profiles.display_name_en`(0017이 만든 칸)을 읽고, 없으면 영문 줄을 아예 그리지 않는다. `Sidebar`는 지금 props가 없는 클라이언트 컴포넌트이므로, `(dashboard)/layout.tsx`가 이미 읽어 둔 `user`를 prop으로 내려 준다(레이아웃이 `currentUser()`를 한 번만 부르는 기존 구조를 깨지 않는다). `SessionUser`에 `display_name_en`이 없으면 `src/lib/auth/session.ts`에 더한다.

- [ ] **Step 7: `<html data-theme="light">`**

`src/app/layout.tsx`. 주석으로 왜 루트가 라이트인지, 다크는 어디서 켜지는지(`(morning)/layout.tsx`) 적는다.

- [ ] **Step 8: 검증**

`typecheck`·`lint`·`build`. 그리고 **회귀 확인**: `grep -c "bg-panel\|bg-raised\|text-ink"`의 총합이 작업 전후로 **같아야 한다** — 이 Task는 토큰 이름을 쓰는 자리를 늘리거나 줄이지 않는다. 숫자를 보고서에 적는다.

- [ ] **Step 9: 커밋** — `feat(ui): 블록 1 — 라이트/다크 토큰 2세트 + 글래스 카드 + 셸`

---

## P5-2: 대시보드 재배치

**Files:** `src/app/(dashboard)/page.tsx`, `src/components/dashboard/dday-hero.tsx`(신규), `src/components/layout/{header,world-clocks}.tsx`, `src/components/dashboard/*.tsx`(GlassCard 교체)

**Interfaces — Consumes:** `GlassCard`(P5-1), `ChairmanDdayCard`·`DashboardBoard`·`KpiStrip`·`FinanceTrend`·`AiNightPanel`(전부 기존, props 그대로)

- [ ] **Step 1: 헤더에 세계시간 칩**

`world-clocks.tsx`, 클라이언트. 서울·호치민·토론토·두바이를 `Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false})`로 그린다. **서버에서 그리지 않는다** — 서버는 UTC라 하이드레이션이 어긋난다. `useState(null)` + `useEffect`로 마운트 뒤에 채우고, 그 전에는 자리만 잡는다(레이아웃 점프 방지).
1분마다 갱신한다. `setInterval` 정리 필수.

- [ ] **Step 2: 히어로 2단**

좌 400px `DdayHero` + 우 `FinanceTrend`. `DdayHero`는 골드 그라데이션(`--color-dday-from/via/to`), 큰 D-day 숫자(`text-[56px]` 명조), 진행바, 이번 주 행동. 데이터는 기존 `ChairmanDdayCard`가 쓰던 것과 같다 — `repo.listChairmanProjects()`에서 `status==='Active'` 첫 건, `projectClock()`로 계산.
**그라데이션 위 글자는 어둡다**(`#1e1a16`) — 골드는 밝은 색이다. 대비비를 보고서에 적는다.

- [ ] **Step 3: 아래 순서 재배치**

회사 5개 카드 한 줄 → `KpiStrip` → 2단(좌 `InitiativeCards` 요약 / 우 400px AI 브리핑 다크 카드).
**AI 브리핑 카드만 다크다.** `data-theme="dark"`를 그 카드 래퍼에 건다 — 토큰이 하위 트리에서 뒤집히므로 안쪽 컴포넌트는 손대지 않아도 된다. 이 한 줄이 P5-1 토큰 설계가 맞았는지 증명하는 자리다.

- [ ] **Step 4: 기존 탭 스트립**

`TABS` 배열은 지금 동작하지 않는 장식이다(클릭 핸들러 없음). **건드리지 않는다** — 이 Task는 레이아웃과 껍데기만이고, 동작하지 않는 UI를 동작하게 만드는 것은 별도 결정이다. 보고서에 그대로 두었다고 적는다.

- [ ] **Step 5: 검증 + 커밋** — `feat(ui): 블록 2 — 대시보드 히어로 2단·세계시간·브리핑 다크 카드`

---

## P5-3: 이니셔티브 카드 그리드 + 로고 + 기획 칸

선행 계획의 Task 6·7·8을 합친다. 셋 다 같은 화면이고 `GlassCard` 위에 서므로 나누면 카드를 세 번 만진다.

**Files:** `src/components/initiatives/{initiative-logo,logo-upload,initiative-cards}.tsx`(신규), `src/app/(dashboard)/initiatives/page.tsx`, `.../[id]/page.tsx`, `src/components/initiatives/initiative-panel.tsx`, `src/app/actions/initiatives.ts`

**Interfaces — Consumes:** P5-A의 액션·`signInitiativeLogos`·`logoInitial`, P5-1의 `GlassCard`

- [ ] **Step 1: `InitiativeLogo`** — 40px. 로고 있으면 `<img>`(서명 URL), 없으면 제목 첫 글자 원형 배지. `next/image`를 쓰지 않는다(서명 URL이 1시간마다 바뀌어 최적화 캐시가 매번 빗나가고, 그 캐시에 비공개 이미지가 남는다). `alt=""` — 옆에 제목이 글자로 늘 함께 있다.
- [ ] **Step 2: `LogoUpload`** — 상세 상단. FormData로 보낸다(파일은 Server Action 인자로 직렬화되지 않는다). 낙관적 미리보기 없음 — 실패하면 화면에만 있는 로고가 남는다.
- [ ] **Step 3: `InitiativeCards`** — 3열 그리드. 카드 = 40px 로고 · 제목 · 유형·단계 뱃지 · goal 2줄(`line-clamp-2`) · 다음 행동 D-day 칩 · 갱신 N일. **14일 이상은 제목·메타·goal만 흐리게** — 카드 전체에 `opacity`를 걸면 하필 가장 급한 카드에서 빨간 D-day가 꺼진다(이 프로젝트가 세 번 반복한 실수).
- [ ] **Step 4: 목록 페이지** — 단계 필터 탭을 맨 위에. 서명 URL은 보이는 카드 전부를 **한 번에** 발급(`signInitiativeLogos(paths)`) — 카드마다 부르면 14장 그리드가 14요청이 된다. `withParams`는 임의 키를 받으므로(`src/lib/query.ts:11`) `stage`·`view`를 그대로 넣으면 된다. 기존 단계별 표는 `?view=table`로 남긴다.
- [ ] **Step 5: 기획 칸 확대** — `FieldEditor`의 textarea를 `rows` prop으로 받게 하고 `goal`은 6줄. 자동 확장은 `height='auto'` 후 `scrollHeight` (안 그러면 지울 때 안 줄어든다). **회장 메모는 이미 같은 `FieldEditor`를 쓰므로**(`initiative-panel.tsx:572-580`) 그 호출에 `rows={6}`만 더하면 따라온다 — 별도 textarea를 찾지 마라, 없다.
- [ ] **Step 6: `goal` 상한 500 → 2,000** — `actions/initiatives.ts`의 `GOAL_MAX`와 패널의 `GOAL_MAX_LENGTH`를 **같은 값**으로. 다르면 화면이 통과시킨 글을 서버가 거절한다. `initiatives.goal`은 `text not null default ''`라 마이그레이션이 필요 없다.
- [ ] **Step 7: 검증 + 커밋** — `feat(initiatives): 블록 3 — 로고·카드 그리드·기획 칸 확대`

---

## P5-5a: 0019 chairman_checkins

**Files:** `supabase/migrations/0019_chairman_checkins.sql`(신규), `src/types/checkin.ts`(신규), `src/lib/repository/{types,dummy,supabase}.ts`, `scripts/check-migrations.ts`

**Interfaces — Produces:**
```ts
interface ChairmanCheckin {
  checkin_date: IsoDate      // pk
  condition: 1|2|3|4|5
  sleep_hours: number | null // numeric(3,1)
  weight_kg: number | null   // numeric(4,1)
  meal_note: string
  updated_at: IsoDateTime
}
repo.getCheckin(date): Promise<ChairmanCheckin | null>
repo.saveCheckin(input, actor): Promise<ChairmanCheckin>
repo.listRecentCheckins(days: number): Promise<ChairmanCheckin[]>
```

- [ ] **Step 1: 마이그레이션.** `0017`·`0018`의 머리 주석 형식을 따른다. 표는 `chairman_manifesto`와 같은 성격이다 — **Chairman 전용**. `initiative_notes_all`과 같은 모양의 정책 하나:
  ```sql
  create policy chairman_checkins_all on chairman_checkins for all
    using (is_active() and auth_role() = 'Chairman')
    with check (is_active() and auth_role() = 'Chairman');
  ```
  AIAgent에게도 주지 않는다 — 야간 브리핑은 체크인 값을 **앱이 읽어 넘겨 준다**(P5-5d), 브리핑이 표를 직접 읽지 않는다. 그 이유를 주석에 적는다. `condition`에 `check (condition between 1 and 5)`.
  `[제한]`/`[Vault 성격]` 칸 태그를 단다 — 체중과 수면은 회장 개인 건강 기록이다.
- [ ] **Step 2: `check-migrations.ts` 단언.** Chairman은 쓰고 읽는다. GroupCFO·AIAgent·Member·BusinessCEO·Integration은 전부 못 읽고 못 쓴다. `as()` 계약대로 — 거부는 `assert.equal(..., 'denied')`, 읽기는 숫자. `as()`는 항상 롤백하므로 읽을 행은 `db.exec`로 미리 심는다.
- [ ] **Step 3: 계약 + 두 어댑터.** `supabase.ts`는 감사 먼저·바뀐 칸만. `dummy.ts`는 메모리 Map.
- [ ] **Step 4: 검증** — `check:migrations`·`check:boundaries`·나머지 전부. **의도적 파괴 실험**: 정책을 `auth_role() in ('Chairman','GroupCFO')`로 넓혀 GroupCFO 단언이 실패하는지 보고 되돌린다. 결과를 보고서에 적는다.
- [ ] **Step 5: 커밋** — `feat(db): 0019 — 회장 체크인(컨디션·수면·체중·식사)`

---

## P5-5b: 위치 + 날씨

**Files:** `src/lib/weather.ts`(신규), `src/lib/geo.ts`(신규), `src/components/morning/{weather-panel,use-geolocation}.tsx`(신규)

- [ ] **Step 1: `geo.ts`** — 관심 도시 좌표표(호치민·싱가폴·상하이·두바이·토론토·SF)와 Vercel 헤더 폴백:
  ```ts
  // Vercel이 엣지에서 채워 준다. 로컬 dev에는 없다 — 그때는 서울로 떨어진다.
  headers(): x-vercel-ip-latitude / x-vercel-ip-longitude / x-vercel-ip-city
  ```
  좌표를 **URL 쿼리에 싣지 않는다**. 서버 컴포넌트가 직접 읽는다.
- [ ] **Step 2: `weather.ts`** — Open-Meteo. 키 없음.
  ```
  https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,weather_code&timezone=auto
  ```
  여러 도시는 좌표를 콤마로 묶어 **한 번에** 부른다(Open-Meteo가 지원한다) — 도시마다 부르면 7요청이다.
  `fetch(url, { next: { revalidate: 1800 } })` — 30분 캐시.
  **실패해도 화면이 죽지 않는다.** `try/catch`로 `null`을 돌려주고 패널이 "날씨를 불러오지 못했습니다"로 떨어진다. 아침 화면이 외부 API 때문에 통째로 비는 일은 없어야 한다.
  `weather_code`(WMO) → 한국어 라벨 맵을 둔다. 날것의 숫자가 화면에 나가지 않는다.
- [ ] **Step 3: `use-geolocation.ts`** — 클라이언트. `navigator.geolocation.getCurrentPosition`. **먼저 묻지 않는다** — 사용자가 "현재 위치" 버튼을 눌렀을 때만 요청한다. 거부/실패/미지원이면 `null`을 주고 서버 폴백이 그대로 남는다.
- [ ] **Step 4: 검증** — `typecheck`·`lint`·`build`. 네트워크 호출은 빌드 때 일어나지 않는다(동적 렌더). Open-Meteo를 실제로 부르는 확인은 컨트롤러가 dev에서 한다.
- [ ] **Step 5: 커밋** — `feat(morning): 블록 5 — 위치 폴백 + Open-Meteo 날씨`

---

## P5-5c: `(morning)` 그룹 + 다크 셸 + 상단 3칸 + 2단 본문

이 계획에서 가장 큰 Task다.

**Files:** `src/app/(morning)/layout.tsx`(신규), `src/app/(morning)/ai/page.tsx`(이동), `src/components/layout/rail-sidebar.tsx`(신규), `src/components/morning/{greeting-clock,checkin-panel}.tsx`(신규)

- [ ] **Step 1: 라우트 그룹 이동.** `git mv "src/app/(dashboard)/ai" "src/app/(morning)/ai"`. URL은 `/ai` 그대로다(라우트 그룹은 경로에 안 나온다). **`PageProps<'/ai'>` 타입이 그대로 유효한지 `typecheck`로 확인한다** — Next 16의 타입 생성이 그룹 이동을 따라와야 한다.
- [ ] **Step 2: `(morning)/layout.tsx`.** `data-theme="dark"`를 최상위 div에 건다. 셸은 `(dashboard)/layout.tsx`와 같은 골격(`flex h-full` → 레일 → `flex-1 flex-col` → main)이되 사이드바가 76px 아이콘 레일이다. **`<main className="flex-1 overflow-y-auto">`를 유지한다** — P5-5c의 sticky 계산이 이 컨테이너에 걸린다.
- [ ] **Step 3: `RailSidebar`.** 76px. `NAV`의 `ready` 항목만 아이콘으로. 각 아이콘에 `title`과 `aria-label`(라벨 텍스트)을 단다 — 아이콘만 있는 내비게이션은 그것 없이는 읽히지 않는다. 활성 표시는 흰 필.
- [ ] **Step 4: 상단 3칸.** `grid-cols-3` (≤1024px에서 세로). 인사+큰 시계+세계시간 / 현재 위치 날씨 / 오늘 체크인. 셋 다 `GlassCard`.
  큰 시계도 **클라이언트에서 마운트 뒤에** 채운다(서버 UTC 하이드레이션 불일치).
- [ ] **Step 5: 체크인 패널.** 컨디션 1~5(버튼 5개), 수면 시간, 체중, 식사 메모. 저장은 Server Action → `repo.saveCheckin`. **Chairman이 아니면 이 칸을 아예 그리지 않는다** — `isChairman` 분기. 값으로 분기하면 GroupCFO에게 빈 칸이 보이고 그건 정보 누출이다(0017 회장 메모와 같은 판단).
- [ ] **Step 6: 본문 2단.** 좌 560px = D-day 카드 + 선언문(sticky) / 우 = 오늘·이번 주 + AI 브리핑(회사 탭). ≤1024px 세로.
  **sticky `max-h`는 `calc(100vh-8.5rem)`이다** — 스크롤 컨테이너가 window가 아니라 `<main>`이고, `<main>` 높이는 `100vh − Header h-14(3.5rem) − SystemBar h-12(3rem)`이다. 여기에 여백 2rem. `(morning)` 셸의 헤더·푸터 높이가 `(dashboard)`와 다르면 **그 값으로 다시 계산한다** — 이 숫자는 셸에 종속이고, 실제 앱에서 한 번 틀렸던 자리다.
- [ ] **Step 7: 검증 + 커밋** — `feat(morning): 블록 5 — /ai 다크 셸·아이콘 레일·상단 3칸·2단 본문`

---

## P5-5d: 체크인 → 야간 브리핑

**Files:** `src/lib/ai/night-brief.ts`, `src/lib/ai/prompts/daily-brief.md`, `src/lib/ai/adapter.ts`(타입)

- [ ] **Step 1: `chairman` 페이로드에 체크인을 더한다.** `night-brief.ts`가 `repo.listRecentCheckins(1)`로 오늘 것을 읽어 `chairman.checkin = { condition, sleep_hours } | null`로 싣는다. 체중·식사 메모는 **보내지 않는다** — 브리핑이 쓸 일이 없고, 모델에 넘기는 개인 정보는 적을수록 좋다. 그 이유를 주석에 적는다.
- [ ] **Step 2: `daily-brief.md`.** `chairman` 설명에 `checkin` 칸을 더하고, 출력 규칙에 한 줄:
  ```
  - chairman.checkin.condition이 2 이하면 summary의 **첫 문장**에 큰 결정을 오늘 미루라는 권고를 쓴다.
    그 다음에 평소의 "오늘 회장이 먼저 봐야 할 것"을 잇는다. condition이 없거나 3 이상이면 이 문장을 쓰지 않는다.
  ```
  **Task 1이 넣은 길이 상한(summary 5문장·items 7개·action 1문장)을 건드리지 않는다.** 권고 문장은 그 5문장 안에 든다 — 상한을 늘리면 잘림이 다시 온다.
- [ ] **Step 3: 검증.** `typecheck`·`lint`·`build`. **실제 모델 호출은 컨트롤러가 P5-7에서 한 번 돌린다**(production 쓰기라 승인이 필요하다).
- [ ] **Step 4: 커밋** — `feat(ai): 블록 5 — 컨디션 낮은 날 큰 결정 보류 권고`

---

## P5-6: 사이드바 워드마크 링크

원 지시의 마지막 줄. **별도 커밋**이다.

- [ ] **Step 1:** `src/components/layout/sidebar.tsx:33-35`의 워드마크 블록(`<div className="flex h-14 items-center gap-2 px-4">` + 왕관 아이콘 + `CHAIRMAN OS`)을 `<Link href="/">`로 감싼다. 지금은 평문이다.
  포커스 링과 hover를 준다 — 클릭 가능해졌다는 것이 보여야 한다. `aria-label`은 불필요하다(텍스트가 곧 이름이다).
  `(morning)`의 `RailSidebar`에도 같은 처리를 한다(아이콘만 있으므로 그쪽은 `aria-label="대시보드로"`가 필요하다).
- [ ] **Step 2: 커밋** — `feat(ui): 사이드바 워드마크를 눌러 대시보드로`

---

## P5-7: 검증 · 스크린샷 · 배포 (컨트롤러)

- [ ] **Step 1: 전체 검사**
```bash
npm run typecheck && npm run lint && npm run build \
  && npm run check:migrations && npm run check:db-safety \
  && npm run check:boundaries && npm run check:finance
```
하나라도 실패하면 여기서 멈춘다.

- [ ] **Step 2: 스크린샷 4장** — 대시보드 / 이니셔티브 / 캘린더 팝업 / 아침 루틴. 1440px.
  `.screenshots/`는 **gitignore다**(`.gitignore:22`) — `git add`해도 아무 일이 없다. 파일은 로컬에 두고 회장에게 대화로 보여 준다. 그 편이 맞다: 화면에 실제 의사결정과 재무 수치가 떠 있어 git에 들어갈 그림이 아니다.

- [ ] **Step 3: staging**
`npm run db:push:staging`. 이 스크립트는 인자를 받지 않는다 — 안에서 `check:migrations` → staging link 대조 → `db push --dry-run` → `db push --yes` → `migration list`를 차례로 돈다. 돌리기 전에 이 브랜치가 더한 마이그레이션이 **0018·0019 둘뿐**인지 `git log`로 확인한다.

⚠️ **가장 유력한 실패 지점:** 실제 Supabase에서 `storage.objects`의 소유자는 `supabase_storage_admin`이고 `postgres`에 대한 grant가 프로젝트 생성 시기마다 달랐다. 마이그레이션 역할이 `create policy on storage.objects`를 할 수 있는지는 원격에서만 안다. 실패하면 0018 전체가 롤백된다(`begin/commit`). 그때는 정책을 Supabase 콘솔에서 손으로 만들고, 마이그레이션에는 그 사실을 주석으로 남기는 길을 회장과 상의한다.

- [ ] **Step 4: staging 확인** — OPERATIONS §1의 배포 후 확인 4단계 + 이번 변경분:
  - 라이트 글래스가 전 화면에 깔렸는가, `/ai`만 다크인가
  - Member 계정으로 `/initiatives`가 비는가, 로고 서명 URL이 발급되지 않는가
  - GroupCFO에게 체크인 칸이 **안 보이는가**
  - Storage 버킷이 **비공개**인가 (콘솔에서 눈으로)
  - `storage.objects`에 이 버킷을 덮는 **다른 permissive 정책이 없는지** — 있으면 0018의 전제가 깨진다. 오프라인 검사로는 못 보는 것이다.
  - 로고 업로드 → 카드·상세에 표시 → 삭제
  - 야간 브리핑 수동 실행 1회 (컨디션 낮은 날 문장 확인은 체크인을 넣어 보고)

- [ ] **Step 5: production — 회장 승인 후에만**
OPERATIONS §9 순서: 승인 → **DB 먼저** (`supabase link --project-ref nndvspgnljivkvihxlzj` → `supabase db push`, 전용 npm 스크립트는 일부러 없다) → 앱 배포 → 배포 후 확인 4단계 → 작업 디렉터리 link를 `npm run db:push:staging`으로 staging에 되돌린다.
0018·0019 둘 다 additive(`add column if not exists`, 새 표, 새 버킷)라 구버전 앱과 호환된다 — 앱 롤백이 DB 롤백을 요구하지 않는다.

---

## Self-Review

**스펙 커버리지**

| 원 지시 | Task |
|---|---|
| 블록 0 브리핑 수정 + 수동 실행 확인 | ✅ 완료 (`00e8d94`) |
| 블록 1 토큰 2세트 | P5-1 Step 1-3 |
| 블록 1 글래스 프리미티브 + 폴백 | P5-1 Step 4 |
| 블록 1 사이드바(글래스·흰 필·하단 프로필) | P5-1 Step 5-6 |
| 블록 2 헤더(검색·세계시간·날씨·알림) | P5-2 Step 1 (날씨 칩은 P5-5b 뒤에 붙는다) |
| 블록 2 히어로 2단 | P5-2 Step 2 |
| 블록 2 회사카드→KPI→이니셔티브+브리핑 | P5-2 Step 3 |
| 블록 3 로고 + 버킷 | ✅ 0018 완료 + P5-A(앱 층) |
| 블록 3 카드 그리드 3열 | P5-3 Step 3-4 |
| 블록 3 기획 칸 6줄 자동확장 | P5-3 Step 5-6 |
| 블록 4 캘린더 팝업 | ✅ 완료 (`130f8ff`,`b4874e3`) |
| 블록 5 `/ai` 다크 + 아이콘 레일 | P5-5c Step 1-3 |
| 블록 5 상단 3칸 | P5-5c Step 4-5 |
| 블록 5 위치·날씨 | P5-5b |
| 블록 5 체크인 표 | P5-5a |
| 블록 5 컨디션→브리핑 | P5-5d |
| 블록 5 본문 2단 + 1024px | P5-5c Step 6 |
| 사이드바 로고 Link (별도 커밋) | P5-6 |
| 스크린샷 4장 → staging → production | P5-7 |

**타입 일관성**
- `GlassCard`의 prop 이름(`as`/`tone`/`padding`)은 P5-1이 정의하고 P5-2·P5-3·P5-5c가 그대로 쓴다.
- `ChairmanCheckin`은 P5-5a가 정의하고 P5-5c(패널)·P5-5d(브리핑)가 읽는다. `condition`은 `1|2|3|4|5` 리터럴 유니온 — 브리핑 프롬프트의 "2 이하" 판정이 여기 걸린다.
- 로고 3메서드는 P5-A가 정의하고 P5-3이 쓴다. `signInitiativeLogos`의 반환은 `Record<경로,URL>`이고 읽는 쪽은 늘 `i.logo_url ? logos[i.logo_url] : undefined`.
- sticky `max-h` 값은 P5-5c가 자기 셸 높이로 **다시 계산한다**. `(dashboard)`의 8.5rem을 그대로 베끼지 않는다.

**미검증 — 실행자가 해당 Step에서 먼저 확인할 것**
- Tailwind v4가 `[data-theme]` 아래 `--color-*` 재정의를 실제로 따르는가 (P5-1 Step 1에서 바로 드러난다)
- Next 16에서 라우트 그룹을 옮겼을 때 `PageProps<'/ai'>`가 유효한가 (P5-5c Step 1)
- Open-Meteo가 좌표 여러 개를 콤마로 받는가 (P5-5b Step 2 — 안 되면 도시별 호출 + 캐시로 떨어진다)
- `SessionUser`에 `display_name_en`이 있는가 (P5-1 Step 6)

---

## 부록 A — 원 지시 (2026-09-19, Chairman)

```
[Phase 5 — 글래스 리디자인 + 4-A 다듬기]

방향: 아침 루틴(/ai)만 다크 글래스, 나머지 전부 라이트 웜 글래스.
명조(Noto Serif KR) 헤드라인·골드 강조 유지.
Subagent 구동. 블록마다 커밋. 회귀 없음: typecheck·lint·check:* 전부 통과.

블록 0 — 브리핑 실패 수정 (먼저)
블록 1 — 디자인 토큰 2세트 + 글래스 프리미티브
블록 2 — 대시보드 재배치
블록 3 — 이니셔티브 로고 + 그리드
블록 4 — 캘린더 팝업
블록 5 — 아침 루틴 (다크) + 위치·날씨·체크인

검증: 스크린샷 4장 → staging push → production push (0018 먼저, 코드 나중) → 커밋.
사이드바 상단 "Chairman OS" 로고를 클릭하면 대시보드(/)로 이동하게 Link로 감싸라.
지금 작업 끝난 뒤 별도 커밋.
```
(전문은 세션 기록에 있다. 위는 블록 제목만 추린 것이고, 각 블록의 세부 항목은 해당 Task 본문에 옮겨 두었다.)

**원 지시와 저장소가 어긋나는 지점**
- `chairman_checkins`를 "0018에"라고 했으나 0018은 이미 로고용으로 커밋·보안 리뷰 완료다. **0019 신설**로 확정(P-8).
- "사이드바 하단 프로필"은 지금 없다 — 사용자 정보는 헤더에 있다. 새로 만든다. 영문 표기는 `user_profiles.display_name_en`(0017)을 읽고, 없으면 그 줄을 그리지 않는다.
- "`/ai` 레이아웃 data-theme=dark"는 중첩 레이아웃으로는 사이드바를 대체하지 못한다. **라우트 그룹을 `(morning)`으로 옮긴다**(P-10).
