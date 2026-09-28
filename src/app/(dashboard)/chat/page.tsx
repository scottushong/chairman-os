import Link from 'next/link'

import { AiPanel } from '@/components/chat/ai-panel'
import { ChatRoom } from '@/components/chat/chat-room'
import { NewDm } from '@/components/chat/new-dm'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { DATA_MODE } from '@/lib/env'
import { tr, type Lang } from '@/lib/i18n'
import { getRepository } from '@/lib/repository'
import type { ChatChannel } from '@/types'

/**
 * `/chat` — 커뮤니케이션 (Phase 9 블록 6).
 *
 * 왼쪽 채널(회사 전체 / 팀 / 1:1), 가운데 대화, 탭 «AI에게 묻기». 어떤 방이 보이는지는 전부
 * 0041 can_read_channel()이 정한다 — 이 화면은 받은 방을 종류별로 나눠 그릴 뿐이다.
 * 고른 방 · 탭은 주소(?c= · ?tab=ai · ?ai=)에 싣는다: 새로고침 · 링크로 보내기에서 살아남는다.
 */
export default async function ChatPage({ searchParams }: PageProps<'/chat'>) {
  await recordScreenRead({ path: '/chat', kind: 'page' })
  const params = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const tab = one(params.tab) === 'ai' ? 'ai' : 'chat'

  const user = await currentUser()
  const lang: Lang = user?.language ?? 'ko'
  const me = user?.user_id ?? ''
  const repo = await getRepository()
  const channels = await repo.listChatChannels(me)
  const selected = channels.find((c) => c.channel_id === one(params.c)) ?? (tab === 'chat' ? channels[0] : undefined)

  const [messages, reads, documents, people, aiChats] = await Promise.all([
    selected && tab === 'chat' ? repo.listChatMessages(selected.channel_id) : Promise.resolve([]),
    selected && tab === 'chat' ? repo.listChannelReads(selected.channel_id) : Promise.resolve([]),
    tab === 'chat' ? repo.listDocuments().catch(() => []) : Promise.resolve([]),
    repo.listUserAccounts().catch(() => []),
    repo.listAiChats(),
  ])
  const aiId = one(params.ai) || null
  const aiMessages = tab === 'ai' && aiId ? await repo.listAiChatMessages(aiId) : []

  const groups: { key: ChatChannel['kind']; label: string }[] = [
    { key: 'company', label: tr(lang, '회사 전체', 'Company') },
    { key: 'team', label: tr(lang, '팀', 'Teams') },
    { key: 'dm', label: tr(lang, '1:1', 'Direct') },
  ]
  const unread = (c: ChatChannel) => !!c.last_message_at && (!c.my_last_read_at || c.last_message_at > c.my_last_read_at)

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-5">
      <PageHeader
        icon="message"
        title={tr(lang, '커뮤니케이션', 'Communication')}
        code="Phase 9 · Block 6"
        description={tr(
          lang,
          '회사 전체 · 팀 · 1:1 메신저와 AI에게 묻기. 팀 방은 팀원 · 팀장 · 상위만 봅니다.',
          'Company, team and direct messages, plus Ask AI. Team rooms are visible to members, leads and managers above.',
        )}
      />

      <div className="mt-3 flex gap-1.5" role="tablist">
        <Link href="/chat" role="tab" aria-selected={tab === 'chat'} className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${tab === 'chat' ? 'bg-accent text-white' : 'border border-line bg-raised'}`}>
          {tr(lang, '메신저', 'Messenger')}
        </Link>
        <Link href="/chat?tab=ai" role="tab" aria-selected={tab === 'ai'} className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${tab === 'ai' ? 'bg-accent text-white' : 'border border-line bg-raised'}`}>
          {tr(lang, 'AI에게 묻기', 'Ask AI')}
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="glass rounded-glass p-3 text-[12.5px]">
          {tab === 'chat' ? (
            <>
              {groups.map((g) => {
                const list = channels.filter((c) => c.kind === g.key).sort((a, b) => a.title.localeCompare(b.title, 'ko'))
                if (list.length === 0 && g.key !== 'dm') return null
                return (
                  <div key={g.key} className="mb-2">
                    <p className="px-1 text-[10.5px] font-semibold tracking-wide text-ink-muted">{g.label}</p>
                    <ul>
                      {list.map((c) => (
                        <li key={c.channel_id}>
                          <Link
                            href={`/chat?c=${c.channel_id}`}
                            className={`flex items-center gap-1.5 truncate rounded px-1.5 py-1 ${selected?.channel_id === c.channel_id ? 'bg-raised font-semibold' : 'text-ink-dim hover:text-ink'}`}
                          >
                            <span className="min-w-0 flex-1 truncate">{c.kind === 'dm' ? '👤 ' : '# '}{c.title}</span>
                            {unread(c) ? <span aria-label={tr(lang, '새 메시지', 'Unread')} className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {g.key === 'dm' ? (
                      <NewDm
                        people={people
                          .filter((p) => p.user_id !== me && !p.revoked_at && p.status === 'active' && !['AIAgent', 'Integration'].includes(p.role))
                          .map((p) => ({ id: p.user_id, name: p.display_name }))}
                        lang={lang}
                      />
                    ) : null}
                  </div>
                )
              })}
            </>
          ) : (
            <>
              <Link href="/chat?tab=ai" className="mb-2 block rounded-md border border-line bg-raised px-2 py-1.5 text-center text-[12px] font-semibold hover:border-accent">
                + {tr(lang, '새 질문', 'New question')}
              </Link>
              <p className="px-1 text-[10.5px] font-semibold text-ink-muted">{tr(lang, '내 대화 (나만 봅니다)', 'My chats (only you)')}</p>
              <ul>
                {aiChats.map((c) => (
                  <li key={c.chat_id}>
                    <Link
                      href={`/chat?tab=ai&ai=${c.chat_id}`}
                      className={`block truncate rounded px-1.5 py-1 ${aiId === c.chat_id ? 'bg-raised font-semibold' : 'text-ink-dim hover:text-ink'}`}
                    >
                      {c.title || tr(lang, '(제목 없음)', '(untitled)')}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <section className="glass min-w-0 rounded-glass p-3">
          {tab === 'ai' ? (
            <AiPanel chatId={aiId} messages={aiMessages} lang={lang} />
          ) : selected ? (
            <>
              <h2 className="mb-1 text-[13.5px] font-semibold">
                {selected.kind === 'dm' ? '👤 ' : '# '}
                {selected.title}
              </h2>
              <ChatRoom
                channelId={selected.channel_id}
                kind={selected.kind}
                messages={messages}
                reads={reads}
                me={me}
                documents={documents.slice(0, 200).map((d) => ({ id: d.document_id, title: d.title }))}
                realtime={DATA_MODE === 'live'}
                lang={lang}
              />
            </>
          ) : (
            <p className="py-10 text-center text-[12.5px] text-ink-muted">
              {tr(lang, '들어갈 수 있는 방이 없습니다.', 'No rooms available.')}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
