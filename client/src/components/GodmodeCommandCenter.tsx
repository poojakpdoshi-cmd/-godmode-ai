import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  CircleOff,
  Clock3,
  Command,
  Cpu,
  FileText,
  Gauge,
  Layers3,
  Loader2,
  Menu,
  Network,
  Play,
  Plus,
  Radar,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type View = "mission" | "operations" | "providers";
type SelectedModel = { providerId: "platform" | "openrouter" | "respan" | "nvidia"; modelId: string };

const navItems: Array<{ id: View; label: string; icon: typeof Command }> = [
  { id: "mission", label: "Mission Control", icon: Command },
  { id: "operations", label: "Operations", icon: Activity },
  { id: "providers", label: "Model Registry", icon: Cpu },
];

const Streamdown = lazy(async () => {
  const module = await import("streamdown");
  return { default: module.Streamdown };
});

function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return "—";
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1_000).toFixed(2)}s`;
}

function formatNumber(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat().format(value);
}

function statusTone(status: string) {
  if (["completed", "succeeded"].includes(status)) return "good";
  if (["failed"].includes(status)) return "bad";
  if (["partial", "running", "queued"].includes(status)) return "warn";
  return "quiet";
}

function StatusChip({ status, label }: { status: string; label?: string }) {
  return <span className={`status-chip ${statusTone(status)}`}><span className="status-orb" />{label ?? status.replaceAll("_", " ")}</span>;
}

function Metric({ label, value, icon: Icon, tone = "cyan" }: { label: string; value: string | number; icon: typeof Activity; tone?: "cyan" | "green" | "amber" }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}><Icon size={15} /></div>
      <div><p>{label}</p><strong>{value}</strong></div>
    </div>
  );
}

function LoginGate() {
  return (
    <main className="login-gate cyber-canvas">
      <section className="login-panel hud-panel">
        <div className="brand-mark"><span>G</span><i /></div>
        <p className="eyebrow">GODMODE AI / SECURE ACCESS</p>
        <h1>AI engineering<br /><em>under command.</em></h1>
        <p className="login-copy">Authenticate to open your private mission workspace. Projects, model activity, and execution telemetry remain isolated to your account.</p>
        <button className="primary-command" onClick={() => startLogin()}><ShieldAlert size={17} />Authenticate operator<ArrowUpRight size={16} /></button>
      </section>
    </main>
  );
}

export default function GodmodeCommandCenter() {
  const { user, loading } = useAuth();
  const [view, setView] = useState<View>("mission");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedMissionId, setSelectedMissionId] = useState<string>();
  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [mode, setMode] = useState<"solo" | "competition">("solo");
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const utils = trpc.useUtils();
  const projectsQuery = trpc.godmode.projects.list.useQuery(undefined, { enabled: Boolean(user) });
  const modelQuery = trpc.godmode.models.list.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 60_000 });
  const missionInput = useMemo(() => ({ projectId: selectedProjectId || "pending-project" }), [selectedProjectId]);
  const missionsQuery = trpc.godmode.missions.list.useQuery(missionInput, { enabled: Boolean(selectedProjectId) });
  const missionDetailInput = useMemo(() => ({ missionId: selectedMissionId || "pending-mission" }), [selectedMissionId]);
  const missionDetailQuery = trpc.godmode.missions.detail.useQuery(missionDetailInput, { enabled: Boolean(selectedMissionId), refetchInterval: selectedMissionId ? 8_000 : false });
  const operationsQuery = trpc.godmode.operations.summary.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 30_000 });
  const createProject = trpc.godmode.projects.create.useMutation();
  const createMission = trpc.godmode.missions.create.useMutation();
  const executeMission = trpc.godmode.missions.execute.useMutation();
  const retryRun = trpc.godmode.missions.retry.useMutation();
  const refreshModels = trpc.godmode.models.refresh.useMutation();

  const models = modelQuery.data?.models ?? [];
  const currentMission = missionDetailQuery.data;
  const isExecuting = createMission.isPending || executeMission.isPending || retryRun.isPending;

  useEffect(() => {
    if (!selectedProjectId && projectsQuery.data?.[0]) setSelectedProjectId(projectsQuery.data[0].id);
  }, [projectsQuery.data, selectedProjectId]);

  useEffect(() => {
    if (mode === "solo" && selectedModels.length > 1) setSelectedModels(selectedModels.slice(0, 1));
  }, [mode, selectedModels]);

  useEffect(() => {
    if (models.length && !selectedModels.length) {
      setSelectedModels([{ providerId: models[0].providerId, modelId: models[0].modelId }]);
    }
  }, [models, selectedModels.length]);

  if (loading) return <main className="boot-screen cyber-canvas"><Loader2 className="spin" size={24} /><span>INITIALIZING SECURE WORKSPACE</span></main>;
  if (!user) return <LoginGate />;

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const project = await createProject.mutateAsync({ name: newProjectName.trim() });
      setSelectedProjectId(project.id);
      setCreatingProject(false);
      setNewProjectName("");
      await utils.godmode.projects.list.invalidate();
      toast.success("Workspace created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create workspace.");
    }
  }

  function updateSelection(model: SelectedModel) {
    setSelectedModels(current => {
      const exists = current.some(item => item.providerId === model.providerId && item.modelId === model.modelId);
      if (mode === "solo") return [model];
      return exists ? current.filter(item => !(item.providerId === model.providerId && item.modelId === model.modelId)) : [...current, model];
    });
  }

  async function handleLaunch() {
    if (!selectedProjectId) { toast.error("Create or select a workspace first."); return; }
    if (!title.trim() || !command.trim()) { toast.error("A mission title and command are required."); return; }
    if (!models.length) { toast.error("No configured callable models are available."); return; }
    if (mode === "solo" && selectedModels.length !== 1) { toast.error("Select exactly one model for solo mode."); return; }
    if (mode === "competition" && selectedModels.length < 2) { toast.error("Select two or more real models for competition."); return; }
    try {
      const mission = await createMission.mutateAsync({ projectId: selectedProjectId, title: title.trim(), command: command.trim(), systemPrompt: systemPrompt.trim() || undefined, mode });
      setSelectedMissionId(mission.id);
      await utils.godmode.missions.list.invalidate({ projectId: selectedProjectId });
      const detail = await executeMission.mutateAsync({ missionId: mission.id, selections: selectedModels });
      await utils.godmode.missions.detail.invalidate({ missionId: mission.id });
      await utils.godmode.operations.summary.invalidate();
      toast.success(detail?.mission.status === "completed" ? "Mission completed." : "Mission settled with diagnostics.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mission execution could not start.");
    }
  }

  async function handleRetry(runId: string) {
    try {
      await retryRun.mutateAsync({ runId });
      if (selectedMissionId) await utils.godmode.missions.detail.invalidate({ missionId: selectedMissionId });
      await utils.godmode.operations.summary.invalidate();
      toast.success("Retry completed. Inspect the updated run history.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed to start.");
    }
  }

  return (
    <main className="godmode-shell cyber-canvas">
      <aside className={`nav-rail ${mobileOpen ? "open" : ""}`} aria-label="Primary navigation">
        <div className="rail-top">
          <div className="brand-lockup"><div className="brand-mark"><span>G</span><i /></div><div><strong>GODMODE</strong><small>AI SYSTEMS</small></div></div>
          <button className="rail-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="nav-label">COMMAND SURFACES</div>
        <nav>{navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? "nav-link active" : "nav-link"} onClick={() => { setView(item.id); setMobileOpen(false); }}><Icon size={17} /><span>{item.label}</span><ChevronRight size={13} /></button>; })}</nav>
        <div className="rail-bottom">
          <div className="operator-card"><span className="operator-dot" /><div><small>OPERATOR</small><strong>{user.name || user.email || "Authenticated user"}</strong></div></div>
          <button className="nav-link settings" onClick={() => setView("providers")}><Settings2 size={17} /><span>Provider setup</span></button>
        </div>
      </aside>
      {mobileOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <section className="main-frame">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumb"><span>GODMODE</span><i>/</i><strong>{view === "mission" ? "Mission control" : view === "operations" ? "Operations" : "Model registry"}</strong></div></div>
          <div className="system-state"><span className="pulse-dot" />LIVE SYSTEM <span className="divider" />{models.length} CALLABLE MODELS</div>
        </header>
        <div className="workspace">
          {view === "mission" && <MissionView />}
          {view === "operations" && <OperationsView />}
          {view === "providers" && <ProvidersView />}
        </div>
      </section>

      {creatingProject && <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="Create workspace"><form className="modal-card hud-panel" onSubmit={handleCreateProject}><button className="modal-close" type="button" onClick={() => setCreatingProject(false)}><X size={17} /></button><p className="eyebrow">NEW WORKSPACE</p><h2>Establish a project boundary.</h2><p>Projects isolate missions, execution records, and event timelines in your private workspace.</p><label>Project name<input autoFocus value={newProjectName} onChange={event => setNewProjectName(event.target.value)} placeholder="e.g. Platform migration" maxLength={180} /></label><button className="primary-command" disabled={createProject.isPending}>{createProject.isPending ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}Create workspace</button></form></div>}
      <button className="new-workspace-fab" onClick={() => setCreatingProject(true)}><Plus size={17} /><span>NEW WORKSPACE</span></button>
    </main>
  );

  function MissionView() {
    const activeProject = projectsQuery.data?.find(project => project.id === selectedProjectId);
    return (
      <div className="mission-layout">
        <section className="mission-stage">
          <div className="page-heading"><div><p className="eyebrow">ACTIVE COMMAND SURFACE</p><h1>Mission <em>control</em></h1><p>Submit only to models verified as callable at this moment. Every real outcome becomes part of the audit trail.</p></div><div className="heading-badge"><Radar size={18} /><span>NETWORK<br /><strong>READY</strong></span></div></div>
          <div className="workspace-switcher hud-panel"><div><span className="label">WORKSPACE</span><strong>{activeProject?.name ?? "No workspace selected"}</strong></div><div className="project-tabs">{projectsQuery.isLoading ? <Loader2 className="spin" size={16} /> : projectsQuery.data?.map(project => <button key={project.id} className={project.id === selectedProjectId ? "project-tab active" : "project-tab"} onClick={() => { setSelectedProjectId(project.id); setSelectedMissionId(undefined); }}>{project.name}</button>)}</div></div>
          {!projectsQuery.isLoading && !projectsQuery.data?.length ? <EmptyWorkspace onCreate={() => setCreatingProject(true)} /> : <>
            <section className="command-panel hud-panel">
              <div className="panel-kicker"><TerminalSquare size={15} />MISSION INPUT <span>01</span></div>
              <div className="command-grid"><label className="command-title-field"><span>MISSION NAME</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="Define the objective" maxLength={180} /></label><label className="command-field"><span>COMMAND</span><textarea value={command} onChange={event => setCommand(event.target.value)} placeholder="Describe the outcome, constraints, and required output..." rows={6} maxLength={32_000} /></label><label className="system-prompt-field"><span>SYSTEM CONTEXT <i>OPTIONAL</i></span><textarea value={systemPrompt} onChange={event => setSystemPrompt(event.target.value)} placeholder="Additional operating instructions" rows={2} maxLength={16_000} /></label></div>
            </section>
            <section className="routing-panel hud-panel">
              <div className="panel-kicker"><Network size={15} />MODEL ROUTING <span>02</span></div>
              <div className="mode-row"><div><strong>Execution strategy</strong><p>Competition preserves each model’s genuine outcome. GODMODE does not invent a winner.</p></div><div className="segmented"><button className={mode === "solo" ? "active" : ""} onClick={() => setMode("solo")}><Bot size={15} />Solo</button><button className={mode === "competition" ? "active" : ""} onClick={() => setMode("competition")}><Layers3 size={15} />Competition</button></div></div>
              {modelQuery.isLoading ? <div className="model-loading"><Loader2 className="spin" size={16} />Checking configured providers…</div> : models.length ? <div className="model-matrix">{models.map(model => { const selected = selectedModels.some(item => item.providerId === model.providerId && item.modelId === model.modelId); return <button className={selected ? "model-card selected" : "model-card"} key={model.key} onClick={() => updateSelection({ providerId: model.providerId, modelId: model.modelId })}><span className="model-select">{selected ? <Check size={13} /> : null}</span><span className="model-info"><small>{model.providerName}</small><strong>{model.displayName}</strong><em>{model.contextLength ? `${formatNumber(model.contextLength)} ctx` : "Capabilities discovered at runtime"}</em></span>{model.supportsVision && <span className="capability-tag">VISION</span>}</button>; })}</div> : <NoModels diagnostics={modelQuery.data?.diagnostics} />}
              <div className="launch-row"><div className="selection-led"><span className={selectedModels.length ? "pulse-dot" : "status-orb"} />{selectedModels.length ? `${selectedModels.length} real model${selectedModels.length > 1 ? "s" : ""} selected` : "Select an available model"}</div><button className="primary-command" onClick={handleLaunch} disabled={isExecuting || !models.length}>{isExecuting ? <><Loader2 className="spin" size={16} />Executing real requests…</> : <><Send size={16} />Launch mission<ArrowUpRight size={15} /></>}</button></div>
            </section>
          </>}
        </section>
        <aside className="intel-column">
          <div className="intel-header"><div><p className="eyebrow">EXECUTION INTEL</p><h2>Live record</h2></div>{currentMission?.mission && <StatusChip status={currentMission.mission.status} />}</div>
          <div className="mission-list hud-panel"><div className="list-heading"><span>MISSION HISTORY</span><span>{missionsQuery.data?.length ?? 0}</span></div>{missionsQuery.isLoading ? <div className="list-empty"><Loader2 className="spin" size={16} />Loading workspace history</div> : missionsQuery.data?.length ? <div className="mission-items">{missionsQuery.data.map(mission => <button key={mission.id} className={mission.id === selectedMissionId ? "mission-item selected" : "mission-item"} onClick={() => setSelectedMissionId(mission.id)}><div><strong>{mission.title}</strong><span>{mission.mode === "competition" ? "COMPETITION" : "SOLO"} · {new Date(mission.createdAt).toLocaleDateString()}</span></div><StatusChip status={mission.status} /></button>)}</div> : <div className="list-empty"><FileText size={18} />No missions have been recorded in this workspace.</div>}</div>
          <RunEvidence detail={currentMission} onRetry={handleRetry} isRetrying={retryRun.isPending} />
          <EventTimeline events={currentMission?.events ?? []} />
        </aside>
      </div>
    );
  }

  function OperationsView() {
    const data = operationsQuery.data;
    return <div className="operations-view"><div className="page-heading"><div><p className="eyebrow">OPERATIONS CONSOLE</p><h1>System <em>telemetry</em></h1><p>Availability, execution outcomes, and provider diagnostics shown as observed—never inferred.</p></div><button className="icon-command" onClick={() => { refreshModels.mutate(undefined, { onSuccess: () => toast.success("Provider catalog refreshed."), onError: () => toast.error("Unable to refresh provider catalog.") }); }} disabled={refreshModels.isPending}><RefreshCw className={refreshModels.isPending ? "spin" : ""} size={17} />Refresh health</button></div>{operationsQuery.isLoading ? <div className="console-loading hud-panel"><Loader2 className="spin" />Loading operator telemetry…</div> : <><section className="metrics-row"><Metric icon={Cpu} label="CALLABLE MODELS" value={data?.health.availableModels ?? 0} tone="green" /><Metric icon={Activity} label="HEALTHY PROVIDERS" value={`${data?.health.healthyProviders ?? 0}/${data?.health.providerCount ?? 0}`} /><Metric icon={ShieldAlert} label="RECENT FAILURES" value={data?.health.recentFailureCount ?? 0} tone="amber" /><Metric icon={Gauge} label="REFRESH WINDOW" value="30s" /></section><section className="operations-grid"><div className="hud-panel diagnostic-board"><div className="panel-kicker"><Radar size={15} />PROVIDER HEALTH</div>{data?.registry.diagnostics.map(diagnostic => <div className="diagnostic-line" key={diagnostic.providerId}><span className={diagnostic.healthy ? "health-symbol good" : diagnostic.configured ? "health-symbol warn" : "health-symbol quiet"}>{diagnostic.healthy ? <Check size={14} /> : diagnostic.configured ? <AlertTriangle size={14} /> : <CircleOff size={14} />}</span><div><strong>{diagnostic.providerName}</strong><p>{diagnostic.healthy ? `${diagnostic.modelCount} callable model${diagnostic.modelCount === 1 ? "" : "s"}` : diagnostic.error}</p></div><StatusChip status={diagnostic.healthy ? "completed" : diagnostic.configured ? "partial" : "draft"} label={diagnostic.healthy ? "ONLINE" : diagnostic.configured ? "DEGRADED" : "UNCONFIGURED"} /></div>)}</div><div className="hud-panel run-board"><div className="panel-kicker"><Clock3 size={15} />RECENT EXECUTIONS</div>{data?.runs.length ? data.runs.map(run => <div className="recent-run" key={run.id}><span className="run-marker" /><div><strong>{run.modelId}</strong><p>{run.providerId} · {new Date(run.createdAt).toLocaleString()}</p></div><div className="run-stat"><StatusChip status={run.status} /><span>{formatDuration(run.latencyMs)}</span></div></div>) : <div className="list-empty"><Activity size={18} />No execution has completed for this operator yet.</div>}</div></section></>}</div>;
  }

  function ProvidersView() {
    return <div className="providers-view"><div className="page-heading"><div><p className="eyebrow">MODEL REGISTRY</p><h1>Callable <em>by design</em></h1><p>The registry contains only models returned by live discovery from configured server-side providers.</p></div><button className="icon-command" onClick={() => { refreshModels.mutate(undefined, { onSuccess: () => toast.success("Catalog refreshed from configured providers."), onError: () => toast.error("Provider refresh failed.") }); }} disabled={refreshModels.isPending}><RefreshCw className={refreshModels.isPending ? "spin" : ""} size={17} />Sync registry</button></div><section className="provider-configuration hud-panel"><div className="provider-config-icon"><Settings2 size={19} /></div><div><p className="eyebrow">LOCAL / HOSTED CONFIGURATION</p><h2>Provider keys remain server-side.</h2><p>For a local package run, set <code>OPENROUTER_API_KEY</code> in the host environment using the included <code>.env.example</code> template, then restart the server. The registry will verify the connection before exposing a model. GODMODE never places a credential in the browser.</p></div></section><section className="registry-grid">{modelQuery.isLoading ? <div className="console-loading hud-panel"><Loader2 className="spin" />Discovering configured models…</div> : models.length ? models.map(model => <article className="registry-card hud-panel" key={model.key}><div className="registry-top"><span className="provider-mark">{model.providerId === "platform" ? "P" : "OR"}</span><StatusChip status="completed" label="CALLABLE" /></div><h2>{model.displayName}</h2><p>{model.providerName}</p><dl><div><dt>MODEL ID</dt><dd>{model.modelId}</dd></div><div><dt>CONTEXT</dt><dd>{model.contextLength ? formatNumber(model.contextLength) : "Not exposed"}</dd></div><div><dt>INPUT</dt><dd>{model.inputTypes.join(", ")}</dd></div></dl></article>) : <NoModels diagnostics={modelQuery.data?.diagnostics} />}</section></div>;
  }
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return <section className="empty-workspace hud-panel"><div className="empty-icon"><Layers3 size={22} /></div><p className="eyebrow">NO WORKSPACE DETECTED</p><h2>Create the first operational boundary.</h2><p>Workspaces keep projects, missions, model outputs, and audits scoped to your account.</p><button className="primary-command" onClick={onCreate}><Plus size={16} />Create workspace</button></section>;
}

function NoModels({ diagnostics }: { diagnostics?: Array<{ providerName: string; configured: boolean; error?: string }> }) {
  return <section className="no-models"><div className="empty-icon"><Cpu size={21} /></div><div><strong>No callable model is available.</strong><p>GODMODE will not substitute a placeholder. Configure a provider in the host environment and use the registry refresh control to perform live discovery.</p>{diagnostics?.map(diagnostic => <span className="diagnostic-note" key={diagnostic.providerName}>{diagnostic.providerName}: {diagnostic.error || (diagnostic.configured ? "verification pending" : "not configured")}</span>)}</div></section>;
}

function RunEvidence({ detail, onRetry, isRetrying }: { detail?: { runs: Array<{ id: string; modelId: string; providerId: string; status: string; output: string | null; errorMessage: string | null; latencyMs: number | null; totalTokens: number | null }> }; onRetry: (runId: string) => void; isRetrying: boolean }) {
  if (!detail?.runs.length) return <div className="run-evidence hud-panel"><div className="list-heading"><span>RUN EVIDENCE</span><span>—</span></div><div className="list-empty"><TerminalSquare size={18} />Select a mission to inspect actual outputs and metadata.</div></div>;
  return <div className="run-evidence hud-panel"><div className="list-heading"><span>RUN EVIDENCE</span><span>{detail.runs.length}</span></div><div className="run-evidence-stack">{detail.runs.map(run => <article className="evidence-card" key={run.id}><div className="evidence-head"><div><small>{run.providerId.toUpperCase()}</small><strong>{run.modelId}</strong></div><StatusChip status={run.status} /></div>{run.status === "succeeded" ? <div className="markdown-output"><Suspense fallback={<div className="output-loading">Preparing safe result viewer…</div>}><Streamdown>{run.output || "The provider returned an empty response."}</Streamdown></Suspense></div> : <div className="failure-output"><AlertTriangle size={15} /><span>{run.errorMessage || "The provider returned no diagnosable error."}</span></div>}<div className="evidence-meta"><span><Clock3 size={12} />{formatDuration(run.latencyMs)}</span><span><Zap size={12} />{formatNumber(run.totalTokens)} tokens</span>{run.status === "failed" && <button onClick={() => onRetry(run.id)} disabled={isRetrying}><RotateCcw size={12} />Retry</button>}</div></article>)}</div></div>;
}

function EventTimeline({ events }: { events: Array<{ id: string; type: string; level: string; summary: string; detail: string | null; createdAt: Date }> }) {
  return <div className="event-timeline"><div className="list-heading"><span>AUDIT TIMELINE</span><span>{events.length}</span></div>{events.length ? events.slice(0, 8).map(event => <div className="timeline-item" key={event.id}><span className={`timeline-dot ${event.level}`} /><div><strong>{event.summary}</strong><p>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · {event.type.replaceAll("_", " ")}</p>{event.detail && <small>{event.detail}</small>}</div></div>) : <div className="timeline-empty">No events yet. Event records appear only after an actual action occurs.</div>}</div>;
}
