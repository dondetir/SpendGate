"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { registerSpendGateTools, CHANGED_EVENT } from "@/lib/webmcp-tools";

type Status = "pending" | "approved" | "flagged" | "rejected";
interface BoardItem {
  id: string;
  employee: string;
  category: string;
  amount: number;
  hasReceipt: boolean;
  vendor: string;
  submittedAt: string;
  status: Status;
  reasons: string[];
  untrusted: boolean;
  requiresApproval: boolean;
}

const REASON_LABEL: Record<string, string> = {
  within_policy: "Within policy",
  over_category_cap: "Over category cap",
  receipt_required: "Receipt missing",
  possible_duplicate: "Possible duplicate",
  over_role_limit: "Over your limit",
  invalid_amount: "Invalid amount",
  disallowed_category: "Category not allowed",
};

const COLUMNS: {
  key: Status;
  label: string;
  dot: string;
  border: string;
  glow: string;
}[] = [
  { key: "pending", label: "Pending", dot: "bg-slate-400", border: "border-slate-400/40", glow: "from-slate-400/[0.05]" },
  { key: "flagged", label: "Needs review", dot: "bg-amber-400", border: "border-amber-400/50", glow: "from-amber-500/[0.06]" },
  { key: "approved", label: "Approved", dot: "bg-emerald-400", border: "border-emerald-400/50", glow: "from-emerald-500/[0.06]" },
  { key: "rejected", label: "Rejected", dot: "bg-rose-400", border: "border-rose-400/50", glow: "from-rose-500/[0.06]" },
];

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const changed = (a: BoardItem, b: BoardItem) =>
  a.status !== b.status || a.requiresApproval !== b.requiresApproval || a.reasons.join() !== b.reasons.join() || a.untrusted !== b.untrusted;

interface FeedLine {
  key: number;
  id: string;
  text: string;
  tone: Status;
}

export default function Home() {
  const [view, setView] = useState<Record<string, BoardItem>>({});
  const [role, setRole] = useState<"analyst" | "manager">("analyst");
  const [webmcp, setWebmcp] = useState<{ supported: boolean; n: number } | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [busy, setBusy] = useState(false);

  const orderRef = useRef<string[]>([]);
  const viewRef = useRef<Record<string, BoardItem>>({});
  const queueRef = useRef<BoardItem[]>([]);
  const feedKey = useRef(0);
  const registered = useRef(false);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const reconcile = useCallback((server: BoardItem[]) => {
    if (orderRef.current.length === 0) orderRef.current = server.map((i) => i.id);
    setView((prev) => {
      const copy = { ...prev };
      for (const s of server) if (!copy[s.id]) copy[s.id] = s; // first sight: show immediately
      return copy;
    });
    for (const s of server) {
      const cur = viewRef.current[s.id];
      if (cur && changed(cur, s) && !queueRef.current.some((q) => q.id === s.id)) {
        queueRef.current.push(s); // changed: drip one at a time
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/board");
    const data = await res.json();
    setRole(data.role ?? "analyst");
    reconcile(data.items ?? []);
    return data.role as "analyst" | "manager";
  }, [reconcile]);

  // drain the change queue one card every ~160ms -> a continuous stream of motion
  useEffect(() => {
    const t = setInterval(() => {
      const next = queueRef.current.shift();
      if (!next) return;
      setView((prev) => ({ ...prev, [next.id]: next }));
      feedKey.current += 1;
      setFeed((f) =>
        [
          {
            key: feedKey.current,
            id: next.id,
            tone: next.status,
            text:
              next.status === "approved"
                ? `${next.id} → approved`
                : `${next.id} → ${next.status}${next.reasons.filter((r) => r !== "within_policy").length ? " · " + next.reasons.filter((r) => r !== "within_policy").map((r) => REASON_LABEL[r] ?? r).join(", ") : ""}`,
          },
          ...f,
        ].slice(0, 6),
      );
    }, 160);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const r = await refresh();
      if (!registered.current) {
        registered.current = true;
        const result = await registerSpendGateTools(r);
        setWebmcp({ supported: result.supported, n: result.registered.length });
      }
    })();
    const onChange = () => refresh();
    window.addEventListener(CHANGED_EVENT, onChange);
    const iv = setInterval(refresh, 1500);
    return () => {
      window.removeEventListener(CHANGED_EVENT, onChange);
      clearInterval(iv);
    };
  }, [refresh]);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await fetch(path, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const switchRole = async (next: "analyst" | "manager") => {
    if (role === next) return;
    await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: next }) });
    await registerSpendGateTools(next).then((r) => setWebmcp({ supported: r.supported, n: r.registered.length }));
    await refresh();
  };

  const items = orderRef.current.map((id) => view[id]).filter(Boolean) as BoardItem[];
  const byStatus = (s: Status) => items.filter((i) => i.status === s);
  const triaged = items.some((i) => i.status !== "pending");
  const untrustedContained = items.filter((i) => i.untrusted && i.status !== "approved").length;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 px-5 py-5">
      <Header role={role} webmcp={webmcp} busy={busy} onSwitch={switchRole} onReset={() => post("/api/reset")} />
      <PromptStrip onRun={() => post("/api/triage", {})} busy={busy} triaged={triaged} />

      {triaged && untrustedContained > 0 && <InjectionBanner n={untrustedContained} />}
      {triaged && (
        <SummaryBar
          approved={byStatus("approved").length}
          flagged={byStatus("flagged").length}
          rejected={byStatus("rejected").length}
        />
      )}

      <LayoutGroup>
        <div className="grid flex-1 grid-cols-2 gap-3 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const list = byStatus(col.key);
            const sum = list.reduce((a, b) => a + b.amount, 0);
            return (
              <section
                key={col.key}
                className={`flex min-h-[42vh] flex-col rounded-2xl border-t-2 ${col.border} bg-gradient-to-b ${col.glow} to-transparent p-2.5`}
              >
                <div className="mb-2.5 flex items-center justify-between px-1 pt-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                    <h2 className="text-sm font-semibold">{col.label}</h2>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs tabular-nums text-[var(--muted)]">{list.length}</span>
                  </div>
                  <span className="text-xs tabular-nums text-[var(--muted)]">{money(sum)}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {list.map((item) => (
                    <Card key={item.id} item={item} role={role} onApprove={() => post("/api/approve", { id: item.id })} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </LayoutGroup>

      <ActivityFeed feed={feed} supported={webmcp?.supported ?? false} />
      <Footer />
    </div>
  );
}

function Header({
  role,
  webmcp,
  busy,
  onSwitch,
  onReset,
}: {
  role: "analyst" | "manager";
  webmcp: { supported: boolean; n: number } | null;
  busy: boolean;
  onSwitch: (r: "analyst" | "manager") => void;
  onReset: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--brand-soft)] ring-1 ring-[var(--border-strong)]">
          <ShieldIcon className="h-5 w-5 text-[var(--brand)]" />
        </div>
        <div>
          <h1 className="bg-gradient-to-r from-[#a99bff] to-emerald-300 bg-clip-text text-lg font-semibold leading-none text-transparent">
            SpendGate
          </h1>
          <p className="mt-1 text-xs text-[var(--muted)]">Agent-operable expense approvals · WebMCP</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WebmcpChip webmcp={webmcp} />
        <div className="flex overflow-hidden rounded-lg ring-1 ring-[var(--border-strong)]">
          {(["analyst", "manager"] as const).map((r) => (
            <button
              key={r}
              onClick={() => onSwitch(r)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition ${
                role === r ? "bg-[var(--brand)] text-white" : "text-[var(--muted)] hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <button
          onClick={onReset}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)] ring-1 ring-[var(--border-strong)] transition hover:text-white disabled:opacity-50"
        >
          Reset
        </button>
      </div>
    </header>
  );
}

function WebmcpChip({ webmcp }: { webmcp: { supported: boolean; n: number } | null }) {
  if (!webmcp) return <span className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)] ring-1 ring-[var(--border-strong)]">Checking WebMCP…</span>;
  return webmcp.supported ? (
    <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/25">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> WebMCP · {webmcp.n} tools live
    </span>
  ) : (
    <span className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/25">
      WebMCP not detected — buttons still work
    </span>
  );
}

function PromptStrip({ onRun, busy, triaged }: { onRun: () => void; busy: boolean; triaged: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
      <div>
        <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Ask the ChatGPT agent</p>
        <p className="mt-1 font-mono text-sm">“Triage today’s expense queue against policy, then tell me what needs my approval.”</p>
      </div>
      <button
        onClick={onRun}
        disabled={busy}
        className="shrink-0 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
      >
        {triaged ? "Re-run triage" : "Run triage (no agent)"}
      </button>
    </div>
  );
}

function InjectionBanner({ n }: { n: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 24 }}
      className="flex items-center gap-3 rounded-xl bg-rose-500/12 p-3.5 ring-1 ring-rose-500/30"
    >
      <AlertIcon className="h-5 w-5 shrink-0 text-rose-300" />
      <p className="text-sm font-medium text-rose-100">
        {n} prompt-injection attempt{n > 1 ? "s" : ""} contained.{" "}
        <span className="text-rose-200/80">A poisoned memo asked the agent to approve past policy — the server decided from structured fields, so the memo changed nothing.</span>
      </p>
    </motion.div>
  );
}

function SummaryBar({ approved, flagged, rejected }: { approved: number; flagged: number; rejected: number }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-[var(--surface)] px-4 py-2.5 ring-1 ring-[var(--border)]">
      <Stat n={approved} label="approved" color="text-emerald-300" />
      <Stat n={flagged} label="need review" color="text-amber-300" />
      <Stat n={rejected} label="rejected" color="text-rose-300" />
    </div>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-xl font-semibold tabular-nums ${color}`}>{n}</span>
      <span className="text-xs text-[var(--muted)]">{label}</span>
    </div>
  );
}

function Card({ item, role, onApprove }: { item: BoardItem; role: "analyst" | "manager"; onApprove: () => void }) {
  const [memo, setMemo] = useState<string | null>(null);
  const poisoned = item.untrusted && item.status !== "approved";

  const reveal = async () => {
    const res = await fetch("/api/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    const data = await res.json();
    setMemo(data.memo ?? "");
  };

  return (
    <motion.div
      layout
      layoutId={item.id}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={
        poisoned
          ? { opacity: 1, scale: 1, x: [0, -5, 5, -3, 3, 0] }
          : { opacity: 1, scale: 1 }
      }
      transition={{ layout: { type: "spring", stiffness: 350, damping: 32 }, default: { duration: 0.4 } }}
      className={`rounded-xl bg-[var(--surface)] p-2.5 ring-1 ${
        poisoned ? "shadow-[0_0_22px_rgba(244,63,94,0.28)] ring-2 ring-rose-500/60" : "ring-[var(--border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.employee}</p>
          <p className="hidden truncate text-xs text-[var(--muted)] sm:block">{item.vendor}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{money(item.amount)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">{item.category}</span>
        {item.reasons
          .filter((r) => r !== "within_policy")
          .map((r) => (
            <span key={r} className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 ring-1 ring-amber-500/20">
              {REASON_LABEL[r] ?? r}
            </span>
          ))}
      </div>

      {poisoned && (
        <div className="mt-2 rounded-lg bg-rose-500/[0.07] p-2 ring-1 ring-rose-500/20">
          {memo === null ? (
            <button onClick={reveal} className="text-[11px] font-medium text-rose-300 underline decoration-dotted underline-offset-2">
              ⚠ Show the blocked memo
            </button>
          ) : (
            <>
              <p className="font-mono text-[11px] leading-snug text-rose-300/70 line-through">{memo.slice(0, 90)}</p>
              <p className="mt-1 text-[11px] font-semibold tracking-wide text-rose-200">CONTAINED — decided by server policy, not the memo</p>
            </>
          )}
        </div>
      )}

      {item.status !== "pending" && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-[var(--muted)]">decided server-side</span>
          {role === "manager" && item.requiresApproval && (
            <button onClick={onApprove} className="rounded-md bg-[var(--brand)] px-2 py-1 text-[11px] font-medium text-white transition hover:brightness-110">
              Approve
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

function ActivityFeed({ feed, supported }: { feed: FeedLine[]; supported: boolean }) {
  const tone: Record<Status, string> = {
    approved: "text-emerald-300",
    flagged: "text-amber-300",
    rejected: "text-rose-300",
    pending: "text-slate-300",
  };
  return (
    <div className="rounded-xl bg-[var(--surface-2)] p-3 ring-1 ring-[var(--border)]">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className={`h-1.5 w-1.5 rounded-full ${supported ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
        <p className="text-[11px] uppercase tracking-widest text-[var(--muted)]">Agent activity · WebMCP tool calls</p>
      </div>
      <div className="flex min-h-[44px] flex-col gap-0.5 font-mono text-xs">
        {feed.length === 0 ? (
          <span className="px-1 text-[var(--muted)]">Waiting for the agent to call a tool…</span>
        ) : (
          feed.map((l) => (
            <motion.div key={l.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="px-1">
              <span className="text-[var(--muted)]">triage_batch · </span>
              <span className={tone[l.tone]}>{l.text}</span>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
      <span>Server decides every case from structured fields. Memos never influence a decision.</span>
      <a href="/probe" className="underline decoration-dotted underline-offset-4 hover:text-white">WebMCP probe →</a>
    </footer>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
