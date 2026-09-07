# Chairman OS

그룹 통합 관제 화면. 회장 한 사람이 아침에 열어서 **오늘 무엇을 결정해야 하는가**를
한 판에 보는 것이 이 앱의 전부다.

다섯 회사(DY · VANA AI · Sticky Alliance · HOF Robotics · Boram Life)의 숫자와 업무를
한 화면에 모으고, 그 위에 결재·문서·검색·권한을 얹었다.

> 이 문서는 **처음 오는 사람**이 읽는다.
> 운영 절차는 [OPERATIONS.md](./OPERATIONS.md), 인수인계는 [HANDOVER.md](./HANDOVER.md)를 본다.

---

## 1. 5분 안에 띄우기

```bash
npm install
cp .env.example .env.local     # 값은 아래 3번 참고
npm run dev                    # http://localhost:3000
```

`.env.local`을 그대로 두면(`NEXT_PUBLIC_DATA_MODE=dummy`) Supabase 없이도 뜬다.
시드 JSON(`src/data/*.json`)을 읽어 화면을 그리고, 로그인도 요구하지 않는다.
화면 어딘가에 **DUMMY DATA** 뱃지가 떠 있으면 지금 보고 있는 숫자가 실적이 아니라는 뜻이다.

실데이터로 보려면 3번의 Supabase 키를 채우고 `NEXT_PUBLIC_DATA_MODE=live`로 바꾼다.
live인데 키가 비어 있으면 앱이 **시작할 때 에러를 던진다.** 조용히 dummy로 떨어지지 않는다 —
그러면 화면에 시드 숫자가 뜨는데 뱃지는 사라져서, 보는 사람이 그걸 실적으로 읽는다.

### 명령어

| 명령 | 무엇을 하나 |
|---|---|
| `npm run dev` | 개발 서버. Next 16 + Turbopack |
| `npm run build` | 프로덕션 빌드. 타입 검사가 여기 포함된다 |
| `npm start` | 빌드 결과 실행 |
| `npm run typecheck` | `tsc --noEmit` 만 |
| `npm run lint` | ESLint |
| `npm run gen:seed` | `src/data/*.json` → `supabase/migrations/0003_seed.sql` 재생성 |

---

## 2. 무엇이 어디에 있나

```
src/
  app/
    layout.tsx              폰트·문서 껍데기만. 관제 셸은 여기 없다
    globals.css             디자인 토큰 전부(색·폰트). 색을 바꾸려면 여기 한 곳
    proxy.ts  ← src/        Next 16의 middleware. 미로그인 → /login
    login/                  관제 셸 밖에 있는 유일한 화면
    (dashboard)/
      layout.tsx            사이드바 + 헤더가 붙는 셸
      page.tsx              메인 대시보드 (CH-001~019)
      approvals/            전자결재 (CH-041)
      business/[id]/        회사 상세 + 전략 좌표 (CH-023~024)
      tasks/                업무 목록 (CH-040)
      tasks/[id]/           업무 단건 (CH-040 / CH-017)
      projects/[id]/        프로젝트 단건 (CH-020)
      documents/            문서관리 (CH-042)
      settings/users/       사용자·권한 (CH-049)
      coming-soon/          아직 없는 메뉴 13개가 모두 여기로 온다
    actions/                Server Action. 쓰기는 전부 여기를 지난다
    api/health/             Supabase·스키마·RLS 상태 점검

  components/               화면 조각. 폴더는 화면 단위로 나뉜다
  lib/
    repository/             ★ 화면과 데이터 사이의 유일한 계약
      types.ts              인터페이스(Port). 화면은 이것만 본다
      supabase.ts           live 어댑터
      dummy.ts              dummy 어댑터
      index.ts              둘 중 무엇을 쓸지 정하는 유일한 자리
    auth/                   세션·역할
    supabase/               클라이언트 생성(서버/브라우저/proxy 세 종류)
    format.ts               숫자·날짜 표기. 숫자는 전부 여기를 지난다
    audit-log.ts            감사 기록 역조회의 어휘
    nav.ts                  사이드바 메뉴 정의
  data/                     시드 JSON (06_Dummy_Data에서 내린 값)
  types/                    도메인 타입

supabase/
  migrations/               0001~0011. 번호순으로 적용된다
  bootstrap/                첫 회장 계정을 심는 수동 SQL (db push가 집지 않는다)
  vault_columns.md          Vault 문서를 어떻게 다루기로 했는가
```

### 읽는 순서

처음 오는 사람에게 권하는 순서다.

1. `src/lib/repository/types.ts` — 이 앱이 다루는 데이터 전부가 한 파일에 있다.
2. `supabase/migrations/0002_rls.sql` 머리 주석 — 권한이 어떻게 걸리는지.
3. `src/app/(dashboard)/page.tsx` — 대시보드가 무엇을 불러 무엇을 그리는지.
4. 관심 있는 화면 하나. 파일 머리 주석에 **왜 이렇게 만들었는가**가 적혀 있다.

---

## 3. 환경변수

`.env.example`을 복사해 `.env.local`을 만든다. **`.env.local`은 커밋하지 않는다.**

| 변수 | 필수 | 무엇이고 왜 필요한가 |
|---|---|---|
| `NEXT_PUBLIC_DATA_MODE` | ○ | `dummy` \| `live`. dummy면 `src/data`의 시드를, live면 Supabase를 읽는다. **dummy일 때만 화면에 DUMMY DATA 뱃지가 뜬다** — 그 뱃지가 "이건 실적이 아니다"라고 말하는 유일한 자리다. 값이 없으면 dummy로 본다(실데이터라고 잘못 말하는 쪽이 훨씬 위험하다). |
| `NEXT_PUBLIC_SUPABASE_URL` | live | 프로젝트 URL (`https://xxxx.supabase.co`). **끝에 `/rest/v1`을 붙이지 않는다** — SDK가 붙인다. 붙이면 `/rest/v1/rest/v1`으로 나간다. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | live | publishable key(`sb_publishable_…`) 또는 구형 프로젝트의 anon key(JWT). **브라우저에 노출돼도 되는 값이다** — 행 단위 접근은 전부 RLS가 판정한다(`0002_rls.sql`). 이 키만으로는 아무 행도 못 읽는다. |
| `SUPABASE_DB_PASSWORD` | 마이그레이션 | `supabase db push` 실행용. **애플리케이션 런타임은 이 값을 쓰지 않는다**(05_Architecture 6. Production DB 직접 접근 금지). CI에 넣을 때도 마이그레이션 잡에만 준다. |

### service_role key는 이 프로젝트에 없다

일부러 없다. 야간 AI Job(CH-045~048)도 권한 매트릭스의 **AI Agent 역할**로 인증해서
RLS 안에서 돈다. service_role은 RLS를 통째로 우회하는 키라, 한 번 들어오면
"이 앱이 무엇을 볼 수 있는가"의 답이 코드로 옮겨 간다 — 지금은 그 답이 DB에만 있다.

이 결정 때문에 앱에서 초대 메일을 직접 보내지 못한다. 대신 절차를 둘로 나눴다 →
[OPERATIONS.md의 계정 초대](./OPERATIONS.md#3-계정-초대)

---

## 4. 데이터가 흐르는 길

```
화면 (Server Component)
   │  repo.listTasks()  — 인터페이스만 안다
   ▼
lib/repository/index.ts     ← DATA_MODE로 어댑터를 고르는 유일한 자리
   ├─ dummy.ts    → src/data/*.json          (메모리. 서버가 살아 있는 동안만)
   └─ supabase.ts → PostgREST → Postgres     (RLS가 행을 거른다)

쓰기
화면 (Client Component)
   │  Server Action 호출
   ▼
app/actions/*.ts            ← 세션 확인 + 입력 검증 + revalidatePath
   │  repo.updateTask(...)
   ▼
supabase.ts  → audit_log INSERT  → 대상 테이블 UPDATE
               (기록이 먼저다. 상태만 바뀌고 기록이 없는 순간이 감사 구멍이다)
```

**권한 판정은 앱에 없다.** 화면도 Server Action도 "이 사람이 이걸 봐도 되나"를 묻지 않는다.
로그인한 본인의 세션으로 DB에 붙고, 안 되면 RLS가 거부한다. 앱에서 한 번 더 거르면
판정하는 자리가 두 곳으로 갈라져서, 둘이 어긋나는 날 어느 쪽이 맞는지 알 수 없게 된다.

---

## 5. 상태 점검

`GET /api/health` — 로그인 없이도 열린다. 로그인이 깨졌을 때도 무엇이 고장났는지 봐야 해서다.

두 번 센다.

- **anon** — 세션 없이 publishable key로만. 0002가 Default Deny라 **전부 0이어야 한다.**
  0이 아니면 그 테이블 정책이 익명에게 열려 있다는 뜻이다.
- **session** — 요청한 사람의 쿠키로. Chairman이면 0003이 넣은 519행이 그대로 보여야 한다.

한쪽만 재면 "다 0이다"가 RLS가 막은 건지 데이터가 없는 건지 구분되지 않는다.

---

## 6. 같이 보는 문서

| 문서 | 누가 읽나 |
|---|---|
| [OPERATIONS.md](./OPERATIONS.md) | 배포·마이그레이션·계정을 다루는 사람 |
| [HANDOVER.md](./HANDOVER.md) | 이 코드를 넘겨받는 사람 |
| [../CLAUDE.md](../CLAUDE.md) | 데이터 원칙(짧다. 먼저 읽는다) |
| [../DEFERRED.md](../DEFERRED.md) | 아직 결정되지 않은 것과 그 이유 |
| [UAT_RESULT_2026-09-07.md](./UAT_RESULT_2026-09-07.md) | 지금 무엇이 되고 무엇이 안 되나 |

---

## 7. 코드를 읽을 때

파일 머리 주석이 **무엇을 하는가**보다 **왜 이렇게 했는가**를 적고 있다.
같은 걸 다르게 만들고 싶어질 때 그 주석을 먼저 읽는다 — 대개 이미 한 번 시도해 보고
되돌린 이유가 적혀 있다.

`AGENTS.md`가 경고하듯 이 프로젝트의 Next.js는 **16.x**다. `middleware.ts`가 `proxy.ts`가
됐고 라우트 타입이 자동 생성된다. 기억에 있는 Next와 다르면
`node_modules/next/dist/docs/`를 먼저 본다.
