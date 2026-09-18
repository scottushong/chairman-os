# OPERATIONS — 배포 · 마이그레이션 · 계정

이 문서는 **운영하는 사람**이 읽는다. 코드를 고치지 않고 사람과 환경을 다루는 절차다.

> 앱을 처음 띄우는 법은 [README.md](./README.md), 구조를 이해하려면
> [HANDOVER.md](./HANDOVER.md)를 본다.

---

## 0. 먼저 알아야 할 것

**이 프로젝트에는 service_role key가 없다.** 운영 절차가 다른 Supabase 프로젝트보다
한 단계씩 더 걸리는 이유가 대부분 여기서 나온다. 없는 게 사고가 아니라 결정이다
([README 3번](./README.md#service_role-key는-이-프로젝트에-없다)).

**앱은 Production DB에 직접 붙지 않는다.** PostgREST로만 붙고, 붙은 뒤에도 RLS가 행을 거른다.
`SUPABASE_DB_PASSWORD`는 마이그레이션 전용이다 — 런타임 환경변수로 두지 않는다.

---

## 1. 배포

### 지금 상태

**D-17 부분 준비:** 로컬 격리·합성 시드·검증 명령과 복구 절차는 저장소에 있다(8~9절).
**외부 staging 프로젝트가 생겼다**(2026-09-18, Seoul `itpenmxyracfhyormcep`). 0001~0016이 들어가 있고
`npm run db:push:staging`으로 적용한다. 아직 남은 것은 staging 부트스트랩 계정, Vercel Preview 연결,
staging UAT, **실제 복원 리허설**이다.
TC-023·024를 Pass로 바꾸거나 production 배포를 승인한 상태는 아니다.

### 나가기 전에 반드시 통과해야 하는 것

```bash
npm run typecheck     # 타입
npm run lint          # 린트
npm run build         # 빌드 (타입 검사 포함)
```

셋이 다 통과해야 한다. `next build`는 라우트 타입도 다시 생성하므로,
**동적 라우트를 새로 만든 직후에는 build를 한 번 돌려야** `tsc`가 통과한다.

### 배포 후 확인 (순서대로)

1. `GET /api/health` — anon 쪽이 **전부 `rows: 0`, `rls_closed: true`** 인가.
   하나라도 0이 아니면 그 표의 정책이 익명에게 열려 있다. **즉시 되돌린다.**
2. 로그아웃 상태에서 `/`, `/approvals`, `/settings/users` — 전부 `/login`으로 튕기는가.
3. 로그인해서 대시보드에 회사 5개와 숫자가 뜨는가.
4. 화면에 **DUMMY DATA 뱃지가 없는가.** 있으면 `NEXT_PUBLIC_DATA_MODE`가 live가 아니다.

### 환경변수를 넣을 때

`NEXT_PUBLIC_*` 세 개는 **빌드 시점에 코드에 박힌다.** 배포 후에 바꾸면 반영되지 않는다 —
값을 바꿨으면 **다시 빌드해야 한다.**

`SUPABASE_DB_PASSWORD`는 런타임에 필요 없다. 마이그레이션을 돌리는 자리에만 준다.

### Vercel Preview를 staging Supabase에 붙인다

Vercel 프로젝트를 새로 만들지 않는다. 같은 프로젝트의 **Preview 환경만** staging DB를 보게 한다.
Production 배포는 건드리지 않는다.

Settings → Environment Variables에서 아래를 넣고, 각 변수의 Environment는 **Preview만** 체크한다
(Production 체크를 같이 켜면 운영이 staging DB를 보게 된다 — 이 실수가 이 절의 전부다).

| 변수 | Preview 값 |
|---|---|
| `NEXT_PUBLIC_DATA_MODE` | `live` |
| `CHAIRMAN_ENV` | `staging` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://itpenmxyracfhyormcep.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging publishable key |
| `AI_AGENT_EMAIL` · `AI_AGENT_PASSWORD` | staging 부트스트랩 ②에서 만든 계정 |
| `INTEGRATION_EMAIL` · `INTEGRATION_PASSWORD` | staging 부트스트랩 ③에서 만든 계정 |
| `ANTHROPIC_API_KEY` · `AI_MODEL` | staging 전용 키를 권한다 |
| `CRON_SECRET` | production과 **다른** 값 |

**`SUPABASE_DB_PASSWORD`는 Vercel에 넣지 않는다.** 앱 런타임이 쓰지 않는 값이고, 넣는 순간
마이그레이션 자격이 배포 환경에 상주한다(0절).

알아 둘 것:

- `NEXT_PUBLIC_*`은 빌드 시점에 박히지만 Preview 배포는 Preview 값으로 **따로 빌드**되므로 자동으로 맞는다.
  이미 만들어진 Preview 배포의 값을 바꿨다면 캐시 없이 Redeploy 한다.
- Preview는 기본적으로 production 브랜치가 아닌 **모든 브랜치**에 붙는다. 특정 브랜치만 원하면
  변수에 Branch를 지정한다.
- **Vercel Cron은 Production 배포에서만 돈다.** Preview에서 야간 브리핑은 저절로 돌지 않는다.
  staging에서 보려면 손으로 부른다:
  `curl -H "Authorization: Bearer <staging CRON_SECRET>" https://<preview-url>/api/cron/night-brief`
  Preview에 Deployment Protection이 켜져 있으면 bypass 토큰을 함께 보내거나 잠시 꺼야 한다.
- 로그인은 이메일+비밀번호(`signInWithPassword`)다. OAuth·매직링크가 없으므로 staging 프로젝트의
  Auth redirect URL 허용 목록은 건드릴 것이 없다.
- 붙었는지 보는 법은 배포 후 확인 4단계와 같다. `/api/health`가 staging 숫자를 내고
  화면에 DUMMY DATA 뱃지가 없으면 붙은 것이다.

---

## 2. 마이그레이션

### 파일

`supabase/migrations/` 에 `0001` ~ `0016`. 번호순으로 적용된다.

`0004`가 없는 것은 실수가 아니다. `supabase/bootstrap/0004_bootstrap_chairman.sql`이
그 번호를 이미 쓰고 있다. 그 파일은 `migrations/` 밖에 있어 `db push`가 집지 않는다 —
첫 회장 계정의 UID가 프로젝트마다 달라서 마이그레이션에 박아 넣을 값이 아니기 때문이다.

### 두 프로젝트

| 환경 | Supabase 프로젝트 ref | 리전 | 환경변수 파일 | 적용 방법 |
|---|---|---|---|---|
| staging | `itpenmxyracfhyormcep` | Seoul (ap-northeast-2) | `.env.staging.local` | `npm run db:push:staging` |
| production | `nndvspgnljivkvihxlzj` | Tokyo (ap-northeast-1) | `.env.local` | 9절 릴리스 절차(손으로, 승인 후) |

리전이 다른 것은 의도가 아니라 순서다 — production이 먼저 만들어졌다. 이전 계획은 DEFERRED D-22.

### 적용 — staging

이 PC에는 Docker가 없다. 마이그레이션은 원격 프로젝트에 `supabase link` 한 뒤 `supabase db push`로 적용한다.
**새 마이그레이션은 staging에 먼저 넣는다.** 명령 하나가 전부다:

```bash
npm run db:push:staging
```

Supabase CLI는 devDependency로 고정돼 있다(`supabase@2.117.0`). 따로 설치하지 않아도 되고,
처음 한 번은 `npx supabase login`이 필요하다. 스크립트가 순서대로 하는 일:

1. `.env.staging.local`을 읽는다. `.env.local`은 읽지 않는다.
2. `npm run check:migrations`(PGlite, 네트워크 없음)를 먼저 통과시킨다.
3. staging ref로 `supabase link`.
4. **link된 ref를 파일에서 다시 읽어 staging인지 대조한다.** 아니면 거기서 멈춘다.
5. `db push --dry-run` → `db push` → `migration list`.

**거부되는 경우** (`scripts/db-safety.mjs`, `npm run check:db-safety`가 검사한다):

- `.env.staging.local` 안에 production ref(`nndvspgnljivkvihxlzj`)가 한 글자라도 있으면 — 복사만 하고
  교체를 안 한 파일이다.
- `CHAIRMAN_ENV`·URL·anon key·DB 비밀번호가 **두 번** 정의돼 있으면 — 마지막 줄이 조용히 대상을 정한다.
- `CHAIRMAN_ENV`가 `staging`이 아니거나 URL이 staging 프로젝트가 아니면.
- link된 ref가 production이거나 staging이 아니면. 이 검사는 link **뒤에** 한 번 더 돈다.

`db:push:staging`은 production에 쓸 수 없다. `npm run db:push:staging production` 같은 인자는 받지 않는다.

### 적용 — production

**staging에서 확인하기 전에는 production에 push하지 않는다.** 9절 순서를 따른다.
production은 전용 명령을 두지 않았다 — 손으로 `supabase link --project-ref nndvspgnljivkvihxlzj` 한 뒤
`supabase db push`다. 한 단계 불편한 것이 목적이다.

push가 끝나면 작업 디렉터리의 link는 production에 남는다. **다음 staging 작업 전에 `db:push:staging`을
다시 돌리면 link가 staging으로 돌아온다**(스크립트가 매번 link부터 한다).

대상 프로젝트 ID, 백업, 승인된 변경 목록 확인은 9절 릴리스 절차를 따른다.
로컬 DB(8절 `npm run db:local`)는 Docker가 있는 환경에서만 선택적으로 쓴다.
`.env.local`이 CLI에 자동 로드된다고 가정하지 않는다.

### 새 마이그레이션을 쓸 때

- 번호는 마지막 것 +1. **이미 적용된 파일을 고치지 않는다** — 고쳐도 다시 돌지 않고,
  그러면 파일이 말하는 스키마와 실제 DB가 달라진다.
- 파일 머리에 **무엇이 없어서 만드나 / 왜 이 모양인가**를 적는다. 기존 0001~0011이 전부 그렇다.
- 표를 새로 만들면 **RLS 정책도 같은 파일에 같이 쓴다.** 0002가 모든 표에
  `ENABLE + FORCE ROW LEVEL SECURITY`를 걸어 두었기 때문에, 정책 없는 새 표는
  아무도 못 읽는 표가 된다(Default Deny). 조용히 비는 화면이 되므로 원인을 찾기 어렵다.

### 시드

`0003_seed.sql`은 과거 생성된 **적용 이력**이다. 재생성하거나 수정하지 않는다.
기존 `npm run gen:seed`는 DB에 연결하지 않지만 이 파일을 덮어쓰므로 D-17에서는 사용하지 않는다.
기존 0003·0008의 데모 데이터도 고객 데이터 공급원으로 사용하지 않는다.
로컬에서는 원본 마이그레이션을 그대로 재생한 다음 `supabase/tests/seed.sql`의
합성 데이터로 교체한다. 새 운영 데이터 변경은 새 마이그레이션 또는 승인된 별도 절차로 다룬다.

### 첫 회장 계정 (프로젝트를 새로 만들 때 한 번)

`supabase/bootstrap/0004_bootstrap_chairman.sql` 머리 주석의 절차를 그대로 따른다.
요약하면:

1. Dashboard → Authentication → Users → **Add user** (Auto Confirm User 켠다)
2. 생긴 사용자의 UID를 복사
3. 그 파일의 `:chairman_uid` 3곳을 UID로 치환한 사본을 만들고 SQL Editor에서 실행

이 한 번만 RLS 밖(postgres 세션)에서 돈다. `user_profiles`의 쓰기 정책이
`auth_role() = 'Chairman'`을 요구하는데 Chairman이 아직 없어서, 앱 경로로는
첫 행을 넣을 방법이 자체가 없다.

> 치환한 사본(`0004_ready.sql`)은 `.gitignore`에 있다. 커밋하지 않는다.

### AI Agent 계정 (야간 브리핑, 한 번)

`supabase/bootstrap/0005_ai_agent.sql` 머리 주석의 절차를 따른다. 선행 조건은 `0013_ai_agent.sql` 적용이다.

1. Dashboard → Authentication → Users → **Add user** (Auto Confirm User 켠다). 비밀번호는 길고 무작위로.
2. UID로 `:agent_uid`를 치환한 사본(`0005_ready.sql`, `.gitignore`)을 SQL Editor에서 실행
3. 파일 끝 5절 확인: `vault_docs = 0`, `kpis > 0`, `alert_ack = 0`, `settings_write = denied`, `output_write = ok`
4. 그 이메일/비밀번호를 Vercel `AI_AGENT_EMAIL` / `AI_AGENT_PASSWORD`에 넣는다

Agent는 부트스트랩 시점의 회사만 본다. 회사를 추가하면 그 파일의 2절만 다시 돌린다.
돌지 않은 밤은 `/ai`에 그 날짜가 없고, 돌았는데 실패한 회사는 `status='Failed'` 행으로 남는다.
Job의 끝은 늘 `audit_log(action='night_job_completed')` 한 줄이다 — 없으면 Job이 로그인조차 못 한 것이다.

### 0015 재무 원장 — 코드보다 먼저 적용한다 (Phase 2-A)

**0015를 적용하기 전에 Phase 2-A 코드를 live로 배포하지 않는다.** 대시보드가 `finance_kpis`에서
`source / closed / fetched_at`을 읽는데, 그 칸은 0015가 만드는 뷰에만 있다. 순서가 뒤집히면 대시보드 전체가
PostgREST 오류로 멈춘다(`column finance_kpis.source does not exist`).

적용 직후의 모습: 원장이 비어 있으므로 `finance_kpis`는 옛 시트 480행을 **수기** 꼬리표로 내보낸다.
대시보드 숫자는 그대로고 꼬리표만 붙는다. `/finance`는 '이 범위에 원장이 없습니다'를 보여 준다 — 정상이다.
mock 원장은 live DB에 들어가지 않는다(동기화가 mock일 때 쓰지 않는다).

### 0016 자체 장부 — 코드보다 먼저 적용한다 (Phase 2-B)

**0016을 적용하기 전에 Phase 2-B 코드를 live로 배포하지 않는다.** 대시보드가 `finance_kpis.basis`를,
재무 화면이 `journal_entries`를 읽는다. 순서가 뒤집히면 대시보드가 PostgREST 오류로 멈춘다
(`column finance_kpis.basis does not exist`). 적용 전 `npm run check:migrations`를 통과시킨다.

0016이 하는 일: 계정과목 관리(`accounts.active`, 코드 불변, 스타트업 4곳 표준 계정과목표 시드),
전표 입력(`journal_entries`, `post_journal_entry`), 월 마감(`close_period`), 정정 전표(`post_correction`),
꼬리표 규칙 변경(원장 표의 manual도 잠정/확정, `finance_kpis.basis`).

적용 직후의 모습: 전표와 결산이 비어 있으므로 대시보드 숫자는 그대로(시트 수기)다. 계정과목만 스타트업 4곳에 생긴다.
**어느 회사·달에든 전표가 한 줄이라도 들어가면 그 회사·달은 시트 행 대신 원장 숫자로 바뀐다.**
시험 입력은 운영 DB에서 하지 않는다 — dummy 모드(`NEXT_PUBLIC_DATA_MODE=dummy`, Supabase 키 비움)에서 한다.
마감은 되돌릴 수 없다.

**권한:** 계정과목·전표 = Chairman · GroupCFO · 자기 회사 BusinessCEO. 월 마감 = Chairman · GroupCFO.
모든 쓰기는 `audit_log`에 남는다 — 전표·마감·정정은 DB 함수 안에서 같은 트랜잭션으로 남긴다.

### Integration 계정 (예약)

ECOUNT API 동기화(Phase 2-A)는 2-B에서 걷어냈다(`lib/ecount/client.ts` · `config.ts` · `sync.ts`, `/api/cron/ecount-sync` 삭제).
`Integration` 역할과 `supabase/bootstrap/0006_integration.sql`은 남겨 두었다. 지금 `INTEGRATION_EMAIL` / `INTEGRATION_PASSWORD`를
읽는 코드는 없다. DY ECOUNT 엑셀 업로드 블록에서 이 계정을 쓸지(사람 세션으로 올릴지) 정한다.

### staging 부트스트랩 3종 — 프로젝트를 새로 세울 때 한 번

`db push`는 `migrations/`만 집는다. `bootstrap/`의 세 파일은 **staging에서도 손으로 한 번씩** 돌려야 한다.
UID가 프로젝트마다 다르기 때문이다 — production의 UID를 staging에 쓸 수 없다.

**모든 작업은 staging 프로젝트(`itpenmxyracfhyormcep`) Dashboard에서 한다.** production 탭과 섞이지 않게
브라우저 창을 하나만 열어 두는 편이 낫다. 순서대로:

| 순서 | 계정 | 파일 | 치환할 자리 | 선행 |
|---|---|---|---|---|
| ① | 회장 | `0004_bootstrap_chairman.sql` | `:chairman_uid` 3곳 | 0002 |
| ② | AI Agent | `0005_ai_agent.sql` | `:agent_uid` | 0013 |
| ③ | Integration | `0006_integration.sql` | `:sync_uid` | 0015 |

선행 마이그레이션은 `npm run db:push:staging`으로 이미 다 들어가 있다. ①이 먼저다 —
②③의 `user_profiles` 쓰기가 Chairman을 전제한다.

각 줄의 절차는 같다. 파일 머리 주석이 정본이고, 요약하면:

1. Authentication → Users → **Add user** (Auto Confirm User 켠다). 비밀번호는 길고 무작위로.
   staging 계정은 **production과 다른 비밀번호**를 쓴다(9절 1번).
2. 생긴 사용자의 UID를 복사한다.
3. 그 파일의 자리표시자를 UID로 치환한 사본(`000N_ready.sql`)을 만들어 **staging** SQL Editor에서 전체 실행한다.
   `*_ready.sql` 셋은 `.gitignore`에 있다 — 커밋하지 않는다.
4. 파일 끝의 기대값 절을 확인한다(②는 `vault_docs = 0`, `kpis > 0`, `alert_ack = 0`,
   `settings_write = denied`, `output_write = ok`).

②③의 이메일·비밀번호는 staging 앱 환경(`.env.staging.local`, Vercel Preview)의
`AI_AGENT_*` / `INTEGRATION_*`에 넣는다. production 값을 그대로 쓰지 않는다 —
`npm run db:push:staging`이 같은 값을 발견하면 경고한다.

---

## 3. 계정 초대

**DEFERRED D-15 결정: 수동 초대 + 트리거 연결.** 앱에서 메일을 보내지 않는다.

### 절차 — 순서가 중요하다

**① 앱에서 초대를 저장한다**

`/settings/users` → 초대. 이메일 · 역할 · 접근 범위(회사) · 최고 보안등급을 정한다.
이 단계에서 `user_invitations`에 행이 앉는다. **아직 계정은 없다.**

**② Supabase Dashboard에서 계정을 만든다**

Authentication → Users → **Add user** → **①과 똑같은 이메일**로.
계정이 생기는 순간 `on_auth_user_created` 트리거(`0011`)가 ①의 초대를 찾아
`user_profiles` · `user_business_access` · `user_module_access`를 자동으로 채운다.

**③ 그 사람에게 이메일과 비밀번호를 전달한다**

메일은 앱이 보내지 않는다. Supabase의 초대 메일 기능을 켰다면 그쪽을 쓴다.

### 순서를 바꾸면 안 되는 이유

②를 먼저 하면 트리거가 붙일 초대가 없어서 아무것도 하지 않는다. 그 사람은
**로그인은 되지만** `user_profiles`에 행이 없어 `currentUser()`가 null을 돌려주고,
RLS가 아무것도 내주지 않는다.

안전한 쪽으로 실패하는 것이라 사고는 아니다. 다만 **화면이 통째로 비어 보여서**
원인을 모르면 장애로 오해한다.

**복구:** ①을 다시 하고(초대 저장), 그 사람이 **로그아웃 후 재로그인**한다.
트리거는 계정 생성 시점에만 도는데 계정은 이미 있으므로, 초대를 다시 저장한 뒤에는
Chairman이 `/settings/users`에서 권한이 붙었는지 확인한다. 안 붙어 있으면
SQL Editor에서 `select accept_user_invitation()` 경로를 손으로 밟아야 한다.

### 확인 쿼리

```sql
select email, role, accepted_at, revoked_at
  from user_invitations order by invited_at desc;

select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;
-- on_auth_user_created 가 있어야 한다
```

---

## 4. 권한 회수

**퇴사·계약 종료 즉시 회수** (05_Architecture 원칙 8).

`/settings/users`의 **권한 회수** 버튼 하나다. 대상에 따라 두 가지로 갈린다.

| 대상 | 무엇이 일어나나 |
|---|---|
| 이미 들어온 사람 | `user_profiles.revoked_at`이 채워진다 |
| 아직 계정이 없는 사람 | 초대장이 취소된다. 자를 계정이 없다 |

`revoked_at` 한 줄이면 **전 테이블이 동시에 닫힌다.** 0002의 `is_active()`가 거짓이 되고,
그러면 `has_business()`도 거짓이라 어느 표에서도 행이 나가지 않는다.

**`user_business_access`는 지우지 않는다.** 지울 필요가 없고(위 이유로 이미 닫힌다),
지우면 되돌릴 때 그 사람이 어느 회사를 보고 있었는지가 사라진다.

**Chairman만 회수할 수 있다** (`user_profiles_admin_write` / `user_invitations_admin`).

### auth 계정 자체를 지우려면

앱에서 못 한다. Dashboard → Authentication → Users에서 지운다.
다만 **권한 회수가 먼저다** — 계정 삭제는 되돌릴 수 없고, `revoked_at`은 되돌릴 수 있다.

---

## 5. 감사 기록

`audit_log`는 **append only**다. 세 겹으로 막혀 있다.

1. 0002에 `INSERT`/`SELECT` 정책만 있다. `UPDATE`/`DELETE` 정책이 없으므로 Default Deny로 막힌다.
2. 0001의 트리거가 한 번 더 막는다.
3. `REVOKE`가 한 번 더 막는다.

읽는 것도 민감해서 **Chairman만 전체를 본다.**

기록이 남는 순간은 정해져 있다 — 로그인, 결정 처리(승인·거절·수정요청·위임),
업무 상태 변경, 회사 추가, 문서 등록, 전략 좌표 수정, 권한 변경.
**기록이 먼저 들어가고 그 다음에 대상 표가 바뀐다.** 순서가 뒤집힌 실패
(기록은 남고 상태는 안 바뀜)가 가능하고, 그쪽을 일부러 택했다 —
'승인을 시도했다'는 사실 자체가 기록 대상이다.

지우고 싶어지면, 그건 지워서는 안 되는 것이다.

---

## 6. 자주 나오는 증상

| 증상 | 먼저 볼 곳 |
|---|---|
| 화면이 통째로 비었는데 에러는 없다 | 그 사람 `user_profiles`에 행이 있나 / `revoked_at`이 찍혔나 |
| 앱이 시작하면서 에러를 던진다 | `NEXT_PUBLIC_DATA_MODE=live`인데 Supabase 키가 비었다 |
| 실적이어야 하는데 DUMMY DATA 뱃지가 있다 | `NEXT_PUBLIC_DATA_MODE`가 live가 아니다. 빌드도 다시 해야 한다 |
| 저장이 "권한이 없습니다"로 실패한다 | 정상 동작일 수 있다. 0002의 해당 `*_write` 정책을 본다 |
| 새로 만든 표가 아무한테도 안 보인다 | 그 표의 RLS 정책을 안 썼다(Default Deny) |
| `tsc`가 새 동적 라우트를 모른다 | `npm run build`를 한 번 돌린다(라우트 타입 재생성) |
| 배포했는데 환경변수가 안 먹는다 | `NEXT_PUBLIC_*`은 빌드 시점에 박힌다. 다시 빌드한다 |

---

## 7. 아직 없는 것

정직하게 적어 둔다. 자세한 것은 [DEFERRED.md](../DEFERRED.md).

| 없는 것 | 항목 |
|---|---|
| staging 부트스트랩 계정 · Preview 연결 · 실제 복원 리허설 | **D-17 부분 준비** — 8~9절. 배포 전 선행. staging 프로젝트와 스키마는 섰다(2절) |
| 운영 DB Seoul 이전 | **D-22** — production은 Tokyo, staging은 Seoul |
| 앱에서 보내는 초대 메일 | **D-15** (수동으로 확정) |
| 업무 담당자·제목·마감 편집 | **D-18** (의도된 경계) |
| 전사 프로젝트 목록 화면 | Phase 2 |
| ECOUNT / MES 연동 | Phase 2 (CH-052~054) |
| 야간 AI Job — 조사·발굴 등 6단계 파이프라인 | Phase 3 이후 (CH-045~048). 야간 브리핑만 Phase 3-A로 섰다(2절 AI Agent 계정) |

## 8. D-17 — 격리된 로컬 검증 (선택)

> **Docker 없이 먼저 돌리는 것:** `npm run check:migrations`. PGlite(메모리 안 Postgres)에 0001부터 마지막 마이그레이션까지
> 적용하고, `finance_kpis` 뷰가 TS 원장 공식과 모든 행에서 같은지, 역할별 RLS가 막을 것을 막는지 잰다.
> 원격에 연결하지 않는다. Supabase의 기본 GRANT·PostgREST·Auth는 못 재므로 아래 절차나 staging을 대신하지 않는다.
> 새 마이그레이션은 `db push` 전에 이것부터 통과시킨다.

이 절의 로컬 DB는 **Docker가 있는 환경에서만 선택적으로** 쓴다. 이 PC에는 Docker가 없으므로
마이그레이션 적용과 DB 검증은 2절의 원격 link + db push(staging 먼저)로 한다.

### 상태와 환경 식별

| 구분 | 상태 |
|---|---|
| DONE | 환경 가드, 전용 CLI 구성, 합성 시드, SQL/HTTP 검증 스크립트, 복구 절차 |
| READY LOCALLY (선택) | Docker가 있는 환경에서 start → reset → verify 실행 가능하도록 준비. 이 작업 PC에는 Docker가 없어 로컬 DB 실행은 하지 않는다 |
| DONE (2026-09-18) | 별도 Supabase staging 프로젝트(`itpenmxyracfhyormcep`, Seoul)와 0001~0016 적용, 가드 붙은 `db:push:staging` |
| REQUIRES EXTERNAL SETUP | staging 부트스트랩 계정·시크릿, Vercel Preview 연결, 백업/PITR, 실제 복구 리허설 및 담당자 승인 |

`NEXT_PUBLIC_DATA_MODE=dummy/live`는 데이터 어댑터 선택이며 환경 식별자가 아니다.
앱 환경에는 `CHAIRMAN_ENV=local|test|staging|production`을 명시한다.
`npm run env:check -- .env.local`은 파일의 **분류만** 출력하고 URL·키는 출력하지 않는다.
test/staging 표기만으로 실제 격리가 확인되지는 않으므로 `test-unverified`로 분류한다.
배포 담당자는 별도 프로젝트 ID와 콘솔의 환경을 대조해야 한다. 미지정/모순은 unknown이다.

로컬 DB 명령은 `.env.local`을 읽지 않고 `.env.validation.local`만 읽는다.
그 파일은 `.env.validation.example`의 복사본으로 시작한다. 실제 키나 비밀번호는 넣지 않는다.
셸에 운영 환경변수 또는 원격 Docker 설정이 남아 있으면 가드가 중단한다. 깨끗한 터미널을 사용한다.

### 준비와 실행

Node.js 22 이상, Supabase CLI, Docker Desktop 또는 로컬 Docker Engine이 필요하다.
Docker는 로컬 기본 소켓 또는 Docker Desktop Linux 소켓만 허용한다. SSH/TCP Docker는 거부한다.
포트 55430~55432가 비어 있어야 한다. 로컬 서비스를 외부에 공개하거나 터널링하지 않는다.

```text
# .env.validation.example을 .env.validation.local로 복사한 뒤
npm run check:db-safety
npm run db:local -- inspect
npm run db:local -- start
npm run db:local -- reset
npm run db:local -- verify
npm run check:boundaries
npm run db:local -- stop
```

Windows PowerShell이 npm.ps1을 막으면 `npm.cmd`로 같은 명령을 실행한다.
CLI 설치 방법은 [공식 로컬 개발 안내](https://supabase.com/docs/guides/local-development/cli/getting-started)를 따른다.
검증 성공 시 CLI 버전·Git SHA·마이그레이션 목록·검사 시각은
`.d17-local/last-validation.json`에 남는다. 이 파일은 커밋하지 않는다.

`start`는 로컬 서비스를 시작하고 **합성 시드로 데이터를 교체**한다.
`reset`은 전용 로컬 DB를 지우고 모든 마이그레이션을 처음부터 적용한 후 시드한다.
두 명령 모두 로컬 실험 데이터가 사라진다. `verify`는 SQL 검사를 롤백하고 HTTP로 읽기만 한다.
`stop`은 해당 로컬 프로젝트만 중지한다. 반복 실행은 reset → verify로 한다.

원본 마이그레이션은 수정하지 않고 `.d17-local/supabase/migrations`로 복사한다.
기존 bootstrap의 실제 UID 사본이나 `.env.local`은 복사하지 않는다.
CLI는 전용 project_id `chairman-os-d17`와 전용 workdir만 사용하며, 추가 인자를 받지 않는다.
`--linked`, `--db-url`, 다른 workdir, 임의 SQL 경로는 지원하지 않는다.
로컬 workdir에 project-ref가 있으면 중단한다. 자동 CLI 시드는 꺼져 있으며,
시드는 로컬 Docker 컨테이너 안의 psql로만 전달된다. SQL 자체도 로컬 실행 표식 없이는 실패한다.
이 가드는 도구의 실수를 차단하는 장치이며, 사람이 직접 원격 SQL Editor에서 SQL을 실행하는 권한을 막지는 않는다.

### 무엇을 검증하는가

- 합성 회사 A/B, JWT 전용 합성 사용자 5명. 실제 비밀번호·고객 데이터·문서 파일은 없다.
- Normal/Restricted/Vault × 두 회사의 문서 6개. 낮은 등급의 **쓰기 권한자**도 상위 등급을 읽지 못하는지 검사한다(P0-01).
- 충분한 등급 + 회사 범위 / 등급 부족 / 범위 없음 / Chairman / 익명 계정을 구분한다.
- 회사 A에 업무·프로젝트 각각 1,203건과 다른 회사의 격리용 행. nullable 마감일과 정상 날짜를 함께 넣는다.
- PostgREST cap을 137로 낮춘 실제 HTTP 응답과 전체 repository 조회를 비교한다(P0-07).
- Open/Approved 결정과 합성 감사 기록. 실제 승인 동작을 실행하거나 P0-03 의미를 바꾸지 않는다.
- `check:boundaries`는 DB 없는 회귀 검사로, 페이지 중복·오류·null 화면 표시도 검사한다.

HTTP 테스트는 CLI가 제공하는 **로컬** ANON_KEY/JWT_SECRET으로 짧은 authenticated JWT를 만든다.
service_role은 사용하지 않으며 상태 출력은 캡처 후 stdin으로만 전달한다.
CLI 버전이 이 로컬 JWT 정보를 제공하지 않으면 검사는 실패한다. 그런 경우 해당 CLI에 맞춘
로컬 인증 설정이 추가로 필요하며 production 키로 대체하지 않는다.
실패 시 성공 증거를 새로 쓰지 않는다. 기존 증거의 시각/SHA를 확인하고 실패를 Pass로 해석하지 않는다.

## 9. 릴리스 및 복구 절차

### 순서 — staging 먼저 → 확인 → production

이 순서를 건너뛰는 지름길은 없다. production에 먼저 넣고 staging에서 확인하는 것은 확인이 아니다.

```text
  0. 준비        기록과 백업. 아직 아무것도 바꾸지 않는다
  1. staging      npm run db:push:staging → 필요하면 부트스트랩 → Vercel Preview 배포
  2. 확인         staging에서 검사와 UAT. 여기서 멈출 수 있어야 의미가 있다
  3. production   승인 → DB → 앱. 되돌릴 길을 정해 둔 뒤에
```

**0. 준비 — 바꾸기 전에 적어 둔다**

1. staging(`itpenmxyracfhyormcep`)/production(`nndvspgnljivkvihxlzj`) 식별자와 앱 환경을 각각 대조하고
   별도 계정·시크릿 저장소로 분리한다. 같은 비밀번호를 두 환경에 쓰면 분리가 아니다.
2. 현재 정상 앱의 Git SHA/릴리스 태그, 빌드 산출물, 환경변수 버전, DB 적용 마이그레이션 목록을 기록한다.
   마이그레이션 목록은 `supabase migration list --linked`가 낸다.
3. production의 DB 스냅샷 또는 PITR 복원 지점, 보존 기간, RPO/RTO, 복원 권한과 책임자를 확인한다.
   별도 격리 대상에 실제 복원을 해 보고 소요 시간·데이터 정합성을 기록한다. 백업 존재만으로 복원 가능 판정을 하지 않는다.
4. 새 마이그레이션의 잠금·데이터 손실·RLS·구버전 앱 호환성을 검토한다.
   코드 롤백으로 충분한지, 전방 수정이나 DB 복원이 필요한지 **변경별로** 기록한다.

**1. staging에 먼저 넣는다**

5. `npm run db:push:staging`. 이 명령이 `check:migrations`를 먼저 돌리고, link된 ref가 staging인지
   대조한 뒤에야 push한다(2절). 새 표를 만들었다면 부트스트랩 3종 중 해당하는 것을 staging에서 돌린다.
6. Preview 배포가 staging DB를 보게 한다(1절). **기존 staging 데이터 위에 올리는 업그레이드**를 본다 —
   빈 DB에 처음부터 적용하는 것은 같은 시험이 아니다.
   Docker가 있는 환경이면 로컬 clean reset도 추가로 돌릴 수 있다(선택, 8절).

**2. staging에서 확인한다**

7. typecheck/lint/build/diff, `npm run check:db-safety`·`check:boundaries`·`check:finance`가 통과해야 한다.
8. staging Preview에서 배포 후 확인 4단계(1절)와 이번 변경에 해당하는 UAT를 돌린다.
   `/api/health`의 익명 `rows: 0` · `rls_closed: true`, 회사 격리, 문서 등급, 권한 회수를 본다.
   로컬 RLS·repository 검사(8절)는 Docker가 있는 환경에서만 선택적으로 추가한다.
9. **여기서 실패하면 production으로 넘어가지 않는다.** staging은 고쳐서 다시 5번부터 돌린다.
   staging에서 본 적 없는 마이그레이션은 production에 넣지 않는다.

**3. production**

10. 승인된 SHA만 릴리스하고 관찰·중단 기준과 담당자를 지정한다. 이 저장소 작업은 배포 승인이 아니다.
11. DB가 먼저다. 손으로 `supabase link --project-ref nndvspgnljivkvihxlzj` 후 `supabase db push`
    (2절 — 전용 npm 스크립트를 두지 않았다). 0015·0016처럼 **스키마가 코드보다 먼저** 가야 하는 변경은 순서를 지킨다.
12. 앱을 배포하고 배포 후 확인 4단계를 다시 돌린다. 끝났으면 작업 디렉터리의 link를
    `npm run db:push:staging`으로 staging에 되돌려 둔다 — 다음 사람이 production에 link된 채로 시작하지 않게.

### 앱 릴리스 실패

신규 배포를 중단하고 마지막 정상 **빌드 산출물**로 플랫폼에서 되돌린다.
산출물이 없으면 기록된 SHA로 별도 깨끗한 checkout/worktree를 만들고 해당 환경변수로 다시 빌드한다.
현재 작업 트리를 `git reset --hard`로 지우거나, production DB를 local reset 명령으로 되돌리지 않는다.
새 DB 스키마가 구버전 앱과 호환되는지 먼저 확인한다. 앱 롤백은 DB 롤백이 아니다.
복구 후 health의 익명 접근 차단, 로그인, 회사 격리, 문서 등급, 주요 읽기 및 승인 상태를 확인한다.
민감 정보가 포함될 수 있는 로그는 접근을 제한하고 사고 기록·감사 기록을 보존한다.

### DB 마이그레이션 실패

**완료 전 실패:** 재시도를 멈추고 적용 이력과 실제 스키마를 대조한다.
트랜잭션이 전부 롤백되었는지 확인한다. 비트랜잭션 작업 또는 여러 단계 작업은 일부만 적용될 수 있다.
이력에 없다는 이유만으로 변경이 전혀 없다고 단정하지 않는다. 격리 환경에서 같은 상태를 재현하고
수정본을 검증한 뒤, 미적용 변경만 승인된 절차로 재실행한다.

**완료했지만 동작이 잘못됨:** 일반적으로 새 번호의 **전방 수정 마이그레이션**을 선호한다.
이미 적용된 SQL을 편집·삭제·번호 변경하거나 migration repair로 성공한 척 표시하지 않는다.
무조건적인 down은 보안 정책을 다시 열거나 데이터를 버릴 수 있어 작성하지 않는다.
되돌릴 수 있는 변경만 변경별로 검증된 역변경을 사용한다.

**복원이 필요한 경우:** 삭제·오염 데이터를 전방 수정으로 복구할 수 없거나 정합성을 신뢰할 수 없으면
쓰기 중단과 복원 시점을 승인받고 격리 대상에 스냅샷/PITR을 먼저 복원한다.
복원 시점 이후 거래·감사 기록을 잃을 수 있으므로 안전하게 보존하고 재조정 계획을 세운다.
검증 완료 후 앱 환경 전환과 재빌드를 승인된 릴리스 절차로 실행한다. production reset 한 줄로 대체하지 않는다.

### RLS 사고

1. 릴리스를 중단하고 보안·DB 담당자에게 전달한다. 앱 중지만으로 직접 PostgREST 접근이 차단되지는 않는다.
2. 노출된 경로/계정을 확인하고, 검토된 임시 접근 차단 또는 세션·계정 회수로 격리한다.
   anon 키 교체만으로 RLS 문제가 해결된다고 가정하지 않는다. 로그·감사 기록은 삭제하지 않는다.
3. 제한된 관리 경로에서 `pg_policies`의 대상 테이블/명령/USING/WITH CHECK와
   `pg_class.relrowsecurity`, `relforcerowsecurity`를 확인한다. 사용자 등급·회사 범위·회수 상태도 대조한다.
4. 익명·낮은 등급 writer·다른 회사 사용자로 격리 환경에서 재현하고 8절 검사를 실행한다.
   공개 결과로 고객 문서 제목이나 내용을 출력하지 않는다.
5. 새 정책 수정과 재검증을 거쳐 접근을 복구한다. 잘못된 RLS로 데이터가 변경되었다면 별도 정합성 조사와
   필요시 위 DB 복원 절차를 따른다. 수정 배포가 과거 노출을 없애지는 않으므로 사고 대응 기록을 유지한다.
