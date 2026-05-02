"use client";

import { useActionState, useRef, useEffect } from "react";
import { postMessageAction, type ClanState } from "@/app/actions/clan";
import { formatDistanceToNow } from "date-fns";

interface Message {
  id: string;
  content: string;
  created_at: string;
  author_name: string;
  author_id: string;
}

const INIT: ClanState = { ok: false, error: null };

interface ClanChatProps {
  messages: Message[];
  currentCharacterId: string;
}

export default function ClanChat({ messages, currentCharacterId }: ClanChatProps) {
  const [state, formAction, isPending] = useActionState(postMessageAction, INIT);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the textarea after a successful post (revalidatePath re-renders
  // the Server Component which resets everything, but the form might
  // still hold the value briefly — this handles the edge case).
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
    }
  }, [state.ok]);

  return (
    <div className="space-y-3">
      {/* Message list */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="font-serif italic text-parchment-deep text-sm">
            No messages yet. Break the silence.
          </p>
        ) : (
          messages.map((m) => {
            const isOwn = m.author_id === currentCharacterId;
            return (
              <div
                key={m.id}
                className={`flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""}`}
              >
                {/* Avatar initial */}
                <div className="w-7 h-7 shrink-0 rounded-full border border-gold/30 bg-imperial-shadow flex items-center justify-center font-display text-[0.6rem] text-gold-bright uppercase">
                  {m.author_name.charAt(0)}
                </div>
                <div
                  className={`max-w-[75%] ${
                    isOwn ? "items-end" : "items-start"
                  } flex flex-col`}
                >
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span
                      className={`font-display text-[0.65rem] uppercase tracking-imperial ${
                        isOwn ? "text-gold-dim" : "text-parchment-deep"
                      }`}
                    >
                      {isOwn ? "You" : m.author_name}
                    </span>
                    <span className="font-serif text-[0.6rem] text-parchment-deep/60">
                      {formatDistanceToNow(new Date(m.created_at), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  <div
                    className={`px-3 py-2 rounded-sm text-sm font-serif leading-relaxed ${
                      isOwn
                        ? "bg-imperial/60 border border-gold/20 text-parchment"
                        : "bg-ash/60 border border-gold/10 text-parchment-dark"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Post form */}
      <form ref={formRef} action={formAction} className="flex gap-2">
        <textarea
          name="content"
          rows={2}
          maxLength={500}
          placeholder="Say something to your clan…"
          className="input-imperial flex-1 resize-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="btn-imperial self-end"
        >
          {isPending ? "…" : "Post"}
        </button>
      </form>
      {state.error && (
        <p className="font-serif italic text-blood text-sm">{state.error}</p>
      )}
    </div>
  );
}
