import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Cpu,
  Gauge,
  KeyRound,
  Loader2,
  Menu,
  MessageSquarePlus,
  PanelRight,
  Plus,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  Settings2,
  ShieldCheck,
  Sparkles,
  Split,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import "@/chat-free-only.css";

const Streamdown = lazy(async () => {
  const module = await import("streamdown");
  return { default: module.Streamdown };
});

type ProviderId = "platform" | "openrouter" | "respan";
type SelectedModel = { providerId: ProviderId; modelId: string };

function duration(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

function firstName(value?: string | null) {
  return value?.trim().split(/\s+/)[0] || "Operator";
}

function ProviderGlyph({ providerId }: { providerId: ProviderId }) {
  return <span className={`provider-glyph ${providerId}`}>{providerId === "platform" ? "P" : providerId === "openrouter" ? "OR" : "R"}</span>;
}

function LoginScreen() {
  return <main className="chat-auth"><div className="auth-noise" /><section><div className="signal-logo">G<span>:</span></div><p className="signal-label">GODMODE / CONVERSATION SYSTEM</p><h1>One interface.<br /><em>Every intelligent route.</em></h1><p>Your conversations, provider connections, system prompts, and model outputs are private to your workspace.</p><button className="signal-primary" onClick={() => startLogin()}><ShieldCheck size={16} />Authenticate and enter</button></section></main>;
}

export default function GodmodeChatWorkspace() {
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const [systemPrompt, setSystemPrompt] = useState("");
  const [composer, setComposer] = useState("");
  const [mode, setMode] = useState<"solo" | "competition">("solo");
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileHistory, setMobileHistory] = useState(false);
  const [connectProvider, setConnectProvider] = useState<"openrouter" | "respan" | undefined>();
  const [apiKey, setApiKey] = useState("");
  const messageEnd = useRef<HTMLDivElement>(null);

  const providerQuery = trpc.godmode.providers.list.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 60_000 });
  const conversationQuery = trpc.godmode.chat.list.useQuery(undefined, { enabled: Boolean(user) });
  const detailInput = useMemo(() => ({ conversationId: activeConversationId || "pending" }), [activeConversationId]);
  const detailQuery = trpc.godmode.chat.detail.useQuery(detailInput, { enabled: Boolean(activeConversationId), refetchInterval: activeConversationId ? 8_000 : false });
  const createChat = trpc.godmode.chat.create.useMutation();
  const configureChat = trpc.godmode.chat.configure.useMutation();
  const sendChat = trpc.godmode.chat.send.useMutation();
  const retryChat = trpc.godmode.chat.retry.useMutation();
  const attachProvider = trpc.godmode.providers.connect.useMutation();
  const detachProvider = trpc.godmode.providers.disconnect.useMutation();
  const refreshProviders = trpc.godmode.providers.refresh.useMutation();

  const models = providerQuery.data?.models ?? [];
  const diagnostics = providerQuery.data?.diagnostics ?? [];
  const conversation = detailQuery.data?.conversation;
  const messages = detailQuery.data?.messages ?? [];
  const busy = sendChat.isPending || createChat.isPending || retryChat.isPending;
  const callableModelKeys = useMemo(() => new Set(models.map(model => `${model.providerId}:${model.modelId}`)), [models]);

  useEffect(() => {
    if (!activeConversationId && conversationQuery.data?.[0]) setActiveConversationId(conversationQuery.data[0].id);
  }, [activeConversationId, conversationQuery.data]);

  useEffect(() => {
    if (!conversation) return;
    setSystemPrompt(conversation.systemPrompt ?? "");
    setMode(conversation.mode);
    try {
      const parsed = JSON.parse(conversation.selectedModels) as SelectedModel[];
      setSelectedModels(parsed);
    } catch { setSelectedModels([]); }
  }, [conversation?.id]);

  useEffect(() => {
    if (!models.length) { setSelectedModels([]); return; }
    setSelectedModels(current => {
      const currentModels = current.filter(item => callableModelKeys.has(`${item.providerId}:${item.modelId}`));
      return currentModels.length ? currentModels : [{ providerId: models[0].providerId, modelId: models[0].modelId }];
    });
  }, [callableModelKeys, models]);

  useEffect(() => { messageEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages.length, busy]);

  if (loading) return <main className="chat-loading"><Loader2 className="spin" size={24} /><span>Synchronizing private workspace</span></main>;
  if (!user) return <LoginScreen />;

  async function openConversation() {
    try {
      const created = await createChat.mutateAsync({ systemPrompt: systemPrompt.trim() || undefined });
      setActiveConversationId(created.id);
      setMobileHistory(false);
      await utils.godmode.chat.list.invalidate();
      toast.success("New conversation ready.");
      return created.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create a conversation.");
      return undefined;
    }
  }

  function toggleModel(model: SelectedModel) {
    setSelectedModels(current => {
      const exists = current.some(item => item.providerId === model.providerId && item.modelId === model.modelId);
      if (mode === "solo") return [model];
      return exists ? current.filter(item => item.providerId !== model.providerId || item.modelId !== model.modelId) : [...current, model];
    });
  }

  async function persistConfiguration() {
    if (!activeConversationId) return;
    try {
      await configureChat.mutateAsync({ conversationId: activeConversationId, systemPrompt: systemPrompt.trim() || null, mode, selections: selectedModels });
      await utils.godmode.chat.detail.invalidate({ conversationId: activeConversationId });
      toast.success("Conversation behavior saved.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save the system prompt."); }
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = composer.trim();
    if (!content || busy) return;
    if (!models.length) { toast.error("Connect a provider before sending a message."); setSettingsOpen(true); return; }
    if (mode === "solo" && selectedModels.length !== 1) { toast.error("Choose one callable model."); return; }
    if (mode === "competition" && selectedModels.length < 2) { toast.error("Choose at least two callable models for comparison."); return; }
    const conversationId = activeConversationId || await openConversation();
    if (!conversationId) return;
    setComposer("");
    try {
      if (conversationId === activeConversationId) await configureChat.mutateAsync({ conversationId, systemPrompt: systemPrompt.trim() || null, mode, selections: selectedModels });
      const detail = await sendChat.mutateAsync({ conversationId, content, mode, selections: selectedModels });
      setActiveConversationId(detail?.conversation.id);
      await Promise.all([utils.godmode.chat.list.invalidate(), utils.godmode.chat.detail.invalidate({ conversationId })]);
    } catch (error) {
      setComposer(content);
      toast.error(error instanceof Error ? error.message : "The chat request was not sent.");
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!connectProvider || !apiKey.trim()) return;
    try {
      await attachProvider.mutateAsync({ providerId: connectProvider, apiKey: apiKey.trim() });
      setApiKey(""); setConnectProvider(undefined);
      await utils.godmode.providers.list.invalidate();
      toast.success(`${connectProvider === "openrouter" ? "OpenRouter" : "Respan"} connected and verified.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Provider verification failed."); }
  }

  async function disconnect(providerId: "openrouter" | "respan") {
    try {
      await detachProvider.mutateAsync({ providerId });
      await utils.godmode.providers.list.invalidate();
      setSelectedModels(current => current.filter(item => item.providerId !== providerId));
      toast.success("Provider disconnected. Its models are no longer selectable.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Provider could not be disconnected."); }
  }

  return <main className="chat-shell">
    <aside className={`conversation-rail ${mobileHistory ? "mobile-open" : ""}`}>
      <div className="rail-brand"><div className="signal-logo small">G<span>:</span></div><div><strong>GODMODE</strong><small>AI CONSOLE</small></div><button className="mobile-close" onClick={() => setMobileHistory(false)}><X size={18} /></button></div>
      <button className="new-chat" onClick={openConversation} disabled={createChat.isPending}><MessageSquarePlus size={16} />New conversation</button>
      <div className="conversation-title"><span>YOUR CONVERSATIONS</span><b>{conversationQuery.data?.length ?? 0}</b></div>
      <div className="conversation-list">{conversationQuery.isLoading ? <div className="rail-loading"><Loader2 className="spin" size={15} />Loading</div> : conversationQuery.data?.length ? conversationQuery.data.map(item => <button key={item.id} className={item.id === activeConversationId ? "conversation-item active" : "conversation-item"} onClick={() => { setActiveConversationId(item.id); setMobileHistory(false); }}><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></button>) : <div className="rail-empty"><Sparkles size={16} /><span>Open a conversation to begin.</span></div>}</div>
      <div className="rail-status"><span className="online-dot" />{models.length} callable model{models.length === 1 ? "" : "s"}</div>
    </aside>
    {mobileHistory && <button className="rail-scrim" onClick={() => setMobileHistory(false)} aria-label="Close conversation history" />}
    <section className="chat-stage">
      <header className="chat-topbar"><div className="top-left"><button className="history-trigger" onClick={() => setMobileHistory(true)}><Menu size={18} /></button><div><p>GODMODE / PRIVATE THREAD</p><h1>{conversation?.title || "New conversation"}</h1></div></div><div className="top-actions"><span className="connection-dot" />{diagnostics.filter(item => item.healthy).length} provider{diagnostics.filter(item => item.healthy).length === 1 ? "" : "s"} online<button onClick={() => setSettingsOpen(true)}><Settings2 size={17} />Configuration</button></div></header>
      <div className="chat-scroll"><div className="chat-thread">
        {!activeConversationId ? <WelcomeCard onNew={openConversation} onConnect={() => setSettingsOpen(true)} /> : detailQuery.isLoading ? <div className="thread-loading"><Loader2 className="spin" />Opening encrypted conversation…</div> : messages.length ? messages.map(message => { const retryable = message.providerId !== "openrouter" || Boolean(message.modelId && callableModelKeys.has(`openrouter:${message.modelId}`)); return <ChatBubble key={message.id} message={message} canRetry={retryable} onChooseFree={() => setSettingsOpen(true)} onRetry={async () => { try { await retryChat.mutateAsync({ messageId: message.id }); await utils.godmode.chat.detail.invalidate({ conversationId: activeConversationId }); } catch (error) { toast.error(error instanceof Error ? error.message : "Retry failed."); } }} retrying={retryChat.isPending} />; }) : <EmptyThread />}
        {busy && <div className="assistant-thinking"><ProviderGlyph providerId={selectedModels[0]?.providerId || "platform"} /><span>Awaiting genuine provider outcome</span><i /><i /><i /></div>}
        <div ref={messageEnd} />
      </div></div>
      <form className="composer-wrap" onSubmit={submitMessage}><div className="selection-pill"><button type="button" onClick={() => setSettingsOpen(true)}><Cpu size={14} />{selectedModels.length ? `${selectedModels.length} ${mode === "competition" ? "models competing" : "model selected"}` : "Select model"}<ChevronDown size={13} /></button><span>{mode === "competition" ? <><Split size={12} />COMPARE</> : <><Bot size={12} />DIRECT</>}</span></div><textarea value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(); } }} placeholder={models.length ? "Message GODMODE…" : "Connect OpenRouter or Respan to begin…"} rows={1} disabled={busy} /><div className="composer-footer"><span><Terminal size={12} />Enter to send · Shift+Enter for new line</span><button className="send-command" disabled={!composer.trim() || busy} type="submit">{busy ? <Loader2 className="spin" size={16} /> : <SendHorizontal size={16} />}<span>Send</span></button></div></form>
    </section>
    <aside className={`settings-dock ${settingsOpen ? "visible" : ""}`}><button className="settings-close" onClick={() => setSettingsOpen(false)}><X size={18} /></button><div className="settings-head"><p>WORKSPACE CONTROLS</p><h2>Route the conversation.</h2><span>Every selection below is verified live before it can receive a message.</span></div><section className="settings-block"><div className="block-label"><KeyRound size={14} />PROVIDER CONNECTIONS</div>{diagnostics.filter(item => item.providerId !== "platform").map(item => <div className="provider-row" key={item.providerId}><ProviderGlyph providerId={item.providerId} /><div><strong>{item.providerName}</strong><small>{item.healthy ? `${item.modelCount} callable models` : item.configured ? item.error || "Connection needs attention" : "Optional connection"}</small></div>{item.healthy ? <button className="quiet-action danger" onClick={() => void disconnect(item.providerId as "openrouter" | "respan")}>Disconnect</button> : <button className="quiet-action" onClick={() => setConnectProvider(item.providerId as "openrouter" | "respan")}>Connect</button>}</div>)}<button className="refresh-action" onClick={() => refreshProviders.mutate(undefined, { onSuccess: () => utils.godmode.providers.list.invalidate(), onError: () => toast.error("Provider refresh failed.") })} disabled={refreshProviders.isPending}><RefreshCw className={refreshProviders.isPending ? "spin" : ""} size={14} />Refresh live registry</button></section><section className="settings-block"><div className="block-label"><Sparkles size={14} />SYSTEM PROMPT</div><textarea className="system-prompt" value={systemPrompt} onChange={event => setSystemPrompt(event.target.value)} onBlur={() => void persistConfiguration()} placeholder="Define the behavior, tone, constraints, and context for this conversation…" rows={5} /><p className="subtle-note">Sent before chat history on every real provider request. It is private to this conversation.</p></section><section className="settings-block"><div className="block-label"><Gauge size={14} />MODEL ROUTING <span className="free-only-badge">OPENROUTER FREE ONLY</span></div><div className="mode-toggle"><button className={mode === "solo" ? "active" : ""} onClick={() => { setMode("solo"); setSelectedModels(current => current.slice(0, 1)); }}><Bot size={13} />Direct</button><button className={mode === "competition" ? "active" : ""} onClick={() => setMode("competition")}><Split size={13} />Compare</button></div><p className="subtle-note free-policy">Paid OpenRouter models are excluded. The free router may choose a currently available free model automatically.</p><div className="model-picker">{models.length ? models.map(model => { const selected = selectedModels.some(item => item.providerId === model.providerId && item.modelId === model.modelId); return <button key={model.key} className={selected ? "model-option selected" : "model-option"} onClick={() => toggleModel({ providerId: model.providerId, modelId: model.modelId })}><span className="selection-check">{selected && <Check size={12} />}</span><ProviderGlyph providerId={model.providerId} /><span><strong>{model.displayName}</strong><small>{model.providerName}{model.contextLength ? ` · ${Intl.NumberFormat().format(model.contextLength)} ctx` : ""}</small></span></button>; }) : <div className="no-model-card"><TriangleAlert size={16} /><span>No callable free model. Connect OpenRouter or Respan and verify the key.</span></div>}</div></section></aside>
    {connectProvider && <div className="connect-overlay"><form className="connect-card" onSubmit={connect}><button type="button" className="connect-close" onClick={() => { setConnectProvider(undefined); setApiKey(""); }}><X size={18} /></button><ProviderGlyph providerId={connectProvider} /><p>{connectProvider === "openrouter" ? "OPENROUTER" : "RESPAN"} CONNECTION</p><h2>Connect an API key.</h2><span>The key is sent only to the server, verified with a live model request, and encrypted before persistence. It never returns to this browser.</span><label>API KEY<input autoFocus type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={connectProvider === "openrouter" ? "sk-or-v1-…" : "Paste Respan API key"} /></label><button className="signal-primary" disabled={!apiKey.trim() || attachProvider.isPending}>{attachProvider.isPending ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}Verify and connect</button></form></div>}
  </main>;
}

function WelcomeCard({ onNew, onConnect }: { onNew: () => void; onConnect: () => void }) {
  return <div className="welcome-thread"><div className="welcome-sigil"><span>G</span><i /></div><p>GODMODE CONVERSATION LAYER</p><h2>Start with a thought.<br /><em>Route it with intent.</em></h2><span>Connect an API provider, choose a live model, configure its behavior, then work through a real conversation with transparent output metadata.</span><div><button className="signal-primary" onClick={onNew}><MessageSquarePlus size={16} />Start a conversation</button><button className="welcome-secondary" onClick={onConnect}><Settings2 size={16} />Connect provider</button></div></div>;
}

function EmptyThread() { return <div className="thread-empty"><Sparkles size={22} /><h2>Thread is ready.</h2><span>Set a system prompt or send the first message. Only real provider responses will appear here.</span></div>; }

function ChatBubble({ message, onRetry, onChooseFree, canRetry, retrying }: { message: { id: string; role: string; content: string; providerId: string | null; modelId: string | null; status: string; errorMessage: string | null; latencyMs: number | null; totalTokens: number | null; createdAt: Date }; onRetry: () => void; onChooseFree: () => void; canRetry: boolean; retrying: boolean }) {
  const isUser = message.role === "user";
  if (isUser) return <article className="message-row user"><div className="message-copy"><p>{message.content}</p></div><span className="user-mark">YOU</span></article>;
  return <article className={`message-row assistant ${message.status === "failed" ? "failure" : ""}`}><ProviderGlyph providerId={(message.providerId || "platform") as ProviderId} /><div className="message-copy"><div className="message-meta"><span>{message.modelId || "Provider"}</span>{message.status === "failed" ? <b><TriangleAlert size={12} />FAILED</b> : <b><Check size={12} />COMPLETE</b>}</div>{message.status === "failed" ? <div className="failure-copy"><TriangleAlert size={15} /><span>{message.errorMessage || "The provider did not return a usable response."}</span></div> : <div className="markdown-response"><Suspense fallback={<span>Rendering result…</span>}><Streamdown>{message.content}</Streamdown></Suspense></div>}<footer><span><Clock3 size={12} />{duration(message.latencyMs)}</span><span><Cpu size={12} />{message.totalTokens?.toLocaleString() ?? "—"} tokens</span>{message.status === "failed" && (canRetry ? <button onClick={onRetry} disabled={retrying}><RotateCcw size={12} />Retry exact model</button> : <button onClick={onChooseFree}><Settings2 size={12} />Choose a free model</button>)}{message.status === "completed" && <button onClick={() => navigator.clipboard.writeText(message.content).then(() => toast.success("Response copied."))}><Copy size={12} />Copy</button>}</footer></div></article>;
}
