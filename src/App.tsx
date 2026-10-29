import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { ARM_IDS, REJECTION_CODES } from "../cli/core/schemas.js";
import type { GateDecision, RunRecord } from "../cli/core/schemas.js";
import { loadIndex, loadRun } from "./lib/runData.js";
import type { RunBundle } from "./lib/runData.js";
import { appendRulings, latestRulings, parseRulings, readRulings, rulingKey, rulingsJsonl, rulingStorageKey } from "./lib/rulingsStore.js";
import type { Ruling } from "../cli/core/schemas.js";
import { isRolledBack, reviewItems } from "./lib/review.js";
import type { ReviewItem } from "./lib/review.js";

type Page = "runs" | "subjects" | "trace" | "results" | "approvals";
interface Route { page: Page; runId?: string; subjectId?: string; valid: boolean }
const pages: { id: Page; label: string; icon: string }[] = [
  { id: "runs", label: "Run library", icon: "▦" }, { id: "subjects", label: "Mutant map", icon: "◇" },
  { id: "trace", label: "Candidate trace", icon: "⌘" }, { id: "results", label: "Results", icon: "▤" },
  { id: "approvals", label: "Review queue", icon: "✓" },
];
function readRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length || (parts.length === 1 && parts[0] === "runs")) return { page: "runs", valid: true };
  const page = parts[2];
  if (parts[0] !== "runs" || !parts[1] || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parts[1]) ||
    !pages.some((p) => p.id === page && p.id !== "runs") || parts.length > (page === "subjects" ? 4 : 3) ||
    (parts[3] !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[3]))) return { page: "runs", valid: false };
  return { page: page as Page, runId: parts[1], ...(parts[3] ? { subjectId: parts[3] } : {}), valid: true };
}
const href = (page: Page, runId?: string, subjectId?: string) => page === "runs" || !runId ? "#/runs" :
  `#/runs/${runId}/${page}${page === "subjects" && subjectId ? `/${subjectId}` : ""}`;
const short = (hash: string) => hash.slice(0, 10);
const percent = (value: number | null) => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
const number = (value: number | null) => value === null ? "n/a" : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const dollars = (value: number | null) => value === null ? "n/a" : `$${value.toFixed(4)}`;
const cellKey = (c: { subjectId: string; arm: string; repeat: number }) => `${c.subjectId}/${c.arm}/${c.repeat}`;

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Status({ value }: { value: string }) {
  const tone = ["Killed", "accepted", "approve", "complete"].includes(value) ? "good" :
    ["Timeout", "incomplete", "partial-budget", "missing"].includes(value) ? "warning" :
      ["Survived", "rejected", "reject", "error", "partial-error", "refused", "RuntimeError"].includes(value) ? "danger" : "neutral";
  return <Badge tone={tone}>{value}</Badge>;
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><span className="empty-symbol" aria-hidden="true">◇</span><h3>{title}</h3><p>{children}</p></div>;
}
function Panel({ title, eyebrow, children, action }: { title: string; eyebrow?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action}</div>{children}</section>;
}
function Provenance({ run }: { run: RunRecord }) {
  return <div className="provenance">
    {run.providerMode === "mock" && <div className="notice notice-mock"><strong>MOCK</strong><span>No live provider measurement. Replay or illustrative output must not be treated as experimental evidence.</span></div>}
    {run.executionProvenance === "recorded-fixture" && <div className="notice notice-sample"><strong>SAMPLE</strong><span>Fictional demonstration data. Counts, timing, tokens, scores and outcomes were authored; nothing here was measured.</span></div>}
    {run.executionProvenance === "replay-executed" && <div className="notice"><strong>REPLAY</strong><span>Recorded responses executed locally; this is not a fresh live-provider experiment.</span></div>}
    {!run.sandboxQualified && <p className="qualification">Sandbox unqualified · excluded from sandbox-qualified measurements</p>}
  </div>;
}
function AnalysisNotice({ bundle }: { bundle: RunBundle }) {
  if (bundle.analysis) return null;
  return <Empty title={bundle.analysisError ? "Analysis could not be loaded" : "Analysis not yet available"}>
    {bundle.analysisError ?? "This run has no post-freeze analysis companion. Run evaluation locally and publish the matching sanitized JSON to see scoring and planted outcomes."}
  </Empty>;
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [bundles, setBundles] = useState<RunBundle[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const change = () => setRoute(readRoute());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setErrors([]); setBundles([]);
    void (async () => {
      try {
        const ids = await loadIndex(controller.signal);
        const loaded = await Promise.allSettled(ids.map((id) => loadRun(id, controller.signal)));
        if (controller.signal.aborted) return;
        setBundles(loaded.flatMap((r) => r.status === "fulfilled" ? [r.value] : []));
        setErrors(loaded.flatMap((r, i) => r.status === "rejected" ? [`${ids[i]}: ${r.reason instanceof Error ? r.reason.message : "Invalid run data"}`] : []));
      } catch (error) {
        if (!controller.signal.aborted) setErrors([error instanceof Error ? error.message : "Run catalog could not be loaded"]);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [revision]);
  const selected = bundles.find((b) => b.run.runId === route.runId);
  const navRun = selected?.run.runId ?? bundles[0]?.run.runId;
  const label = pages.find((p) => p.id === route.page)?.label ?? "Run library";
  return <div className="workspace">
    <a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="#/runs"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M7 8h8l4 8-4 8H7l4-8-4-8Zm14 0h4l-4 8 4 8h-4l-4-8 4-8Z" /></svg></span><span>Mutant<span className="brand-light"> / lab</span><small>TEST GENERATION WORKBENCH</small></span></a>
      <div className="nav-caption">WORKSPACE</div>
      <nav aria-label="Workspace navigation">{pages.map((p) => <a key={p.id} className={route.page === p.id ? "nav-link active" : "nav-link"} aria-current={route.page === p.id ? "page" : undefined}
        href={href(p.id, navRun)}><span aria-hidden="true">{p.icon}</span>{p.label}{p.id === "runs" && <span className="nav-count">{bundles.length}</span>}</a>)}</nav>
      <div className="sidebar-bottom"><span className="offline-dot" /> STATIC VIEWER<p>Inspect evidence. Review locally.<br />Execution stays in the CLI.</p><span className="sidebar-version">S39 · schema v1</span></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{label}</strong></div><div className="topbar-right"><span className="local-pill">Local review</span><button className="icon-button" onClick={() => setRevision((r) => r + 1)} disabled={loading} aria-label="Reload run catalog">↻</button></div></header>
      <main id="main" tabIndex={-1}>
        <div className="page-heading"><div><p className="eyebrow">MUTATION-GATED TEST GENERATION</p><h1>{label}</h1><p className="subtitle">{route.page === "runs" ? "Follow each candidate from proposal to a defensible test suite." : selected ? `${selected.run.runId} · ${selected.run.split} · edition ${selected.run.manifestEdition}` : "Inspect a published run from the library."}</p></div>
          {route.page !== "runs" && bundles.length > 0 && <label className="field compact">Active run<select value={route.runId ?? ""} onChange={(e) => { window.location.hash = href(route.page, e.target.value).slice(1); }}>{bundles.map((b) => <option key={b.run.runId}>{b.run.runId}</option>)}</select></label>}</div>
        {errors.length > 0 && <div className="error-box" role="alert"><strong>Some data could not be loaded or validated</strong>{errors.map((e) => <p key={e}>{e}</p>)}<button onClick={() => setRevision((r) => r + 1)}>Try again</button></div>}
        {loading ? <div className="loading" role="status">Loading and validating run data…</div> : !route.valid ? <Empty title="Route not found"><a href="#/runs">Return to the run library</a></Empty> : route.page === "runs" ? <RunLibrary bundles={bundles} /> : !selected ? <Empty title="Run not found">Choose a run from the library. <a href="#/runs">Open run library</a></Empty> : <>
          <Provenance run={selected.run} />
          {route.page === "subjects" && <MutantMap key={`${selected.run.runId}/${route.subjectId ?? ""}`} bundle={selected} requestedSubject={route.subjectId} />}
          {route.page === "trace" && <Trace key={selected.run.runId} run={selected.run} />}
          {route.page === "results" && <Results bundle={selected} />}
          {route.page === "approvals" && <Approvals key={selected.run.runId} run={selected.run} />}
        </>}
        <footer className="footer">A new test earns its place by killing a new feedback mutant.<span>Scoring remains disjoint · sample data is illustrative</span></footer>
      </main>
    </div>
  </div>;
}

function RunLibrary({ bundles }: { bundles: RunBundle[] }) {
  if (!bundles.length) return <Empty title="Your run library is empty">Publish sanitized run records and add their IDs to public/runs/index.json. The viewer will show them here.</Empty>;
  const measured = bundles.filter((b) => b.run.executionProvenance === "measured").length;
  return <>
    <div className="hero"><div><span className="hero-label">EVIDENCE BEFORE ACCEPTANCE</span><h2>Small tests.<br />Meaningful mutations.</h2><p>Explore feedback, inspect disjoint scoring, and review the exact bytes proposed for your suite.</p><a className="button button-light" href={href("subjects", bundles[0]?.run.runId)}>Explore latest run <span aria-hidden="true">↗</span></a></div><svg className="hero-art" viewBox="0 0 320 190" aria-hidden="true"><path d="M25 95h70m30 0h65m30 0h75M110 30v50m0 30v50m95-130v50m0 30v50"/><circle cx="110" cy="95" r="16"/><circle cx="205" cy="95" r="16"/><circle cx="110" cy="30" r="9"/><circle cx="110" cy="160" r="9"/><circle cx="205" cy="30" r="9"/><circle cx="205" cy="160" r="9"/><path className="hero-check" d="m102 95 5 5 11-12m79 7 5 5 11-12"/><rect x="20" y="83" width="24" height="24" rx="5"/><rect x="278" y="83" width="24" height="24" rx="5"/></svg></div>
    <div className="stat-grid"><Stat label="Published runs" value={bundles.length} detail="Schema and identity validated" /><Stat label="Measured runs" value={measured} detail={measured ? "Check qualification per run" : "Not yet measured"} /><Stat label="Subject snapshots" value={new Set(bundles.flatMap((b) => b.run.subjects.map((s) => `${s.id}/${s.srcSha256}`))).size} detail="Source hashes keep editions separate" /><Stat label="Review model" value="Local" detail="Append-only JSONL rulings" /></div>
    <Panel title="Published runs" eyebrow="RUN CATALOG" action={<span className="muted">{bundles.length} available</span>}><div className="table-scroll"><table><thead><tr><th>Run / provenance</th><th>Status</th><th>Scope</th><th>Units kept</th><th>USD</th><th aria-label="Actions" /></tr></thead><tbody>{bundles.map(({ run }) => <tr key={run.runId}><td><a className="primary-link" href={href("subjects", run.runId)}>{run.runId}</a><div className="metadata"><Badge tone={run.providerMode === "mock" ? "warning" : "neutral"}>{run.providerMode.toUpperCase()}</Badge>{run.executionProvenance === "recorded-fixture" && <Badge tone="purple">SAMPLE</Badge>}<span>{run.createdAt.slice(0, 10)}</span></div></td><td><Status value={run.status} /></td><td>{run.subjects.length} subject{run.subjects.length === 1 ? "" : "s"}<small>{run.split} · {run.arms.join(", ")}</small></td><td>{new Set(run.cells.flatMap((c) => c.keptUnits)).size}</td><td className="mono">{dollars(run.totals.usd)}</td><td><a className="text-action" href={href("trace", run.runId)}>Inspect ↗</a></td></tr>)}</tbody></table></div></Panel>
    <p className="help-text">MOCK and SAMPLE entries are demonstrations, not measured experimental results. Real measurements appear only when matching local artifacts are published.</p>
  </>;
}
function Stat({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return <div className="stat"><p>{label}</p><strong>{value}</strong><small>{detail}</small></div>;
}

function MutantMap({ bundle, requestedSubject }: { bundle: RunBundle; requestedSubject?: string }) {
  const { run, analysis } = bundle;
  const [subjectId, setSubjectId] = useState(requestedSubject ?? run.subjects[0]?.id ?? "");
  const [selectedCell, setSelectedCell] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const subject = run.subjects.find((s) => s.id === subjectId);
  const inventory = analysis?.inventories.find((i) => i.subjectId === subjectId);
  const cells = analysis?.cells.filter((c) => c.subjectId === subjectId) ?? [];
  const cell = cells.find((c) => cellKey(c) === selectedCell) ?? cells.find((c) => c.arm === "A5") ?? cells[0];
  const targets = inventory ? [...inventory.mutants.map((m) => ({ id: m.key, kind: m.partition, label: m.source, range: m.range })),
    ...inventory.planted.map((t) => ({ id: t.trapId, kind: "planted", label: `${t.trap} · ${t.label}`, range: t.range }))] : [];
  const outcomes = (id: string) => cell?.matrix.filter((m) => (m.mutantKey ?? m.trapId) === id) ?? [];
  const visible = targets.filter((t) => (kind === "all" || t.kind === kind) && (status === "all" || outcomes(t.id).some((m) => m.status === status)));
  return <>
    <div className="toolbar"><label className="field">Subject<select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setSelectedCell(""); setExpanded(null); }}>{run.subjects.map((s) => <option key={s.id}>{s.id}</option>)}</select></label><label className="field">Arm / repeat<select value={cell ? cellKey(cell) : ""} onChange={(e) => setSelectedCell(e.target.value)}>{cells.map((c) => <option key={cellKey(c)} value={cellKey(c)}>{c.arm} · repeat {c.repeat} · {c.state}</option>)}</select></label><div className="toolbar-note">Feedback informs generation.<br />Scoring and planted targets are post-freeze only.</div></div>
    {!subject ? <Empty title="Subject not found">Choose a published subject from the selector above.</Empty> : <>
      <div className="subject-strip"><div><strong>{subject.id}</strong><code title={subject.srcSha256}>source {short(subject.srcSha256)}</code></div><Badge>{inventory?.engine ?? "inventory pending"}</Badge><span>{inventory?.compileErrorCount ?? "n/a"} compile-error mutants</span></div>
      {!analysis ? <AnalysisNotice bundle={bundle} /> : !inventory ? <Empty title="Inventory not available">This subject has no validated post-freeze inventory yet. No outcomes are inferred.</Empty> : <>
        <div className="stat-grid"><Stat label="Feedback targets" value={inventory.mutants.filter((m) => m.partition === "feedback").length} detail="Visible to the generation policy" /><Stat label="Scoring targets" value={inventory.mutants.filter((m) => m.partition === "scoring").length} detail="Disjoint post-freeze partition" /><Stat label="Planted traps" value={inventory.planted.length} detail="Reported separately from generated mutants" /><Stat label="Cell analysis" value={cell?.state ?? "n/a"} detail={cell?.issues.join(", ") || "Validated public companion"} /></div>
        <Panel title="Mutant inventory" eyebrow="TARGET-LEVEL EVIDENCE" action={<div className="legend"><span className="dot good" /> Killed <span className="dot danger" /> Survived <span className="dot warning" /> Timeout</div>}>
          <div className="filter-bar"><label className="field inline">Partition<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All partitions</option><option value="feedback">Feedback</option><option value="scoring">Scoring</option><option value="planted">Planted</option></select></label><label className="field inline">Outcome<select value={status} onChange={(e) => setStatus(e.target.value)}>{["all", "Killed", "Survived", "Timeout", "NoCoverage", "CompileError", "RuntimeError", "Ignored"].map((s) => <option value={s} key={s}>{s === "all" ? "All outcomes" : s}</option>)}</select></label><span className="muted">{visible.length} targets</span></div>
          {!visible.length ? <Empty title="No matching targets">Change the partition or outcome filter.</Empty> : <div className="target-list">{visible.map((target) => <div className="target" key={target.id}><button className="target-summary" onClick={() => setExpanded(expanded === target.id ? null : target.id)} aria-expanded={expanded === target.id}><span className="target-range">L{target.range.start.line}<small>:{target.range.start.column}–{target.range.end.line}:{target.range.end.column}</small></span><span className="target-name"><strong>{target.kind === "planted" ? target.id : short(target.id)}</strong><small>{target.label}</small></span><Badge tone={target.kind === "feedback" ? "blue" : target.kind === "planted" ? "purple" : "neutral"}>{target.kind}</Badge><span className="outcomes">{[...new Set(outcomes(target.id).map((m) => m.status))].map((s) => <Status key={s} value={s} />)}{!outcomes(target.id).length && <Badge>not observed</Badge>}</span><span aria-hidden="true">{expanded === target.id ? "−" : "+"}</span></button>{expanded === target.id && <div className="target-detail"><p className="mono break">{target.id}</p><p>Recorded executions are listed separately. A timeout is never a new-kill admission.</p>{outcomes(target.id).map((m, i) => <div className="execution" key={i}><Status value={m.status} /><span>{m.unitSha256s.length} unit(s)</span>{m.unitSha256s.map((key) => <details key={key}><summary><code>{short(key)}</code> · {run.units.find((u) => u.unitSha256 === key)?.testName ?? "unit unavailable"}</summary><pre><code>{run.units.find((u) => u.unitSha256 === key)?.text ?? "No unit text published"}</code></pre></details>)}</div>)}{!outcomes(target.id).length && <p>No recorded outcome for this cell.</p>}</div>}</div>)}</div>}
        </Panel>
      </>}
    </>}
  </>;
}

function Trace({ run }: { run: RunRecord }) {
  const [code, setCode] = useState("all");
  const [candidateId, setCandidateId] = useState(run.candidates[0]?.candidateId ?? "");
  const candidates = run.candidates.filter((c) => code === "all" || run.gateDecisions.some((g) => g.candidateId === c.candidateId && (code === "accepted" ? g.decision === "accepted" : g.decision === "rejected" && g.code === code)));
  const candidate = candidates.find((c) => c.candidateId === candidateId) ?? candidates[0];
  const decisions = run.gateDecisions.filter((g) => g.candidateId === candidate?.candidateId);
  const decisionUnits = new Set(decisions.flatMap((d) => d.unitSha256 === null ? [] : [d.unitSha256]));
  const units = run.units.filter((u) => u.candidateId === candidate?.candidateId || decisionUnits.has(u.unitSha256));
  return <>
    <div className="stat-grid"><Stat label="Candidate files" value={run.candidates.length} detail="Original content identity retained" /><Stat label="Accepted decisions" value={run.gateDecisions.filter((g) => g.decision === "accepted").length} detail="Check rollback events before review" /><Stat label="Rejected decisions" value={run.gateDecisions.filter((g) => g.decision === "rejected").length} detail="Seven public rejection codes" /><Stat label="Run errors" value={run.runErrors.length} detail="Separate from candidate rejections" /></div>
    <Panel title="Candidate journey" eyebrow="GATE TRACE" action={<label className="field inline">Disposition<select value={code} onChange={(e) => setCode(e.target.value)}>{["all", "accepted", ...REJECTION_CODES].map((c) => <option key={c}>{c}</option>)}</select></label>}>
      {!candidates.length ? <Empty title="No matching candidates">Baseline arms may have no model candidates. Choose a different disposition or run.</Empty> : <div className="trace-layout"><div className="candidate-list" aria-label="Candidates">{candidates.map((c) => <button className={candidate?.candidateId === c.candidateId ? "candidate-button selected" : "candidate-button"} key={c.candidateId} onClick={() => setCandidateId(c.candidateId)}><span className="candidate-round">R{c.round} <span>#{c.slot}</span></span><strong>{c.subjectId}</strong><span>{c.arm} · repeat {c.repeat}</span><code>{short(c.fileSha256)}</code></button>)}</div><div className="trace-detail">{candidate && <><div className="detail-heading"><div><p className="eyebrow">{candidate.arm} · ROUND {candidate.round} · SLOT {candidate.slot}</p><h3>{candidate.subjectId}</h3></div><Badge>{candidate.byteLength} bytes</Badge></div><p className="mono break muted">{candidate.candidateId}<br />file sha256 {candidate.fileSha256}</p>{decisions.map((decision, index) => <Decision key={index} decision={decision} rolledBack={isRolledBack(run, decision)} />)}{!decisions.length && <p className="help-text">No gate decision was published for this candidate.</p>}{units.map((unit) => <div key={unit.unitSha256} className="code-card"><div><strong>{unit.testName}</strong><small>Unit {unit.index + 1} · {unit.byteLength} bytes · {short(unit.unitSha256)}</small></div><pre><code>{unit.text}</code></pre></div>)}{!units.length && <p className="help-text">No unit text is available. Whole-file syntax rejections can occur before unit extraction; source is not reconstructed.</p>}</>}</div></div>}
    </Panel>
    <Panel title="Run errors" eyebrow="EXECUTION EVENTS">{run.runErrors.length ? <div className="error-events">{run.runErrors.map((error, index) => <article key={index}><div><Badge tone="danger">{error.kind}</Badge><span className="muted">{error.subjectId ?? "run"} · {error.arm ?? "all arms"} · {error.fatal ? "fatal" : "non-fatal"}</span></div><p>{error.message}</p><small>{error.at}{error.rolledBack.length ? ` · ${error.rolledBack.length} unit admission(s) rolled back` : ""}</small></article>)}</div> : <p className="panel-note">No run errors in this record.</p>}</Panel>
  </>;
}
function Decision({ decision, rolledBack }: { decision: GateDecision; rolledBack: boolean }) {
  return <article className="decision"><div className="decision-heading"><Status value={decision.decision} />{decision.decision === "rejected" && <code>{decision.code}</code>}{rolledBack && <Badge tone="danger">rolled back</Badge>}<time>{decision.at}</time></div><h4>{decision.testName ?? "Whole candidate file"}</h4>{decision.decision === "accepted" ? <p>{decision.newKills.length} new feedback kill(s){decision.coveredLinesGained !== null ? ` · ${decision.coveredLinesGained} new covered line(s)` : ""}<br /><span className="mono break muted">{decision.stagedAs}</span></p> : <p>{decision.subReason && <strong>{decision.subReason}: </strong>}{decision.detail}</p>}</article>;
}

function Results({ bundle }: { bundle: RunBundle }) {
  const { run, analysis } = bundle;
  const [arm, setArm] = useState("all");
  if (!analysis) return <AnalysisNotice bundle={bundle} />;
  const rows = analysis.cells.filter((c) => arm === "all" || c.arm === arm);
  const incomplete = analysis.cells.some((c) => c.state === "incomplete") || run.missingCells.length > 0 || run.status !== "complete";
  return <>
    <div className="notice"><strong>{incomplete ? "INCOMPLETE" : "PER-RUN VIEW"}</strong><span>{incomplete ? "not computable — incomplete campaign" : "Campaign aggregates and paired bootstrap intervals require the local campaign evaluation report; they are not inferred from a single run."}</span></div>
    <Panel title="Cell-level results" eyebrow="DISJOINT SCORING" action={<label className="field inline">Arm<select value={arm} onChange={(e) => setArm(e.target.value)}><option value="all">All arms</option>{run.arms.map((a) => <option key={a}>{a}</option>)}</select></label>}>
      <div className="table-scroll"><table className="results-table"><thead><tr><th>Subject / arm</th><th>State</th><th>Raw</th><th>Killed only</th><th>Without eq.</th><th>Overfit</th><th>Coverage</th><th>Tokens in / out</th><th>USD</th><th>pp / USD</th></tr></thead><tbody>{rows.map((cell) => <tr key={cellKey(cell)}><td><strong>{cell.subjectId}</strong><small>{cell.arm} · repeat {cell.repeat}</small></td><td><Status value={cell.state} /></td><td>{cell.row ? percent(cell.row.scoreRaw) : "n/a"}</td><td>{cell.row ? percent(cell.row.scoreKilledOnly) : "n/a"}</td><td>{cell.row ? percent(cell.row.scoreWithoutEquivalents) : "n/a"}</td><td>{cell.row ? percent(cell.row.overfit.rate) : "n/a"}</td><td>{cell.row ? percent(cell.row.lineCoverage) : "n/a"}</td><td className="mono">{number(cell.accounting.inputTokens)} / {number(cell.accounting.outputTokens)}</td><td className="mono">{dollars(cell.accounting.usd)}</td><td>{cell.row ? number(cell.row.scoreGainPerDollarPp) : "n/a"}<small>{cell.row?.gainBaseline ? `vs ${cell.row.gainBaseline}` : "non-model"}</small></td></tr>)}</tbody></table></div>
      {!rows.length && <Empty title="No matching result cells">Select another arm.</Empty>}
      <p className="panel-note">Raw = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage). Compile and runtime errors are separate. A timeout contributes to raw score, never to new-kill acceptance. Null metrics remain n/a.</p>
    </Panel>
    <div className="two-column">{rows.map((cell) => <Panel key={cellKey(cell)} title={`${cell.subjectId} · ${cell.arm} / ${cell.repeat}`} eyebrow="ACCOUNTING & LIMITS"><div className="result-details">{cell.row && <><div className="count-strip"><span><strong>{cell.row.counts.killed}</strong>Killed</span><span><strong>{cell.row.counts.timeout}</strong>Timeout</span><span><strong>{cell.row.counts.survived}</strong>Survived</span><span><strong>{cell.row.counts.noCoverage}</strong>No coverage</span></div><p>{cell.row.counts.compileError} compile errors · {cell.row.counts.runtimeError} runtime errors · {cell.row.labelledEquivalents} labelled equivalents</p><p>Overfit: {cell.row.overfit.failingTwin}/{cell.row.overfit.accepted} accepted units fail twin; {cell.row.overfit.twinIncomplete} incomplete. {cell.topUpOverfit && <>A6 top-up only: {percent(cell.topUpOverfit.rate)} ({cell.topUpOverfit.failingTwin}/{cell.topUpOverfit.accepted}).</>}</p><p>Cost per accepted test: {dollars(cell.row.costPerAcceptedTestUsd)} · Run errors: {cell.accounting.runErrors}</p>{cell.row.planted.map((trap) => <div className="trap-result" key={trap.trapId}><span>{trap.trap}<small>{trap.label}</small></span><Status value={trap.status} /></div>)}</>}{[...cell.issues, ...(cell.row?.naReasons ?? [])].map((issue, i) => <p key={i} className="help-text">{issue}</p>)}{!cell.row && <p>No evaluated row. Missing evidence is not a zero score.</p>}</div></Panel>)}</div>
  </>;
}

function Approvals({ run }: { run: RunRecord }) {
  const scope = run.executionProvenance === "recorded-fixture" ? "sample" : "real";
  const [records, setRecords] = useState<Ruling[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("kill-gated");
  const [reviewer, setReviewer] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const read = () => {
    try { setRecords(readRulings(window.localStorage, scope)); setStorageError(null); }
    catch (error) { setStorageError(error instanceof Error ? error.message : "Local storage unavailable"); }
  };
  useEffect(() => {
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);
  const all = reviewItems(run);
  const items = all.filter((item) => filter === "all" || (filter === "kill-gated" ? ["A5", "A6"].includes(item.decision.arm) : item.decision.arm === filter));
  const latest = latestRulings(records);
  async function append(incoming: readonly Ruling[]) {
    setBusy(true); setMessage("");
    try {
      const write = () => setRecords(appendRulings(window.localStorage, incoming, scope));
      // Serialize cooperating tabs so append order cannot silently lose another viewer's write.
      if (navigator.locks) await navigator.locks.request(rulingStorageKey(scope), write); else write();
      setStorageError(null); setMessage(`${incoming.length} ruling(s) appended to the local log.`);
    } catch (error) { setStorageError(error instanceof Error ? error.message : "Rulings could not be saved"); }
    finally { setBusy(false); }
  }
  function rule(item: ReviewItem, decision: "approve" | "reject") {
    if (!reviewer.trim() || !why.trim()) { setMessage("Enter a reviewer label and a reason before recording a ruling."); return; }
    void append([{ schemaVersion: 1, kind: "test-accept", runId: run.runId, subjectId: item.decision.subjectId,
      subjectSha256: item.subjectHash, testSha256: item.unit.unitSha256, decision, who: reviewer.trim(), why: why.trim(), when: new Date().toISOString() }]);
  }
  async function importLog(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget, file = input.files?.[0];
    if (!file) return;
    try { const incoming = parseRulings(await file.text()); await append(incoming); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Import failed; no rulings imported"); }
    input.value = "";
  }
  function download() {
    try {
      const current = readRulings(window.localStorage, scope);
      setRecords(current);
      const url = URL.createObjectURL(new Blob([rulingsJsonl(current)], { type: "application/x-ndjson" }));
      const a = document.createElement("a"); a.href = url; a.download = scope === "sample" ? "testgen-SAMPLE-rulings.jsonl" : "testgen-rulings.jsonl"; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setStorageError(error instanceof Error ? error.message : "Could not export local log"); }
  }
  return <>
    <div className="notice"><strong>LOCAL RULINGS</strong><span>Reviewer labels are self-declared. Rulings append in log order; a later reject revokes an approval. A changed source hash is a separate review. Nothing is applied by this viewer.</span></div>
    {run.executionProvenance === "recorded-fixture" && <div className="notice notice-sample"><strong>DEMONSTRATION ONLY</strong><span>This demonstration uses a separate SAMPLE log. Sample approvals cannot be applied without a real matching source run and immutable staged unit. Downloaded sample rulings are not an execution or apply receipt.</span></div>}
    {storageError && <div className="error-box" role="alert"><strong>Local ruling storage failed</strong><p>{storageError}</p><p>No success is assumed. Export or retry after restoring storage access; malformed saved data is never replaced.</p><button onClick={read}>Retry reading storage</button></div>}
    {message && <p className="status-message" role="status">{message}</p>}
    <Panel title="Reviewer workspace" eyebrow="APPEND-ONLY REVIEW" action={<div className="button-row"><label className={`button file-button ${busy ? "disabled" : ""}`}>Import JSONL<input type="file" accept=".jsonl,.ndjson,.json,text/plain,application/x-ndjson" disabled={busy} onChange={(e) => { void importLog(e); }} /></label><button onClick={download} disabled={busy || storageError !== null}>{scope === "sample" ? "Download SAMPLE log" : "Download whole log"} ({records.length})</button></div>}><div className="review-form"><label className="field">Local reviewer label<input value={reviewer} maxLength={100} placeholder="e.g. local-reviewer" onChange={(e) => setReviewer(e.target.value)} /></label><label className="field reason-field">Reason for the next ruling<textarea value={why} maxLength={2000} rows={2} placeholder="Why should this exact unit be approved or rejected?" onChange={(e) => setWhy(e.target.value)} /></label></div></Panel>
    <Panel title="Accepted units awaiting review" eyebrow="HUMAN DECISION" action={<label className="field inline">Arm filter<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="kill-gated">A5 / A6 · kill-gated</option><option value="all">All arms</option>{ARM_IDS.map((a) => <option key={a}>{a}</option>)}</select></label>}>
      {!items.length ? <Empty title="No reviewable units in this filter">Only accepted, retained units with a concrete source hash appear here. Rolled-back admissions and baseline suites without gate decisions are excluded.</Empty> : <div className="review-list">{items.map((item) => {
        const tuple = { subjectId: item.decision.subjectId, subjectSha256: item.subjectHash, testSha256: item.unit.unitSha256 };
        const ruling = latest.get(rulingKey(tuple));
        const stale = records.some((r) => r.subjectId === tuple.subjectId && r.testSha256 === tuple.testSha256 && r.subjectSha256 !== tuple.subjectSha256);
        return <article className="review-card" key={`${cellKey(item.decision)}/${item.unit.unitSha256}`}><div className="review-card-heading"><div><p className="eyebrow">{item.decision.subjectId} · {item.decision.arm} · REPEAT {item.decision.repeat}</p><h3>{item.unit.testName}</h3></div>{ruling ? <Status value={ruling.decision} /> : <Badge tone="warning">unreviewed</Badge>}</div><div className="metadata"><code>source {short(item.subjectHash)}</code><code>unit {short(item.unit.unitSha256)}</code><span>{item.decision.newKills.length} new feedback kill(s)</span></div>{stale && <p className="help-text">A ruling exists for another source hash; it does not approve this snapshot.</p>}<details><summary>Inspect exact unit bytes</summary><pre><code>{item.unit.text}</code></pre></details>{ruling && <div className="ruling-history"><strong>{ruling.who}</strong> · {ruling.when}<p>{ruling.why}</p><small>Provenance run: {ruling.runId}</small></div>}<div className="review-actions"><span className="muted">Exact source + exact test</span><button disabled={busy || storageError !== null} onClick={() => rule(item, "reject")}>Reject / revoke</button><button className="button-primary" disabled={busy || storageError !== null} onClick={() => rule(item, "approve")}>Approve unit</button></div></article>;
      })}</div>}
    </Panel>
    <details className="audit-log"><summary>Local ordered log · {records.length} entries</summary><p className="help-text">All imported records remain in this log, including other runs and revoked approvals. Imports append their complete line order; timestamps do not reorder history.</p><pre><code>{rulingsJsonl(records) || "No local rulings yet."}</code></pre></details>
  </>;
}
