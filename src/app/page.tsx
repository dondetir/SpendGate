"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
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

const COLUMNS: { key: Status; label: string; ring: string; dot: string }[] = [
  { key: "pending", label: "Pending", ring: "ring-slate-500/20", dot: "bg-slate-400" },
  { key: "flagged", label: "Needs review", ring: "ring-amber-500/25", dot: "bg-amber-400" },
  { key: "approved", label: "Approved", ring: "ring-emerald-500/25", dot: "bg-emerald-400" },
  { key: "rejected", label: "Rejected", ring: "ring-rose-500/25", dot: "bg-rose-400" },
];

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function Home() {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [role, setRole] = useState<"analyst" | "manager">("analyst");
  const [webmcp, setWebmcp] = useState<{ supported: boolean; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const registered = useRef(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/board");
    const data = await res.json();
    setItems(data.items ?? []);
    setRole(data.role ?? "analyst");
    return data.role as "analyst" | "manager";
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
    const iv = setInterval(refresh, 1500); // reflect agent-driven changes
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
    await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: next }) });
    location.reload(); // clean, deterministic tool re-registration
  };

  const triaged = items.some((i) => i.status !== "pending");
  const totals = {
    pending: items.filter((i) => i.status === "pending"),
    approved: items.filter((i) => i.status === "approved"),
    flagged: items.filter((i) => i.status === "flagged"),
    rejected: items.filter((i) => i.status === "rejected"),
  };
  const untrustedContained = items.filter((i) => i.untrusted && i.status !== "approved").length;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 py-6">
      <Header
        role={role}
        webmcp={webmcp}
        busy={busy}
        onSwitch={switchRole}
        onReset={() => post("/api/reset").then(() => location.reload())}
      />

      <PromptStrip />

      {triaged && (
        <SummaryBar
          approved={totals.approved.length}
          flagged={totals.flagged.length}
          rejected={totals.rejected.length}
          untrustedContained={untrustedContained}
        />
      )}

      <LayoutGroup>
        <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const list = totals[col.key];
            const sum = list.reduce((a, b) => a + b.amount, 0);
            return (
              <section
                key={col.key}
                className={`flex min-h-[60vh] flex-col rounded-2xl bg-[var(--surface-2)] p-3 ring-1 ${col.ring}`}
              >
                <div className="mb-3 flex items-center justify-between px-2 pt-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                    <h2 className="text-sm font-semibold tracking-wide text-[var(--foreground)]">{col.label}</h2>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-[var(--muted)]">{list.length}</span>
                  </div>
                  <span className="text-xs tabular-nums text-[var(--muted)]">{money(sum)}</span>
                </div>
                <div className="flex flex-col gap-2 overflow-y-auto pr-1">
                  <AnimatePresence mode="popLayout">
                    {list.map((item) => (
                      <Card key={item.id} item={item} role={role} onApprove={() => post("/api/approve", { id: item.id })} />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            );
          })}
        </div>
      </LayoutGroup>

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
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--brand-soft)] text-lg ring-1 ring-[var(--border-strong)]">🛡️</div>
        <div>
          <h1 className="text-lg font-semibold leading-none">SpendGate</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">Agent-operable expense approvals · WebMCP</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WebmcpChip webmcp={webmcp} />
        <div className="flex overflow-hidden rounded-lg ring-1 ring-[var(--border-strong)]">
          {(["analyst", "manager"] as const).map((r) => (
            <button
              key={r}
              onClick={() => role !== r && onSwitch(r)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition ${
                role === r ? "bg-[var(--brand)] text-white" : "bg-transparent text-[var(--muted)] hover:text-white"
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
          Reset demo
        </button>
      </div>
    </header>
  );
}

function WebmcpChip({ webmcp }: { webmcp: { supported: boolean; n: number } | null }) {
  if (!webmcp) return <span className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)] ring-1 ring-[var(--border-strong)]">Checking WebMCP…</span>;
  return webmcp.supported ? (
    <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/25">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> WebMCP · {webmcp.n} tools live
    </span>
  ) : (
    <span className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/25">
      WebMCP not detected — buttons still work
    </span>
  );
}

function PromptStrip() {
  return (
    <div className="rounded-xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]">
      <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Ask the ChatGPT agent</p>
      <p className="mt-1 font-mono text-sm text-[var(--foreground)]">
        “Triage today’s expense queue against policy, then tell me what needs my approval.”
      </p>
    </div>
  );
}

function SummaryBar({
  approved,
  flagged,
  rejected,
  untrustedContained,
}: {
  approved: number;
  flagged: number;
  rejected: number;
  untrustedContained: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface)] p-3 ring-1 ring-[var(--border)]"
    >
      <Stat n={approved} label="approved" color="text-emerald-300" />
      <Stat n={flagged} label="need review" color="text-amber-300" />
      <Stat n={rejected} label="rejected" color="text-rose-300" />
      {untrustedContained > 0 && (
        <span className="ml-auto flex items-center gap-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 ring-1 ring-rose-500/25">
          ⚠ {untrustedContained} injection attempt{untrustedContained > 1 ? "s" : ""} contained — decided by server policy, not the memo
        </span>
      )}
    </motion.div>
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
  return (
    <motion.div
      layout
      layoutId={item.id}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className="rounded-xl bg-[var(--surface)] p-3 ring-1 ring-[var(--border)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.employee}</p>
          <p className="truncate text-xs text-[var(--muted)]">{item.vendor}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{money(item.amount)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">{item.category}</span>
        {item.untrusted && (
          <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-300 ring-1 ring-rose-500/20">⚠ untrusted memo</span>
        )}
        {item.reasons
          .filter((r) => r !== "within_policy")
          .map((r) => (
            <span key={r} className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 ring-1 ring-amber-500/20">
              {REASON_LABEL[r] ?? r}
            </span>
          ))}
      </div>
      {item.status !== "pending" && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-[var(--muted)]">decided server-side</span>
          {role === "manager" && item.requiresApproval && (
            <button
              onClick={onApprove}
              className="rounded-md bg-[var(--brand)] px-2 py-1 text-[11px] font-medium text-white transition hover:brightness-110"
            >
              Approve
            </button>
          )}
        </div>
      )}
    </motion.div>
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
