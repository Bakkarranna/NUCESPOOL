import React, { useEffect, useMemo, useState } from 'react';
import { Flag, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { ReportModal } from './ReportModal';

const REACTION_EMOJIS = ['👍', '✅', '📍', '🙏', '🚗'];

interface MessagesViewProps {
  initialThread?: { rideId: number; otherUserId: number } | null;
}

export const MessagesView: React.FC<MessagesViewProps> = ({ initialThread }) => {
  const { firebaseUser, profile, workspace, signInWithGoogle, apiFetch, refreshAll } =
    useAuth();

  const [selectedKey, setSelectedKey] = useState<string>(
    initialThread ? `${initialThread.rideId}:${initialThread.otherUserId}` : ''
  );
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [reactingMsgId, setReactingMsgId] = useState<number | null>(null);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    if (initialThread) {
      setSelectedKey(`${initialThread.rideId}:${initialThread.otherUserId}`);
    }
  }, [initialThread]);

  const threads = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        rideId: number;
        otherUserId: number;
        otherName: string;
        otherAvatarUrl: string | null;
        rideLabel: string;
        messages: NonNullable<typeof workspace>['messages'];
      }
    >();

    if (!profile) return [];

    for (const m of workspace?.messages ?? []) {
      const otherId = m.senderUserId === profile.id ? m.receiverUserId : m.senderUserId;
      const otherName = m.senderUserId === profile.id ? m.receiverName : m.senderName;
      const otherAvatarUrl =
        m.senderUserId === profile.id
          ? m.receiverAvatarUrl ?? null
          : m.senderAvatarUrl ?? null;
      const key = `${m.rideId}:${otherId}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          rideId: m.rideId,
          otherUserId: otherId,
          otherName,
          otherAvatarUrl,
          rideLabel: m.rideLabel,
          messages: [],
        });
      }
      map.get(key)!.messages.push(m);
    }

    if (initialThread) {
      const key = `${initialThread.rideId}:${initialThread.otherUserId}`;
      if (!map.has(key)) {
        const booking =
          workspace?.myBookings.find((b) => b.rideId === initialThread.rideId) ||
          workspace?.incomingBookings.find((b) => b.rideId === initialThread.rideId);
        const otherName =
          booking?.provider?.fullName ||
          booking?.passenger?.fullName ||
          `Student #${initialThread.otherUserId}`;
        const otherAvatarUrl =
          booking?.provider?.avatarUrl ||
          booking?.passenger?.avatarUrl ||
          null;
        const rideLabel = booking?.ride
          ? `${booking.ride.originCity} → ${booking.ride.destinationCity} (${booking.ride.travelDate})`
          : `Ride #${initialThread.rideId}`;
        map.set(key, {
          key,
          rideId: initialThread.rideId,
          otherUserId: initialThread.otherUserId,
          otherName,
          otherAvatarUrl,
          rideLabel,
          messages: [],
        });
      }
    }

    for (const b of workspace?.myBookings ?? []) {
      if (b.ride && b.provider) {
        const key = `${b.ride.id}:${b.provider.id}`;
        if (!map.has(key)) {
          map.set(key, {
            key,
            rideId: b.ride.id,
            otherUserId: b.provider.id,
            otherName: b.provider.fullName,
            otherAvatarUrl: b.provider.avatarUrl ?? null,
            rideLabel: `${b.ride.originCity} → ${b.ride.destinationCity} (${b.ride.travelDate})`,
            messages: [],
          });
        }
      }
    }

    return Array.from(map.values());
  }, [workspace, profile, initialThread]);

  const activeThread =
    threads.find((t) => t.key === selectedKey) || threads[0] || null;

  if (!firebaseUser) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-xl mx-auto">
        <h2 className="text-xl font-bold text-slate-900 font-display">In-App Messaging</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign in to sort out pickup stops and departure times here instead of putting your phone number in public groups.
        </p>
        <button
          type="button"
          onClick={signInWithGoogle}
          className="mt-5 min-h-[44px] px-6 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 cursor-pointer"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThread || !draft.trim()) return;
    setSending(true);
    try {
      await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          rideId: activeThread.rideId,
          receiverUserId: activeThread.otherUserId,
          content: draft.trim(),
        }),
      });
      setDraft('');
      await refreshAll();
    } finally {
      setSending(false);
    }
  };

  const handleToggleReaction = async (messageId: number, emoji: string) => {
    setReactingMsgId(messageId);
    try {
      await apiFetch(`/api/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      await refreshAll();
    } finally {
      setReactingMsgId(null);
    }
  };

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden grid grid-cols-1 md:grid-cols-3 min-h-[520px]">
        {/* Thread List */}
        <aside className="border-b md:border-b-0 md:border-r border-slate-200 divide-y divide-slate-100">
          <div className="p-4 bg-slate-50 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Squad Chats</h2>
          </div>
          {threads.length === 0 ? (
            <p className="p-6 text-xs text-slate-500">
              Your DMs pop up here once you lock in a seat or someone requests your ride.
            </p>
          ) : (
            threads.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelectedKey(t.key)}
                className={`w-full text-left p-4 flex items-center gap-3 transition-colors cursor-pointer ${
                  activeThread?.key === t.key ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                }`}
              >
                <Avatar name={t.otherName} avatarUrl={t.otherAvatarUrl} size="md" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {t.otherName}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">{t.rideLabel}</div>
                </div>
              </button>
            ))
          )}
        </aside>

        {/* Conversation Pane */}
        <div className="md:col-span-2 flex flex-col justify-between">
          {activeThread ? (
            <>
              <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    name={activeThread.otherName}
                    avatarUrl={activeThread.otherAvatarUrl}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {activeThread.otherName}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {activeThread.rideLabel}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReport(true)}
                  className="min-h-[40px] px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:text-red-600 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Flag className="h-3.5 w-3.5" />
                  <span>Report</span>
                </button>
              </div>

              <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[360px]">
                {activeThread.messages.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">
                    Drop a ping below to lock in your pickup spot &amp; timing.
                  </p>
                ) : (
                  activeThread.messages.map((m) => {
                    const isMine = m.senderUserId === profile?.id;
                    const reactions = m.reactions ?? [];
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${
                          isMine ? 'items-end' : 'items-start'
                        }`}
                      >
                        <div
                          className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${
                            isMine
                              ? 'bg-teal-700 text-white'
                              : 'bg-slate-100 text-slate-900'
                          }`}
                        >
                          {m.content}
                        </div>

                        {/* Existing Reaction Pills + Quick Emoji Picker */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {reactions.map((r) => (
                            <button
                              key={r.emoji}
                              type="button"
                              disabled={reactingMsgId === m.id}
                              onClick={() => handleToggleReaction(m.id, r.emoji)}
                              className={`px-2 py-0.5 rounded-full text-xs border transition-colors cursor-pointer ${
                                r.userReacted
                                  ? 'bg-teal-50 border-teal-300 text-teal-900 font-semibold'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span>{r.emoji}</span>{' '}
                              <span className="font-mono tabular-nums text-[11px]">
                                {r.count}
                              </span>
                            </button>
                          ))}

                          <div className="inline-flex items-center gap-0.5 bg-white border border-slate-200 rounded-full px-1.5 py-0.5">
                            {REACTION_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                disabled={reactingMsgId === m.id}
                                onClick={() => handleToggleReaction(m.id, emoji)}
                                aria-label={`React with ${emoji}`}
                                className="text-xs hover:scale-125 transition-transform px-0.5 cursor-pointer"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>

                        <span className="mt-1 text-[10px] text-slate-400 font-mono tabular-nums">
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-4 border-t border-slate-200 space-y-2.5">
                <div className="flex flex-wrap gap-2">
                  {[
                    'On my way. Pulling up to pickup on time.',
                    'Reached the stop, where u at?',
                    'Fuel + challan split sorted in cash, bro.',
                    'Traffic scene near bridge, 5 min late!',
                  ].map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setDraft(tpl)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
                    >
                      {tpl}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Drop a message to the squad..."
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-200 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="min-h-[44px] px-4 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="h-4 w-4" />
                    <span>Send</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-sm text-slate-500">
              Select a ride conversation to view messages.
            </div>
          )}
        </div>
      </div>

      {activeThread && (
        <ReportModal
          isOpen={showReport}
          onClose={() => setShowReport(false)}
          rideId={activeThread.rideId}
          reportedUserId={activeThread.otherUserId}
          subjectLabel={activeThread.otherName}
        />
      )}
    </>
  );
};
