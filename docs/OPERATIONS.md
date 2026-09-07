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

**Staging 환경과 Rollback 절차가 없다.** 이건 미해결 항목이다 → **DEFERRED D-17**
(UAT TC-023·024 P0 Fail). 배포를 정식으로 하려면 이게 먼저다.

아래는 지금 할 수 있는 것을 적은 것이지, 완성된 배포 절차가 아니다.

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

---

## 2. 마이그레이션

### 파일

`supabase/migrations/` 에 `0001` ~ `0011`. 번호순으로 적용된다.

`0004`가 없는 것은 실수가 아니다. `supabase/bootstrap/0004_bootstrap_chairman.sql`이
그 번호를 이미 쓰고 있다. 그 파일은 `migrations/` 밖에 있어 `db push`가 집지 않는다 —
첫 회장 계정의 UID가 프로젝트마다 달라서 마이그레이션에 박아 넣을 값이 아니기 때문이다.

### 적용

```bash
supabase link --project-ref <project-ref>
supabase db push
```

`SUPABASE_DB_PASSWORD`를 `.env.local`에 넣어 두면 프롬프트를 건너뛴다.

### 새 마이그레이션을 쓸 때

- 번호는 마지막 것 +1. **이미 적용된 파일을 고치지 않는다** — 고쳐도 다시 돌지 않고,
  그러면 파일이 말하는 스키마와 실제 DB가 달라진다.
- 파일 머리에 **무엇이 없어서 만드나 / 왜 이 모양인가**를 적는다. 기존 0001~0011이 전부 그렇다.
- 표를 새로 만들면 **RLS 정책도 같은 파일에 같이 쓴다.** 0002가 모든 표에
  `ENABLE + FORCE ROW LEVEL SECURITY`를 걸어 두었기 때문에, 정책 없는 새 표는
  아무도 못 읽는 표가 된다(Default Deny). 조용히 비는 화면이 되므로 원인을 찾기 어렵다.

### 시드

`0003_seed.sql`은 **생성 파일이다. 손으로 고치지 않는다.**

```bash
# src/data/*.json 을 고친 뒤
npm run gen:seed
# 0003_seed.sql 과 JSON 을 같이 커밋한다
```

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
| Staging 환경 · Rollback 절차 | **D-17** (배포 전 선행) |
| 앱에서 보내는 초대 메일 | **D-15** (수동으로 확정) |
| 업무 담당자·제목·마감 편집 | **D-18** (의도된 경계) |
| 전사 프로젝트 목록 화면 | Phase 2 |
| ECOUNT / MES 연동 | Phase 2 (CH-052~054) |
| 야간 AI Job 실행 | Phase 2 (CH-045~048) |
