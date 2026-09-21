/**
 * PGlite 하네스 — 마이그레이션을 Docker 없이 메모리 Postgres에 올리는 공용 조각.
 *
 * 이 파일은 scripts/check-migrations.ts에 있던 것을 그대로 옮긴 것이다. 블록 7이
 * scripts/check-activity.ts를 더하면서 같은 스텁이 두 벌이 될 뻔했고, 두 벌이 되는
 * 순간 한쪽만 고쳐지는 날이 온다 — Supabase의 기본 GRANT 흉내(아래 마지막 두 줄)처럼
 * "없으면 아무 검사도 빨개지지 않는" 종류의 줄이 특히 그렇다.
 *
 * 여기에는 단언이 없다. 무엇을 재는지는 부르는 쪽이 정한다.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PGlite } from '@electric-sql/pglite'

export const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations')

export type Db = PGlite

export const SUPABASE_STUBS = `
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon;
  create role authenticated;

  -- Supabase Storage 최소 흉내 (0018). 실제 storage 스키마에는 훨씬 많은 칸이 있지만
  -- 0018이 건드리는 것은 buckets의 public과 objects의 bucket_id뿐이다.
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
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;

  -- Supabase의 기본 GRANT 흉내. 실제 프로젝트에서는 postgres 역할에 이 default privileges가
  -- 걸려 있어서, public 스키마에 새로 만든 표는 **만들자마자** anon/authenticated에게 열린다.
  -- 이것을 흉내 내지 않으면 마이그레이션의 revoke가 '이미 없는 권한을 걷는' 빈 문장이 되어,
  -- 그 줄을 지워도 아무 검사도 빨개지지 않는다(0001 audit_log, 0023 chairman_kakao_token).
  -- 표를 만드는 문장들보다 먼저 걸려야 하므로 STUBS의 마지막에 둔다.
  alter default privileges in schema public grant all on tables    to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`

/** 마이그레이션 한 장. 실패하면 어느 파일인지 말한다 — PGlite의 오류에는 파일 이름이 없다. */
export async function applyOne(db: Db, file: string) {
  try {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  } catch (e) {
    throw new Error(`${file} 적용 실패: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * upTo를 주면 그 파일까지만 적용한다. 0026의 백필처럼 **적용 순간의 DB 상태**가 입력인
 * 검사는 그 사이에 사람을 심어야 해서, 중간에 한 번 멈출 수 있어야 한다.
 */
export async function applyAll(db: Db, upTo?: string): Promise<string[]> {
  await db.exec(SUPABASE_STUBS)
  const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  const files = upTo ? all.slice(0, all.indexOf(upTo) + 1) : all
  assert.ok(files.length > 0, `적용할 마이그레이션이 없다 (upTo=${upTo ?? '전부'})`)
  for (const f of files) await applyOne(db, f)
  return files
}
