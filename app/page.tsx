"use client";

import { FormEvent, useState, useRef, useEffect } from "react";

const loadingDotStyle = {
  display: 'inline-block',
  animation: 'dot-bounce 1.4s infinite ease-in-out',
} as React.CSSProperties;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; url: string }[];
};

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastResponseStartRef = useRef<HTMLDivElement>(null);
  const loadingStartRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return i;
    }
    return -1;
  })();

  // When a response appears, scroll to the top of that response (not the bottom).
  useEffect(() => {
    if (loading) {
      loadingStartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (messages[messages.length - 1]?.role === "assistant") {
      lastResponseStartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading, messages]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.content })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${res.status}`);
      }
      const data = await res.json();
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.answer,
        sources: data.citations ?? []
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Something went wrong talking to the assistant.");
    } finally {
      setLoading(false);
    }
  }

  const allSources = Array.from(
    new Map(
      messages
        .flatMap(m => m.sources ?? [])
        .map(s => [s.url, s])
    ).values()
  );

  return (
    <div className="flex h-screen w-full">
      {/* Main Content */}
      <main className="flex-1 flex flex-col relative h-full">
        <header className="h-16 flex items-center justify-between px-12 border-b border-[var(--border-navy)] bg-[var(--bg-midnight)]/80 backdrop-blur-md z-30">
          <div className="flex items-center gap-4">
            <span className="material-symbols-outlined text-[var(--accent-luminous)] text-xl">architecture</span>
            <span className="text-[10px] font-bold text-silver-200 uppercase tracking-[0.2em]">Naval Intelligence</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-xs font-medium text-silver-400 italic">The Path to Wealth &amp; Happiness</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar pb-48 pt-12">
          <div className="max-w-2xl mx-auto px-6 space-y-12">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <span className="material-symbols-outlined text-5xl mb-6 text-[var(--accent-luminous)]">auto_awesome</span>
                <h2 className="text-2xl font-serif font-semibold mb-3 text-[var(--text-silver)]">Hey! ask me anything and I will respond as Naval.</h2>
                <p className="text-silver-400 text-base leading-relaxed max-w-md">
                  Fan-made assistant referencing Naval&apos;s public writing; not Naval.
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                ref={m.role === "assistant" && i === lastAssistantIndex ? lastResponseStartRef : undefined}
                className="flex flex-col"
              >
                {m.role === "user" && (
                  <>
                    <div className="text-sm font-bold text-silver-200 uppercase tracking-widest mb-4">Inquiry</div>
                    <p className="text-xl text-[var(--text-silver)] font-medium leading-relaxed pl-8">
                      {m.content}
                    </p>
                  </>
                )}

                {m.role === "assistant" && (
                  <>
                    <div className="flex items-center gap-2 mt-4 mb-3">
                      <span className="material-symbols-outlined text-sm text-[var(--accent-luminous)]">auto_awesome</span>
                      <span className="text-[10px] font-bold tracking-widest text-silver-200 uppercase">Naval</span>
                    </div>
                    <div className="bg-[var(--chat-ai-bg)]/40 rounded-2xl px-6 py-5">
                      <div className="serif-content text-lg text-[var(--text-silver)] space-y-4 whitespace-pre-wrap break-words overflow-visible">
                        {m.content.split('\n').map((para, idx) => {
                          if (para.trim().startsWith('"') && para.trim().endsWith('"')) {
                            return (
                              <div key={idx} className="pl-6 border-l border-[var(--accent-luminous)]/30 py-2 text-lg italic text-silver-400">
                                {para.trim()}
                              </div>
                            );
                          }
                          return <p key={idx}>{para || '\u00A0'}</p>;
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}

            {loading && (
              <div ref={loadingStartRef} className="flex flex-col">
                <div className="flex items-center gap-2 mt-4 mb-3">
                  <span className="material-symbols-outlined text-sm text-[var(--accent-luminous)]">auto_awesome</span>
                  <span className="text-[10px] font-bold tracking-widest text-silver-200 uppercase">Naval</span>
                </div>
                <div className="bg-[var(--chat-ai-bg)]/40 rounded-2xl px-6 py-5">
                  <div className="flex items-center gap-2 py-2">
                    <span className="loading-dot inline-block w-2 h-2 rounded-full bg-[var(--accent-luminous)]" style={{ ...loadingDotStyle, animationDelay: '0s' }}></span>
                    <span className="loading-dot inline-block w-2 h-2 rounded-full bg-[var(--accent-luminous)]" style={{ ...loadingDotStyle, animationDelay: '0.2s' }}></span>
                    <span className="loading-dot inline-block w-2 h-2 rounded-full bg-[var(--accent-luminous)]" style={{ ...loadingDotStyle, animationDelay: '0.4s' }}></span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-red-400 text-sm">{error}</div>
            )}

            {/* Intentionally no "scroll-to-bottom" sentinel */}
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-10 bg-gradient-to-t from-[var(--bg-midnight)] via-[var(--bg-midnight)] to-transparent">
          <div className="max-w-2xl mx-auto w-full">
            <form onSubmit={onSubmit} className="relative bg-[var(--bg-input)] rounded-full shadow-2xl transition-all px-6 py-2 input-glow flex items-center gap-4 outline-none">
              <textarea
                ref={textareaRef}
                className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-[var(--text-silver)] placeholder:text-silver-400 py-3 resize-none overflow-hidden text-base"
                placeholder="Inquire with Naval AI..."
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSubmit(e);
                  }
                }}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex items-center justify-center size-10 rounded-full bg-[var(--accent-luminous)] text-midnight-950 hover:brightness-110 transition-all shadow-[0_0_15px_rgba(125,211,252,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-xl">north</span>
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Right Sidebar - Sources */}
      <aside className="w-80 bg-[var(--bg-panel)] border-l border-[var(--border-navy)] flex flex-col h-full z-40">
        <div className="p-8 border-b border-[var(--border-navy)]">
          <h2 className="text-[10px] font-bold text-silver-200 uppercase tracking-[0.2em] flex items-center gap-2">
            <span className="material-symbols-outlined text-base">auto_stories</span> Sources &amp; References
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-10">
          {allSources.length === 0 ? (
            <div className="text-sm text-silver-400">
              As you chat, sources from nav.al will appear here.
            </div>
          ) : (
            <section>
              <h3 className="text-[10px] font-bold text-[var(--accent-luminous)] uppercase tracking-widest mb-4">Archive Sources</h3>
              <div className="space-y-4">
                {allSources.map(s => (
                  <div key={s.url} className="group cursor-pointer">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-silver-200 group-hover:text-[var(--accent-luminous)] transition-colors block"
                    >
                      {s.title}
                    </a>
                    <p className="text-[11px] text-silver-400 mt-1">nav.al/archive</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="p-8 border-t border-[var(--border-navy)]">
          <div className="flex items-center gap-2 text-silver-400">
            <span className="material-symbols-outlined text-sm">verified</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Verified Corpus</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
