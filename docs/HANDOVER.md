# HANDOVER — 이 코드를 넘겨받는 사람에게

외주로 이어받는 개발자가 읽는 문서다. **어떻게 만들었나**보다 **왜 이렇게 만들었나**와
**무엇을 하면 안 되나**를 적었다. 앞의 것은 코드가 이미 말하고 있다.

> 띄우는 법은 [README.md](./README.md), 운영 절차는 [OPERATIONS.md](./OPERATIONS.md).

---

## 1. 이 앱이 무엇인가

**회장 한 사람이 아침에 열어서 "오늘 무엇을 결정해야 하는가"를 보는 화면.**

이 한 문장이 거의 모든 설계 판단의 근거다. 무엇을 넣을지 말지 헷갈릴 때 여기로 돌아온다.

- 회장이 **결정하는 데 쓰지 않는 정보**는 대시보드에 올리지 않는다.
- 정상 데이터는 조용히 두고 **위험과 승인 대기만 색으로** 올린다(요구사항서 2번).
  화면 전체가 알록달록하면 어디가 급한지 안 보인다.
- 숫자는 **읽는 자리에서 계산하지 않는다.** D-Day는 마감일에서 계산하고, 억 단위 표기는
  `lib/format.ts`를 거친다. 같은 숫자가 두 화면에서 다르게 보이는 순간 화면 전체를 못 믿는다.

### 층 나눔 (05_Architecture)

| 층 | 무엇을 하나 | 어디 있나 |
|---|---|---|
| Layer 1 | 각 회사의 Business OS. 업무를 **쓰는** 곳 | 이 저장소 밖 (Phase 2) |
| **Layer 2** | **Chairman OS. 모아 보고 결정하는 곳** | **이 저장소** |
| Layer 3 | AI Overnight Workforce | Phase 2 (CH-045~048) |

이 구분이 실제 코드 제약으로 나타난다. 예를 들어 업무의 담당자·제목·마감을
Chairman OS에서 **고칠 수 없다**. 버그가 아니라 층 나눔이다 → D-18.

---

## 2. 아키텍처 — 지켜야 할 다섯 가지

### ① 권한 판정은 DB에만 있다

화면도 Server Action도 "이 사람이 이걸 봐도 되나"를 묻지 않는다. 로그인한 본인의 세션으로
DB에 붙고, 안 되면 RLS가 거부한다.

```ts
// app/actions/tasks.ts — 이게 전부다
const user = await currentUser()
if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
await repo.updateTask(taskId, patch, { user_id: user.user_id, role: user.role })
// 담당자도 승인권자도 아니면 0002의 tasks_write가 거부한다
```

**앱에서 한 번 더 거르지 않는다.** 거르면 판정하는 자리가 두 곳으로 갈라지고,
둘이 어긋나는 날 어느 쪽이 맞는지 알 수 없게 된다. `actor`를 인자로 받는 것도 같은 이유다 —
어댑터가 세션을 또 읽으면 같은 요청 안에서 같은 질문을 두 번 하게 된다.

### ② 화면은 repository 인터페이스만 본다

```
화면  →  ChairmanRepository (lib/repository/types.ts)  →  dummy | supabase
```

화면 컴포넌트는 뒤에 JSON 시드가 있는지 Supabase가 있는지 **알 수 없어야 하고 알 필요도 없다.**
그래야 Phase 2에서 실데이터가 붙을 때 컴포넌트를 한 줄도 안 고친다.

계약의 함수는 **전부 async**다. dummy 어댑터는 동기로 끝나지만 시그니처까지 동기로 두면
live로 바꾸는 날 호출부를 전부 다시 써야 한다.

**URL을 repository가 만들지 않는다.** '무엇을 찾았나'까지가 어댑터의 일이고,
'그래서 어디로 가나'는 `lib/search.ts`의 `hitHref()`가 정한다. 어댑터가 URL을 만들기 시작하면
화면 구조를 바꿀 때 데이터 계층을 같이 고쳐야 한다.

### ③ 기록이 먼저, 상태가 나중

```ts
await sb.from('audit_log').insert({ ... })   // 먼저
await sb.from('tasks').update(after)          // 나중
```

순서가 뒤집힌 실패(**기록은 남고 상태는 안 바뀜**)가 가능하다. 그쪽을 일부러 택했다.
반대로 하면 '상태만 바뀌고 기록이 없는 순간'이 생기고, 그게 감사 구멍이다.
`audit_log`는 append only라 그 줄을 지울 수도 없고 지워서도 안 된다 —
**'승인을 시도했다'는 사실 자체가 기록 대상이다.**

`before`/`after`에는 **바뀌는 칸만** 넣는다. 행 전체를 남기면 무엇이 달라졌는지
읽는 사람이 다시 비교해야 한다.

### ④ 필터는 URL에 둔다

localStorage 저장소를 두지 않기로 했고, 필터가 걸린 화면을 그대로 남에게 보낼 수 있어야 한다.
"biz_dy의 Blocked 업무를 봐 달라"가 링크 한 줄이 된다(`lib/query.ts`).

값이 없으면 키를 아예 뺀다. `?status=`가 붙은 URL과 안 붙은 URL이 같은 화면을 뜻하면
지금 어느 탭이 켜져 있는지 판정하는 자리가 두 곳으로 갈라진다.

### ⑤ 없는 것과 못 보는 것을 구분하지 않는다

```ts
const task = tasks.find((t) => t.task_id === id)
if (!task) notFound()      // 없는 업무도 404, 권한 밖 업무도 404
```

'있지만 권한이 없다'고 말해 주는 것 자체가 그 행의 존재를 알려 주는 일이다.

---

## 3. RLS 구조

전부 `supabase/migrations/0002_rls.sql` 한 파일에 있다. 머리 주석에
05_Architecture 원칙 8개가 각각 어디서 지켜지는지 대응표가 있다.

### 기본 형태

**모든 표에 `ENABLE + FORCE ROW LEVEL SECURITY`.** 정책이 없는 동작은 전부 거부다.
'로그인했으니 읽기'는 없다 — 정책마다 역할을 열거한다.

### 판정 함수 (여기만 고치면 전 표가 같이 움직인다)

| 함수 | 무엇을 답하나 |
|---|---|
| `auth_profile()` | 지금 세션의 `user_profiles` 행 |
| `auth_role()` | 그 사람의 역할(9종 enum) |
| `is_active()` | `revoked_at`이 비어 있나 — **원칙 8의 핵심** |
| `has_group_scope()` | 전사 역할인가 (Chairman / GroupCFO) |
| `has_business(target)` | 그 회사를 볼 수 있나 — **Business Isolation은 이 함수 하나로만 판정한다** |
| `can_module(target, write)` | 그 모듈을 읽/쓸 수 있나 |
| `can_approve()` | 결재할 수 있나 |
| `can_keep_books(target)` | 그 회사의 계정과목·전표를 쓸 수 있나 — Chairman · GroupCFO · 자기 회사 BusinessCEO (0016) |
| `can_close_books()` | 월 마감을 할 수 있나 — Chairman · GroupCFO (0016) |
| `max_class()` / `class_rank()` | 볼 수 있는 최고 보안등급 |

### 역할 9개

`Chairman` · `GroupCFO` · `BusinessCEO` · `Executive` · `TeamLead` · `Member` ·
`ExternalExpert` · `Vendor` · `AIAgent`

역할은 **`auth.users`가 아니라 `user_profiles`에** 있다. 권한 판정의 단일 출처다.

### 권한 회수는 한 줄

`user_profiles.revoked_at`을 채우면 `is_active()`가 거짓이 되고, `has_business()`도 거짓이라
**전 테이블이 동시에 닫힌다.** `user_business_access`는 지우지 않는다 — 지울 필요가 없고,
지우면 되돌릴 때 그 사람이 어느 회사를 보고 있었는지가 사라진다.

### 특별한 두 표

- **`documents`** — Row(회사)와 Field(보안등급) 판정이 같이 걸리는 유일한 표.
  `class_rank(security_class) <= class_rank(max_class())`
- **`audit_log`** — `INSERT`/`SELECT` 정책만 있다. `UPDATE`/`DELETE`는 정책 자체를 안 만들어
  Default Deny로 막힌다. 트리거와 `REVOKE`까지 합쳐 3중이다. 읽는 것도 Chairman만.

### 표를 새로 만들면

**같은 파일에 RLS 정책도 같이 쓴다.** 안 쓰면 아무도 못 읽는 표가 되는데,
에러가 아니라 **조용히 빈 화면**으로 나타나서 원인을 찾기 어렵다.

---

## 4. 데이터 원칙 (CLAUDE.md)

짧지만 전부 지켜야 하는 것들이다.

1. **VANA EBITDA는 시트값 +2.8억 유지.** 계산해서 덮어쓰지 않는다.
   원장이 없는 회사·달은 `finance_kpis` 뷰가 시트 행을 수기 꼬리표로 내보낸다(0015 ③) → D-01.
2. **`06_Dummy_Data` = 숫자 원천, `03_UX_UI` PNG = 레이아웃 참고.
   숫자가 충돌하면 항상 시트가 이긴다** → D-03.
3. **야간 AI Job은 AI Agent 역할로 인증해 RLS 안에서 돈다. service_role은 없다.**
4. **Vault 문서의 파일 실체는 사내 스토리지에 두고 Chairman OS는 링크만 보관한다**
   (`supabase/vault_columns.md` 선택지 B). Vault 등급일수록 실체가 이 DB에 없어야 한다.
5. **회계 원천은 자체 장부다. ECOUNT는 DY 엑셀 업로드로만 들어온다** (Phase 2-B, D-19 해소).
   전표 입력(`/finance/[id]/journal`) → 월 마감(`close_period`) → 확정. 차대가 맞지 않는 전표는 DB가 받지 않는다.
   꼬리표: 원장 표(전표·결산)는 ECOUNT든 자체 장부든 마감 전 **잠정**, 마감 후 **확정**. 시트 행만 **수기**다.
6. **이니셔티브(0017)는 `projects`도 `chairman_projects`도 아니다.** `projects`는 회사에 속하고
   진행률(`progress_pct`)을 사람이 올린다. `chairman_projects`(0014)는 회장의 몇 년짜리 한 줄
   목표다. 이니셔티브는 회사 다섯 곳 **밖에서** 회장이 직접 굴리는 딜·신사업·투자유치·법인
   설립이다 — `business_id`가 없을 수 있고, '진행'이 진행률이 아니라 단계(`stage`: 기획→접촉→
   협상→실행→완료/중단)로 움직이며, `next_action`/`next_action_date` 세 칸이 표의 존재 이유다
   (다음에 뭘 하기로 했는지가 없으면 목록일 뿐이다). 세 표를 하나로 합치면 이 세 성격이 뒤섞인다.
   읽고 쓰는 사람은 **Chairman·GroupCFO 둘뿐**이고 AIAgent는 읽기만 한다(나머지 역할은 존재
   자체를 모른다) — 회사 데이터가 아니라서 BusinessCEO에게 자기 회사 딜을 보여 주면
   '회장이 그 회사를 어떻게 하려는지'가 같이 드러난다. 회장 메모(`initiative_notes`)는 그
   둘 중에서도 **Chairman 전용**이다 — Postgres RLS는 행 단위라 한 표 안에서 칸 하나만 GroupCFO
   에게 가릴 방법이 없다(`chairman_manifesto`와 같은 이유, 0014) → DEFERRED D-23~D-26.

---

## 5. 하지 말 것

넘겨받은 사람이 **선의로** 하기 쉬운 것들이다. 전부 한 번씩 검토했고 안 하기로 한 것이다.

### 🚫 service_role key를 도입하지 않는다

가장 하기 쉬운 실수다. 초대 메일 하나 보내려고 넣고 싶어진다.
RLS를 통째로 우회하는 키라 한 번 들어오면 "이 앱이 무엇을 볼 수 있는가"의 답이
DB에서 코드로 옮겨 간다. 필요하면 **초대 전용 Edge Function 하나로 좁히는 것이 D-15의 (B)안**이고,
그건 회장 결정 사항이다. 혼자 정하지 않는다.

### 🚫 앱에서 권한을 한 번 더 검사하지 않는다

"방어적으로 한 번 더" 하고 싶어진다. 판정이 두 곳으로 갈라지는 순간
둘이 어긋나는 날 어느 쪽이 맞는지 알 수 없다.

### 🚫 `audit_log`를 지우거나 고치지 않는다

테스트 중 만든 기록도 남긴다. 지우는 경로를 만들고 싶어지면, 그건 지워서는 안 되는 것이다.
(실제로 UAT에서 만든 `biz_uat_probe`의 감사 기록이 지금도 남아 있다. 정상이다.)

### 🚫 `0003_seed.sql`을 손으로 고치지 않는다

생성 파일이다. `src/data/*.json`을 고치고 `npm run gen:seed`로 다시 만든 뒤 둘을 같이 커밋한다.

### 🚫 마감된 달의 장부를 고치지 않는다 (마감 해제 경로도 만들지 않는다)

`closings`에는 update/delete 정책이 없고, 전표 라인은 사람이 `closed` 한 칸만 바꿀 수 있다(0016 `journal_lines_close_guard`).
잘못 마감했으면 **당월에 정정 전표**를 넣고 당월을 마감한다. 원 전표는 그대로 남아 무엇을 왜 고쳤는지가 장부에 선다.
'마감 취소' 버튼을 만들고 싶어지면, 확정 숫자가 조용히 바뀌는 길을 여는 것이다.

### 🚫 이미 적용된 마이그레이션을 고치지 않는다

고쳐도 다시 돌지 않는다. 파일이 말하는 스키마와 실제 DB가 달라진다. 새 번호로 추가한다.

### 🚫 `localStorage`에 업무 데이터를 두지 않는다

한 번 그랬다가 되돌렸다. CH-051이 '삭제 불가'를 요구하는 기록을 사용자가 언제든 지울 수 있는
곳에 두는 셈이었다. 지금 기록은 `audit_log`가, 개인 화면 설정은 `user_settings`가 갖는다.

### 🚫 화면 컴포넌트에서 시드(`src/data`)를 직접 읽지 않는다

live 모드 화면에 시드 회사명이 섞여 나온다. `lib/lookup.ts`·`lib/finance.ts`가
인자로 받는 모양인 이유가 이것이다.

### 🚫 디자인 토큰 이름을 바꾸지 않는다

`globals.css`의 `--color-*` 이름을 컴포넌트 42개 파일이 948곳에서 쓴다.
색을 바꾸고 싶으면 **값만** 바꾼다. 이름을 건드리면 전면 수정이 된다.

### 🚫 `NEXT_PUBLIC_DATA_MODE`를 조용히 dummy로 떨어뜨리지 않는다

live인데 키가 없으면 앱이 **시작할 때 에러를 던지는 것이 정상 동작이다.**
fallback을 넣으면 화면에 시드 숫자가 뜨는데 DUMMY DATA 뱃지는 사라져서,
회장이 그걸 실적으로 읽는다.

### 🚫 Next.js를 기억으로 쓰지 않는다

**이 프로젝트는 Next 16.x다.** `middleware.ts`가 `proxy.ts`가 됐고(위치도 `src/` 바로 아래),
라우트 타입(`PageProps<'/tasks/[id]'>`)이 자동 생성된다.
`node_modules/next/dist/docs/`를 먼저 본다. `AGENTS.md`가 같은 경고를 한다.

---

## 6. 화면 하나를 고칠 때 — 어느 파일을 순서대로 여나

**예: 업무 화면에 칸을 하나 더 보여 주고 싶다**

1. `src/types/domain.ts` — 그 칸이 타입에 있나
2. `src/lib/repository/types.ts` — 계약이 그 값을 내주나
3. `src/lib/repository/supabase.ts` — `select`에 컬럼이 들어 있나 (`*`로 안 부른다. 이유는 주석에)
4. `src/lib/repository/dummy.ts` — dummy도 같은 모양으로 답하나
5. 화면 파일 — 그리기
6. 값이 없으면 `supabase/migrations/00XX_*.sql` 새 번호로 컬럼 추가 **+ 정책 확인**

**예: 저장되는 값을 하나 더 받고 싶다**

1. `src/lib/repository/types.ts`의 `*Patch` / `New*` 타입
2. `src/app/actions/*.ts` — 입력 검증 (URL·폼은 사람이 손으로 고칠 수 있는 입력이다)
3. `supabase.ts`의 어댑터 — `audit_log` 기록에 그 칸이 들어가나
4. `0002_rls.sql`의 `*_write` 정책이 그 동작을 허용하나
5. `revalidatePath()` — 그 값이 보이는 **모든** 화면을 적었나

**예: 색을 바꾸고 싶다**

`src/app/globals.css` 한 곳. 토큰 값만 바꾼다.
바꾼 뒤 **대비를 잰다** — 웜 팔레트로 옮길 때 흰 글자가 황동 배경에서 2.23:1로 떨어졌다.
색이 밝아지면 그 위의 글자는 어두워져야 한다.

---

## 7. 지금 상태

`docs/UAT_RESULT_2026-09-07.md`가 기준이다. 요약하면:

- **되는 것** — 로그인·권한, 대시보드 전부(CH-001~019), 회사 상세·전략 좌표,
  업무 목록·단건, 프로젝트 단건, 전자결재(기안·처리·첨부), 문서관리, 통합검색,
  사용자 초대·권한 회수, 감사 기록.
- **Phase 2-B (2026-09-17)** — 자체 장부: 계정과목 관리(표준 계정과목표), 전표 입력(템플릿·차대 검사),
  월 마감(잠정 → 확정), 정정 전표(역분개 + 정정분개). `0016_books.sql`. dummy 모드에서 끝까지 확인했다.
- **안 되는 것** — DY ECOUNT 엑셀 업로드(실제 파일을 받으면 별도 블록), MES 연동, 외부 Staging 및 실제 복구 리허설.
  ECOUNT API 연동은 **하지 않기로** 했다(D-19).
  앞의 둘은 Phase 2 범위다. D-17 로컬 격리 workflow·합성 시드·검증 스크립트와 복구 절차는
  준비됐지만 CLI/Docker 실행은 미검증이다. [OPERATIONS 8~9절](./OPERATIONS.md#8-d-17--격리된-로컬-검증)을 따른다.
- **못 잰 것** — 두 번째 계정이 없어서 못 돌린 테스트 5건.
  회사 간 격리, Vault 등급 차단 같은 것들이다. **계정 하나만 만들면 그날 실행할 수 있다.**

### 남은 DEFERRED

| 항목 | 무엇이 | 급한가 |
|---|---|---|
| **D-17** | 로컬 workflow·복구 문서 준비. 실제 DB 검증·외부 staging·복원 리허설 필요 | **상** — 부분 준비, 배포 전 선행 |
| D-11 | 한국어 검색이 형태소가 아니라 부분 문자열 | 하 |
| D-18 | 업무 담당자·제목·마감을 여기서 못 고친다 | 하 — 의도된 경계 |

결정이 끝난 것(D-01~D-10, D-12~D-16)의 **근거는 전부 `DEFERRED.md`에 남아 있다.**
"왜 이렇게 했지" 싶은 것은 대개 거기 답이 있다. 코드 주석이 그 항목 번호를 가리키고 있다.

---

## 8. 코드를 읽는 요령

파일 머리 주석이 **무엇을 하는가**가 아니라 **왜 이렇게 했는가**를 적고 있다.
같은 걸 다르게 만들고 싶어질 때 그 주석을 먼저 읽는다 — 대개 한 번 시도해 보고
되돌린 이유가 적혀 있다.

주석에 `DEFERRED D-XX`, `CH-0XX`, `0002 tasks_write` 같은 참조가 나오면 그건 장식이 아니다.
각각 결정 근거 · 요구사항 항목 · RLS 정책 이름이고, 그 자리를 찾아가면 답이 있다.
