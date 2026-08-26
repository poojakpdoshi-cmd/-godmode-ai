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
  Search,
  Terminal,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ResearchSources, ResearchTiming, splitResearchContent } from "./ResearchResponseMeta";
import { defaultFastestSelection } from "@/lib/modelRouting";
import "@/chat-free-only.css";
import "@/chat-legacy-model.css";
import "@/chat-system-prompt.css";

const Streamdown = lazy(async () => {
  const module = await import("streamdown");
  return { default: module.Streamdown };
});

type ProviderId = "platform" | "openrouter" | "respan";
type SelectedModel = { providerId: ProviderId; modelId: string };
type ChatModel = { key: string; providerId: ProviderId; modelId: string; displayName: string; providerName: string; contextLength?: number | null };
const EMPTY_MODELS: ChatModel[] = [];

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
  const [savedSystemPrompt, setSavedSystemPrompt] = useState("");
  const [researchMode, setResearchMode] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamFirstTokenMs, setStreamFirstTokenMs] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState("Opening fastest available free model…");
  const [streamModelId, setStreamModelId] = useState("OpenRouter fast route");
  const [streamProviderId, setStreamProviderId] = useState<ProviderId>("openrouter");
  const [respanFallbackEnabled, setRespanFallbackEnabled] = useState(false);
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

  const models = providerQuery.data?.models ?? EMPTY_MODELS;
  const diagnostics = providerQuery.data?.diagnostics ?? [];
  const respanConnected = diagnostics.some(item => item.providerId === "respan" && item.healthy);
  const conversation = detailQuery.data?.conversation;
  const messages = detailQuery.data?.messages ?? [];
  const busy = sendChat.isPending || createChat.isPending || retryChat.isPending || isStreaming;
  const callableModelKeys = useMemo(() => new Set(models.map(model => `${model.providerId}:${model.modelId}`)), [models]);
  const measuredManagedFastModel = useMemo(() => ["claude-haiku-4-5", "gpt-5-mini", "gpt-5-nano"].flatMap(modelId => models.filter(model => model.providerId === "platform" && model.modelId === modelId))[0] || models.find(model => model.providerId === "platform"), [models]);
  const hasInvalidSelection = Boolean(selectedModels.length) && selectedModels.some(item => !callableModelKeys.has(`${item.providerId}:${item.modelId}`));
  const hasUnsavedPrompt = systemPrompt.trim() !== savedSystemPrompt;
  const promptCharacterLimit = 60_000;
  const promptNearLimit = systemPrompt.length > 48_000;

  useEffect(() => {
    if (!activeConversationId && conversationQuery.data?.[0]) setActiveConversationId(conversationQuery.data[0].id);
  }, [activeConversationId, conversationQuery.data]);

  useEffect(() => {
    if (!conversation) return;
    setSystemPrompt(conversation.systemPrompt ?? "");
    setSavedSystemPrompt((conversation.systemPrompt ?? "").trim());
    setMode(conversation.mode);
    setRespanFallbackEnabled(conversation.respanFallback === "yes");
    try {
      const parsed = JSON.parse(conversation.selectedModels) as SelectedModel[];
      setSelectedModels(parsed);
    } catch { setSelectedModels([]); }
  }, [conversation?.id]);

  useEffect(() => {
    const sameSelections = (left: SelectedModel[], right: SelectedModel[]) => left.length === right.length && left.every((item, index) => item.providerId === right[index]?.providerId && item.modelId === right[index]?.modelId);
    setSelectedModels(current => {
      if (!models.length) return current.length ? [] : current;
      const currentModels = current.filter(item => callableModelKeys.has(`${item.providerId}:${item.modelId}`));
      const next = currentModels.length ? currentModels : defaultFastestSelection(models);
      return sameSelections(current, next) ? current : next;
    });
  }, [callableModelKeys, models]);

  useEffect(() => { messageEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages.length, busy]);

  if (loading) return <main className="chat-loading"><Loader2 className="spin" size={24} /><span>Synchronizing private workspace</span></main>;
  if (!user) return <LoginScreen />;

  async function openConversation() {
    try {
      const created = await createChat.mutateAsync({ systemPrompt: systemPrompt.trim() || undefined, respanFallback: respanFallbackEnabled });
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
    if (!activeConversationId) { toast.message("Start a new conversation first; its saved system prompt will govern every model request."); return; }
    try {
      const normalizedPrompt = systemPrompt.trim();
      await configureChat.mutateAsync({ conversationId: activeConversationId, systemPrompt: normalizedPrompt || null, mode, selections: selectedModels, respanFallback: respanFallbackEnabled });
      setSavedSystemPrompt(normalizedPrompt);
      await utils.godmode.chat.detail.invalidate({ conversationId: activeConversationId });
      toast.success(normalizedPrompt ? "System prompt saved and active for orchestration." : "System prompt cleared for this conversation.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the system prompt.";
      if (message.includes("Too big") || message.includes("60000")) toast.error("System prompt is over the supported 60,000-character limit. Shorten it, then save again.");
      else toast.error(message);
    }
  }

  async function saveRespanFallbackPreference(next: boolean) {
    if (!activeConversationId) { toast.message("Start a conversation before saving a fallback preference."); return; }
    try {
      await configureChat.mutateAsync({ conversationId: activeConversationId, respanFallback: next });
      setRespanFallbackEnabled(next);
      await utils.godmode.chat.detail.invalidate({ conversationId: activeConversationId });
      toast.success(next ? "Respan fallback enabled for this conversation." : "Respan fallback disabled for this conversation.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save the fallback preference."); }
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = composer.trim();
    if (!content || busy) return;
    if (hasUnsavedPrompt) { toast.message("Save your system prompt first so the orchestrator uses the exact policy you wrote."); setSettingsOpen(true); return; }
    if (!models.length) { toast.error("Connect OpenRouter to load the currently available free models."); setSettingsOpen(true); return; }
    if (hasInvalidSelection) { toast.error("Your old model is retired. Select a current free model to continue."); setSettingsOpen(true); return; }
    if (mode === "solo" && selectedModels.length !== 1) { toast.error("Choose one callable model."); return; }
    if (mode === "competition" && selectedModels.length < 2) { toast.error("Choose at least two callable models for comparison."); return; }
    const conversationId = activeConversationId || await openConversation();
    if (!conversationId) return;
    setComposer("");
    try {
      if (mode === "solo" && !researchMode && selectedModels[0]?.providerId === "openrouter") {
        setIsStreaming(true); setStreamingContent(""); setStreamFirstTokenMs(null); setStreamStatus("Opening strict free fast route…"); setStreamModelId("OpenRouter free fast route"); setStreamProviderId("openrouter");
        const response = await fetch("/api/godmode/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, content, selection: selectedModels[0] }) });
        if (!response.ok || !response.body) throw new Error("The streaming route could not be opened. Retry once.");
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let divider = buffer.indexOf("\n\n"); while (divider !== -1) { const event = buffer.slice(0, divider); buffer = buffer.slice(divider + 2); divider = buffer.indexOf("\n\n"); const type = event.match(/^event:\s*(.+)$/m)?.[1]; const payload = event.match(/^data:\s*(.+)$/m)?.[1]; if (!payload) continue; const parsed = JSON.parse(payload) as { chunk?: string; message?: string; firstTokenMs?: number; latencyMs?: number; modelId?: string; providerId?: ProviderId; attempt?: number; candidateCount?: number }; if (type === "meta") { if (parsed.modelId) setStreamModelId(parsed.modelId); if (parsed.providerId) setStreamProviderId(parsed.providerId); setStreamStatus(parsed.providerId === "respan" ? "Connected Respan fallback is responding…" : `Testing free model ${parsed.attempt ?? 1}/${parsed.candidateCount ?? 1}…`); } if (type === "status" && parsed.message) setStreamStatus(parsed.message); if (type === "first-token" && parsed.firstTokenMs !== undefined) { setStreamFirstTokenMs(parsed.firstTokenMs); setStreamStatus(parsed.providerId === "respan" ? "Receiving live Respan fallback response…" : "Receiving live response…"); } if (type === "delta" && parsed.chunk) setStreamingContent(current => current + parsed.chunk); if (type === "done") { if (parsed.providerId) setStreamProviderId(parsed.providerId); if (parsed.modelId) setStreamModelId(parsed.modelId); if (parsed.firstTokenMs !== null && parsed.firstTokenMs !== undefined) toast.success(`${parsed.providerId === "respan" ? "Respan fallback · " : ""}First text in ${(parsed.firstTokenMs / 1000).toFixed(1)}s · completed in ${((parsed.latencyMs ?? 0) / 1000).toFixed(1)}s`); } if (type === "error") throw new Error(parsed.message || "The streaming request failed."); } }
        setStreamingContent("");
        await Promise.all([utils.godmode.chat.list.invalidate(), utils.godmode.chat.detail.invalidate({ conversationId })]);
      } else {
        const detail = await sendChat.mutateAsync({ conversationId, content, mode, selections: selectedModels, fast: true, research: researchMode });
        setActiveConversationId(detail?.conversation.id);
        await Promise.all([utils.godmode.chat.list.invalidate(), utils.godmode.chat.detail.invalidate({ conversationId })]);
      }
    } catch (error) {
      setComposer(content);
      const message = error instanceof Error ? error.message : "The chat request was not sent.";
      if (message.includes("not currently configured") || message.includes("paid or retired")) {
        toast.error("Your old model is retired. Select a current free model to continue.");
        setSettingsOpen(true);
      } else if (message.includes("insufficient API credits") || message.includes("free access is not verified")) {
        await utils.godmode.providers.list.invalidate();
        toast.error("OpenRouter free access is blocked for this key/account. Check its key credit limit and account balance, or switch to GODMODE Managed Fast or Respan.");
        setSettingsOpen(true);
      } else toast.error(message);
    } finally { setIsStreaming(false); setStreamingContent(""); setStreamFirstTokenMs(null); setStreamStatus("Opening strict free fast route…"); }
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
        {!activeConversationId ? <WelcomeCard onNew={openConversation} onConnect={() => setSettingsOpen(true)} /> : detailQuery.isLoading ? <div className="thread-loading"><Loader2 className="spin" />Opening encrypted conversation…</div> : messages.length ? messages.map(message => { const retryable = message.providerId !== "openrouter" || Boolean(message.modelId && callableModelKeys.has(`openrouter:${message.modelId}`)); return <ChatBubble key={message.id} message={message} canRetry={retryable} onChooseFree={() => { toast.message("Your old model is retired. Select a current free model to resend this prompt."); setSettingsOpen(true); }} onRetry={async () => { try { await retryChat.mutateAsync({ messageId: message.id }); await utils.godmode.chat.detail.invalidate({ conversationId: activeConversationId }); } catch (error) { const retryMessage = error instanceof Error ? error.message : "Retry failed."; if (retryMessage.includes("not currently configured") || retryMessage.includes("paid or retired")) { toast.error("Your old model is retired. Select a current free model to continue."); setSettingsOpen(true); } else toast.error(retryMessage); } }} retrying={retryChat.isPending} />; }) : <EmptyThread />}
        {isStreaming && <article className="message-row assistant stream-preview"><ProviderGlyph providerId={streamProviderId} /><div className="message-copy"><div className="message-meta"><span>{streamProviderId === "respan" ? "Respan fallback · " : ""}{streamModelId} · streaming</span><b><Zap size={12} />{streamFirstTokenMs === null ? "CONNECTING" : `FIRST TEXT ${(streamFirstTokenMs / 1000).toFixed(1)}s`}</b></div><div className="stream-status">{streamStatus}</div><div className="markdown-response">{streamingContent || "Waiting for the provider’s first text…"}</div></div></article>}
        {busy && !isStreaming && <div className="assistant-thinking"><ProviderGlyph providerId={selectedModels[0]?.providerId || "platform"} /><span>{researchMode ? "Research in progress · sources appear when the provider finalizes them…" : "Generating a compact response…"}</span><i /><i /><i /></div>}
        <div ref={messageEnd} />
      </div></div>
      <form className="composer-wrap" onSubmit={submitMessage}><div className="selection-pill"><button type="button" onClick={() => setSettingsOpen(true)}><Cpu size={14} />{selectedModels.length ? hasInvalidSelection ? "Choose a free model" : `${selectedModels.length} ${mode === "competition" ? "models competing" : "model selected"}` : "Select model"}<ChevronDown size={13} /></button><div className="composer-mode-actions"><button type="button" className={researchMode ? "composer-research active" : "composer-research"} onClick={() => setResearchMode(current => !current)}><Search size={12} />Web Search</button><span>{researchMode ? <><Search size={12} />LIVE RESEARCH</> : mode === "competition" ? <><Split size={12} />COMPARE</> : <><Zap size={12} />FAST ROUTE</>}</span></div></div>{hasInvalidSelection && <p className="legacy-model-warning"><TriangleAlert size={12} />Old paid model removed. Choose a current free model before sending.</p>}<textarea value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(); } }} placeholder={models.length ? hasInvalidSelection ? "Choose a free model in Model Routing…" : researchMode ? "Ask a current-information question…" : "Message GODMODE…" : "Connect OpenRouter or Respan to begin…"} rows={1} disabled={busy} /><div className="composer-footer"><span><Terminal size={12} />{researchMode ? "Live sources · research can take longer" : "Compact replies · bounded context"} · Enter to send</span><button className="send-command" disabled={!composer.trim() || busy || hasInvalidSelection} type="submit">{busy ? <Loader2 className="spin" size={16} /> : <SendHorizontal size={16} />}<span>Send</span></button></div></form>
    </section>
    <aside className={`settings-dock ${settingsOpen ? "visible" : ""}`}><button className="settings-close" onClick={() => setSettingsOpen(false)}><X size={18} /></button><div className="settings-head"><p>WORKSPACE CONTROLS</p><h2>Route the conversation.</h2><span>Every selection below is verified live before it can receive a message.</span></div><section className="settings-block"><div className="block-label"><KeyRound size={14} />PROVIDER CONNECTIONS</div>{diagnostics.filter(item => item.providerId !== "platform").map(item => <div className="provider-row" key={item.providerId}><ProviderGlyph providerId={item.providerId} /><div><strong>{item.providerName}</strong><small>{item.healthy ? `${item.modelCount} callable models` : item.configured ? item.error || "Connection needs attention" : "Optional connection"}</small></div>{item.healthy ? <button className="quiet-action danger" onClick={() => void disconnect(item.providerId as "openrouter" | "respan")}>Disconnect</button> : <button className="quiet-action" onClick={() => setConnectProvider(item.providerId as "openrouter" | "respan")}>Connect</button>}</div>)}<button className="refresh-action" onClick={() => refreshProviders.mutate(undefined, { onSuccess: () => utils.godmode.providers.list.invalidate(), onError: error => toast.error(error.message || "OpenRouter access could not be verified.") })} disabled={refreshProviders.isPending}><RefreshCw className={refreshProviders.isPending ? "spin" : ""} size={14} />Verify live access</button></section><section className="settings-block"><div className="managed-route"><ProviderGlyph providerId="platform" /><div><strong>GODMODE Managed Fast · default fastest</strong><small>Measured server-side speed route. It is explicitly managed, not labeled as an OpenRouter free model.</small>{measuredManagedFastModel && <button className="quiet-action" onClick={() => { setMode("solo"); setSelectedModels([{ providerId: measuredManagedFastModel.providerId, modelId: measuredManagedFastModel.modelId }]); toast.message("Measured managed fastest route selected."); }}>Use measured fastest</button>}</div></div></section><section className="settings-block"><div className="block-label"><Sparkles size={14} />SYSTEM PROMPT</div><textarea className="system-prompt" value={systemPrompt} onChange={event => setSystemPrompt(event.target.value)} placeholder="Define the behavior, tone, constraints, and context for this conversation…" rows={5} maxLength={promptCharacterLimit} /><div className="prompt-save-row"><span className={hasUnsavedPrompt ? "prompt-state unsaved" : "prompt-state saved"}>{hasUnsavedPrompt ? "UNSAVED CHANGES" : activeConversationId ? "SAVED · ACTIVE" : "START A THREAD TO SAVE"}</span><button className="save-prompt" type="button" onClick={() => void persistConfiguration()} disabled={!activeConversationId || !hasUnsavedPrompt || configureChat.isPending}>{configureChat.isPending ? <Loader2 className="spin" size={12} /> : <Check size={12} />}{configureChat.isPending ? "Saving…" : "Save system prompt"}</button></div><div className={promptNearLimit ? "prompt-length near-limit" : "prompt-length"}>{systemPrompt.length.toLocaleString()} / {promptCharacterLimit.toLocaleString()} characters</div><p className="subtle-note">Fast Route compiles long saved prompts to a compact execution policy for speed; your full original prompt remains stored. Compare mode uses full selected-model routing.</p></section><section className="settings-block"><div className="block-label"><Search size={14} />LIVE WEB RESEARCH</div><button type="button" className={researchMode ? "research-toggle active" : "research-toggle"} onClick={() => setResearchMode(current => !current)}><span>{researchMode ? "Research enabled" : "Research off"}</span><small>{researchMode ? "Uses real OpenRouter web search; sources will be linked." : "Use only for current facts; it may take longer."}</small></button></section><section className="settings-block"><div className="block-label"><Gauge size={14} />MODEL ROUTING <span className="free-only-badge">OPENROUTER FREE + MANAGED</span></div><div className="mode-toggle"><button className={mode === "solo" ? "active" : ""} onClick={() => { setMode("solo"); setSelectedModels(current => current.slice(0, 1)); }}><Bot size={13} />Direct</button><button className={mode === "competition" ? "active" : ""} onClick={() => setMode("competition")}><Split size={13} />Compare</button></div><p className="subtle-note free-policy">Default Fastest selects the measured managed route. Choose an OpenRouter free model only when you want the strict free route: one compact attempt, stopped after 2.75 seconds. Paid OpenRouter models remain excluded.</p><div className="model-picker">{models.length ? models.map(model => { const selected = selectedModels.some(item => item.providerId === model.providerId && item.modelId === model.modelId); return <button key={model.key} className={selected ? "model-option selected" : "model-option"} onClick={() => toggleModel({ providerId: model.providerId, modelId: model.modelId })}><span className="selection-check">{selected && <Check size={12} />}</span><ProviderGlyph providerId={model.providerId} /><span><strong>{model.displayName}</strong><small>{model.providerName}{model.contextLength ? ` · ${Intl.NumberFormat().format(model.contextLength)} ctx` : ""}</small></span></button>; }) : <div className="no-model-card"><TriangleAlert size={16} /><span>No usable model route. Verify OpenRouter access or use GODMODE Managed Fast.</span></div>}</div></section></aside>
    {connectProvider && <div className="connect-overlay"><form className="connect-card" onSubmit={connect}><button type="button" className="connect-close" onClick={() => { setConnectProvider(undefined); setApiKey(""); }}><X size={18} /></button><ProviderGlyph providerId={connectProvider} /><p>{connectProvider === "openrouter" ? "OPENROUTER" : "RESPAN"} CONNECTION</p><h2>Connect an API key.</h2><span>The key is sent only to the server, verified with a live model request, and encrypted before persistence. It never returns to this browser.</span><label>API KEY<input autoFocus type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={connectProvider === "openrouter" ? "sk-or-v1-…" : "Paste Respan API key"} /></label><button className="signal-primary" disabled={!apiKey.trim() || attachProvider.isPending}>{attachProvider.isPending ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}Verify and connect</button></form></div>}
    {settingsOpen && <section className="fallback-preference"><div><RefreshCw size={14} /><strong>Resilient streaming</strong></div><button type="button" className={respanFallbackEnabled ? "research-toggle active" : "research-toggle"} disabled={!activeConversationId || !respanConnected || configureChat.isPending} onClick={() => void saveRespanFallbackPreference(!respanFallbackEnabled)}><span>{respanFallbackEnabled ? "Respan fallback enabled" : "Respan fallback off"}</span><small>{respanConnected ? "Only this conversation’s OpenRouter fast stream may switch to Respan after access, rate-limit, or first-text startup failure." : "Connect Respan first. No automatic key rotation or quota bypass."}</small></button></section>}
  </main>;
}

function WelcomeCard({ onNew, onConnect }: { onNew: () => void; onConnect: () => void }) {
  return <div className="welcome-thread"><div className="welcome-sigil"><span>G</span><i /></div><p>GODMODE CONVERSATION LAYER</p><h2>Start with a thought.<br /><em>Route it with intent.</em></h2><span>Connect an API provider, choose a live model, configure its behavior, then work through a real conversation with transparent output metadata.</span><div><button className="signal-primary" onClick={onNew}><MessageSquarePlus size={16} />Start a conversation</button><button className="welcome-secondary" onClick={onConnect}><Settings2 size={16} />Connect provider</button></div></div>;
}

function EmptyThread() { return <div className="thread-empty"><Sparkles size={22} /><h2>Thread is ready.</h2><span>Set a system prompt or send the first message. Only real provider responses will appear here.</span></div>; }

function ChatBubble({ message, onRetry, onChooseFree, canRetry, retrying }: { message: { id: string; role: string; content: string; providerId: string | null; modelId: string | null; researchMode: string; status: string; errorMessage: string | null; firstTokenMs: number | null; latencyMs: number | null; totalTokens: number | null; createdAt: Date }; onRetry: () => void; onChooseFree: () => void; canRetry: boolean; retrying: boolean }) {
  const isUser = message.role === "user";
  const isResearch = message.researchMode === "yes";
  const researchContent = isResearch ? splitResearchContent(message.content) : { body: message.content, sources: [] };
  const isCitedResearch = isResearch && researchContent.sources.length > 0;
  const diagnostic = message.errorMessage?.trim().toLowerCase() === "fetch failed" ? "The provider connection dropped before it returned. No response was generated; retry this model once." : message.errorMessage || "The provider did not return a usable response.";
  if (isUser) return <article className="message-row user"><div className="message-copy"><p>{message.content}</p></div><span className="user-mark">YOU</span></article>;
  return <article className={`message-row assistant ${message.status === "failed" ? "failure" : ""}`}><ProviderGlyph providerId={(message.providerId || "platform") as ProviderId} /><div className="message-copy"><div className="message-meta"><span>{message.modelId || "Provider"}</span>{message.status === "failed" ? <b><TriangleAlert size={12} />FAILED</b> : <b><Check size={12} />COMPLETE</b>}</div>{message.status === "failed" ? <div className="failure-copy"><TriangleAlert size={15} /><span>{diagnostic}</span></div> : <><div className="markdown-response"><Suspense fallback={<span>Rendering result…</span>}><Streamdown>{researchContent.body}</Streamdown></Suspense></div>{isResearch && <ResearchSources sources={researchContent.sources} />}</>}<footer>{isCitedResearch && <span><Search size={12} />Cited research</span>}{isResearch && <ResearchTiming latencyMs={message.latencyMs} />}{message.firstTokenMs !== null && message.firstTokenMs !== undefined && <span><Zap size={12} />First text {duration(message.firstTokenMs)}</span>}{!isResearch && <span><Clock3 size={12} />{duration(message.latencyMs)}</span>}<span><Cpu size={12} />{message.totalTokens?.toLocaleString() ?? "—"} tokens</span>{message.status === "failed" && (canRetry ? <button onClick={onRetry} disabled={retrying}><RotateCcw size={12} />Retry exact model</button> : <button onClick={onChooseFree}><Settings2 size={12} />Choose a free model</button>)}{message.status === "completed" && <button onClick={() => navigator.clipboard.writeText(message.content).then(() => toast.success("Response copied."))}><Copy size={12} />Copy</button>}</footer></div></article>;
}
