"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { registerSpendGateTools, setManagerTools, CHANGED_EVENT } from "@/lib/webmcp-tools";

type Status = "pending" | "approved" | "flagged" | "rejected";
type Role = "analyst" | "manager";

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

const REASON_DOT: Record<string, string> = {
  within_policy: "#16a34a",
  over_category_cap: "#d97706",
  receipt_required: "#dc2626",
  possible_duplicate: "#d97706",
  over_role_limit: "#d97706",
  invalid_amount: "#dc2626",
  disallowed_category: "#dc2626",
};

const COLUMNS: { key: Status; label: string; dot: string }[] = [
  { key: "pending", label: "Pending", dot: "#9ca3af" },
  { key: "flagged", label: "Needs review", dot: "#d97706" },
  { key: "approved", label: "Approved", dot: "#16a34a" },
  { key: "rejected", label: "Rejected", dot: "#dc2626" },
];

const STATUS_BADGE: Record<Status, { label: string; color: string; bg: string; ring: string }> = {
  pending: { label: "Pending", color: "#6b7280", bg: "#f4f4f2", ring: "#e4e4e0" },
  approved: { label: "Approved", color: "#15803d", bg: "#f0f9f1", ring: "#cfe8d3" },
  flagged: { label: "Needs review", color: "#b45309", bg: "#fdf6e7", ring: "#f1e2bd" },
  rejected: { label: "Rejected", color: "#b91c1c", bg: "#fef5f5", ring: "#f3caca" },
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const changed = (a: BoardItem, b: BoardItem) =>
  a.status !== b.status || a.requiresApproval !== b.requiresApproval || a.reasons.join() !== b.reasons.join() || a.untrusted !== b.untrusted;

interface FeedLine {
  key: number;
  tool: string;
  text: string;
  tone: Status | "session";
}

interface Verdict {
  ok: boolean;
  reason_code: string;
  human_reason: string;
  expenseId: string;
  required_role?: string;
  escalation?: { action: string; message: string };
  next_action?: { tool: string; id: string };
}

const FEED_TONE: Record<string, string> = {
  approved: "#15803d",
  flagged: "#b45309",
  rejected: "#b91c1c",
  pending: "#6b7280",
  session: "#6b7280",
};

export default function Home() {
  const [screen, setScreen] = useState<"login" | "board">("login");
  const [view, setView] = useState<Record<string, BoardItem>>({});
  const [role, setRole] = useState<Role>("analyst");
  const [webmcp, setWebmcp] = useState<{ supported: boolean; n: number } | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailRead, setDetailRead] = useState<{ id: string; memo: string; untrusted: boolean } | null>(null);

  const viewRef = useRef<Record<string, BoardItem>>({});
  const queueRef = useRef<BoardItem[]>([]);
  const feedKey = useRef(0);
  const registered = useRef(false);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const pushFeed = useCallback((tool: string, text: string, tone: FeedLine["tone"]) => {
    feedKey.current += 1;
    setFeed((f) => [{ key: feedKey.current, tool, text, tone }, ...f].slice(0, 7));
  }, []);

  const reconcile = useCallback((server: BoardItem[]) => {
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
    return data.role as Role;
  }, [reconcile]);

  // drain the change queue one card every ~150ms -> a continuous stream of motion
  useEffect(() => {
    const t = setInterval(() => {
      const next = queueRef.current.shift();
      if (!next) return;
      const prev = viewRef.current[next.id];
      const isApproval = prev?.status === "flagged" && next.status === "approved";
      setView((p) => ({ ...p, [next.id]: next }));
      const extra = next.reasons.filter((r) => r !== "within_policy").map((r) => REASON_LABEL[r] ?? r).join(", ");
      if (isApproval) {
        pushFeed("Approval", `${next.id} approved by manager`, "approved");
      } else {
        const label = next.status === "flagged" ? "needs review" : next.status;
        pushFeed("Policy review", `${next.id} marked ${label}${extra ? " · " + extra : ""}`, next.status);
      }
    }, 150);
    return () => clearInterval(t);
  }, [pushFeed]);

  useEffect(() => {
    (async () => {
      const r = await refresh();
      // Restore the intended screen across a role-switch reload (Chrome without
      // unregisterTool reloads to drop the manager tool cleanly); the fresh mount
      // re-registers the analyst surface from the server role just read above.
      try {
        if (sessionStorage.getItem("sg_screen") === "board") setScreen("board");
      } catch {}
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

  // Unconditionally make the SERVER role and the tool surface match `next`.
  // Never trusts the local `role` (which can lag a persisted manager session
  // still hydrating from /api/board), so a stale manager surface can't linger
  // behind an analyst selection or the logged-out screen.
  const applyRole = useCallback(
    async (next: Role) => {
      await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: next }) });
      const r = await setManagerTools(next === "manager"); // add or remove the manager delta
      const n = r.supported ? r.registered.length : next === "manager" ? 5 : 4;
      if (r.supported) setWebmcp({ supported: true, n: r.registered.length });
      setRole(next);
      pushFeed("Access", `${next} permissions updated · ${n} actions available`, "session");
      await refresh();
    },
    [pushFeed, refresh],
  );

  const switchRole = useCallback(
    async (next: Role) => {
      if (role === next) return;
      await applyRole(next);
    },
    [role, applyRole],
  );

  // Login entry always applies the picked role (never skips based on stale local
  // role). Persist the target screen first: applyRole may reload the page to drop
  // a stale manager tool, and the reload must land on the board, not back on login.
  const enter = async (r: Role) => {
    try { sessionStorage.setItem("sg_screen", "board"); } catch {}
    await applyRole(r);
    setScreen("board");
  };

  // Sign-out revokes manager authority server-side and drops the manager tool
  // before showing Login — a WebMCP client must not be able to approve while
  // the app appears logged out. (If applyRole reloads, the default screen is login.)
  const signOut = async () => {
    try { sessionStorage.setItem("sg_screen", "login"); } catch {}
    await applyRole("analyst");
    setScreen("login");
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailRead(null);
    const res = await fetch("/api/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const data = await res.json();
    setDetailRead({ id, memo: data.memo ?? "", untrusted: !!data.untrusted });
    pushFeed("Memo review", `${id} memo opened for review`, "flagged");
  };

  const requestApproval = async (id: string): Promise<Verdict> => {
    const res = await fetch("/api/request-approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const data = (await res.json()) as Verdict;
    pushFeed(
      "Approval request",
      `${id} → ${data.ok ? "authorized" : "refused"} · ${data.reason_code}${data.escalation ? " · " + data.escalation.action : ""}`,
      data.ok ? "approved" : "flagged",
    );
    return data;
  };

  const items = Object.values(view); // insertion-ordered: stable board order
  const byStatus = (s: Status) => items.filter((i) => i.status === s);
  const triaged = items.some((i) => i.status !== "pending");
  const untrustedContained = items.filter((i) => i.untrusted && i.status !== "approved").length;
  const detailItem = detailId ? view[detailId] : undefined;

  if (screen === "login") return <Login onEnter={enter} />;

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", width: "100%", flex: 1, display: "flex", flexDirection: "column", gap: 14, padding: "18px 22px", boxSizing: "border-box" }}>
      <Header
        role={role}
        webmcp={webmcp}
        busy={busy}
        onSwitch={switchRole}
        onReset={() => post("/api/reset")}
        onSignOut={signOut}
      />

      <PromptStrip onRun={() => post("/api/triage", {})} busy={busy} triaged={triaged} />

      <AnimatePresence>
        {triaged && untrustedContained > 0 && <InjectionBanner key="banner" n={untrustedContained} />}
      </AnimatePresence>

      {triaged && (
        <SummaryBar approved={byStatus("approved").length} flagged={byStatus("flagged").length} rejected={byStatus("rejected").length} />
      )}

      <LayoutGroup>
        <div className="sg-cols" style={{ flex: 1 }}>
          {COLUMNS.map((col) => {
            const list = byStatus(col.key);
            const sum = list.reduce((a, b) => a + b.amount, 0);
            return (
              <section key={col.key} style={{ display: "flex", flexDirection: "column", borderRadius: 12, background: "var(--column)", padding: 8, minHeight: "52vh" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: col.dot }} />
                    <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: "0.02em", color: "#374151" }}>{col.label}</h2>
                    <span style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: "var(--muted-2)" }}>{list.length}</span>
                  </div>
                  <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-geist-mono), monospace", color: "var(--muted-2)" }}>{money(sum)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {list.map((item) => (
                    <Card key={item.id} item={item} role={role} onOpen={() => openDetail(item.id)} onApprove={() => post("/api/approve", { id: item.id })} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </LayoutGroup>

      <ActivityFeed feed={feed} supported={webmcp?.supported ?? false} />
      <Footer />

      <AnimatePresence>
        {detailItem && (
          <DetailPanel
            key="detail"
            item={detailItem}
            read={detailRead}
            role={role}
            onApprove={() => post("/api/approve", { id: detailItem.id })}
            onRequestApproval={requestApproval}
            onClose={() => {
              setDetailId(null);
              setDetailRead(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ Login */

function Login({ onEnter }: { onEnter: (r: Role) => void }) {
  const cards: { role: Role; label: string; tools: string; desc: string }[] = [
    { role: "analyst", label: "Analyst", tools: "4 actions", desc: "Review expenses and submit approval requests." },
    { role: "manager", label: "Manager", tools: "5 actions", desc: "Review expenses and approve flagged items." },
  ];
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
      <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--ink)", display: "grid", placeItems: "center" }}>
            <ShieldIcon stroke="#fff" size={18} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em" }}>Sign in to SpendGate</h1>
            <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              Policy-based expense controls for finance teams. Your role determines the actions available to you.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cards.map((c) => (
            <button
              key={c.role}
              onClick={() => onEnter(c.role)}
              className="sg-rolecard"
              style={{ display: "flex", alignItems: "center", gap: 14, textAlign: "left", cursor: "pointer", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", color: "var(--foreground)", fontFamily: "inherit" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 550 }}>{c.label}</span>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", color: "var(--muted)", background: "#f4f4f2", borderRadius: 5, padding: "2px 7px" }}>{c.tools}</span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>{c.desc}</p>
              </div>
              <ChevronIcon />
            </button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted-2)", lineHeight: 1.5 }}>
          Roles and permissions are set when you sign in.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Header */

function Header({
  role,
  webmcp,
  busy,
  onSwitch,
  onReset,
  onSignOut,
}: {
  role: Role;
  webmcp: { supported: boolean; n: number } | null;
  busy: boolean;
  onSwitch: (r: Role) => void;
  onReset: () => void;
  onSignOut: () => void;
}) {
  const ghost: React.CSSProperties = { borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontFamily: "inherit", fontWeight: 500, color: "#374151", background: "var(--surface)", border: "1px solid var(--border)", cursor: "pointer" };
  return (
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--ink)", display: "grid", placeItems: "center" }}>
          <ShieldIcon stroke="#fff" size={14} />
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em" }}>SpendGate</span>
        <span style={{ width: 1, height: 16, background: "var(--border)" }} />
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Expense review and approvals</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <WebmcpChip webmcp={webmcp} />
        <div style={{ display: "flex", gap: 2, background: "#ececea", borderRadius: 8, padding: 2 }}>
          {(["analyst", "manager"] as const).map((r) => (
            <button
              key={r}
              onClick={() => onSwitch(r)}
              style={{ padding: "5px 12px", fontSize: 12.5, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", border: "none", borderRadius: 6, textTransform: "capitalize", background: role === r ? "var(--surface)" : "transparent", color: role === r ? "var(--foreground)" : "var(--muted)", boxShadow: role === r ? "0 1px 2px rgba(0,0,0,0.08)" : "none", transition: "background .15s, color .15s" }}
            >
              {r}
            </button>
          ))}
        </div>
        <button onClick={onReset} disabled={busy} className="sg-hover-border" style={{ ...ghost, opacity: busy ? 0.5 : 1 }}>
          Reset
        </button>
        <button onClick={onSignOut} className="sg-hover-border" style={ghost}>
          Sign out
        </button>
      </div>
    </header>
  );
}

function WebmcpChip({ webmcp }: { webmcp: { supported: boolean; n: number } | null }) {
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 500 };
  if (!webmcp) return <span style={{ ...base, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}>Checking connection…</span>;
  if (webmcp.supported)
    return (
      <span style={{ ...base, background: "var(--surface)", border: "1px solid var(--border)", color: "#374151" }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: "#16a34a" }} />
        WebMCP ready · {webmcp.n} actions
      </span>
    );
  return (
    <span style={{ ...base, background: "#fdf6e7", border: "1px solid #f1e2bd", color: "#92610a" }}>
      WebMCP unavailable · manual controls remain available
    </span>
  );
}

/* ------------------------------------------------------------- Prompt strip */

function PromptStrip({ onRun, busy, triaged }: { onRun: () => void; busy: boolean; triaged: boolean }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)", padding: "14px 16px" }}>
      {busy && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, width: "30%", height: 2, background: "var(--ink)", animation: "sgBar 1.1s ease-in-out infinite" }} />
        </div>
      )}
      <div>
        <p style={{ margin: 0, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted-2)", fontWeight: 550 }}>Review queue</p>
        <p style={{ margin: "5px 0 0", fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "#374151" }}>
          “Review today’s expense queue against policy.”
        </p>
      </div>
      <button
        onClick={onRun}
        disabled={busy}
        className="sg-ink"
        style={{ flexShrink: 0, borderRadius: 8, border: "1px solid var(--ink)", background: "var(--ink)", padding: "8px 16px", fontSize: 13, fontWeight: 550, fontFamily: "inherit", color: "#fff", cursor: busy ? "default" : "pointer", opacity: busy ? 0.85 : 1 }}
      >
        {busy ? "Reviewing…" : triaged ? "Review again" : "Review expenses"}
      </button>
    </div>
  );
}

/* --------------------------------------------------------- Banner + summary */

function InjectionBanner({ n }: { n: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -3 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      style={{ display: "flex", alignItems: "center", gap: 11, borderRadius: 10, background: "var(--surface)", border: "1px solid #f3caca", padding: "12px 16px" }}
    >
      <AlertIcon stroke="#dc2626" size={17} />
      <p style={{ margin: 0, fontSize: 13, color: "var(--foreground)" }}>
        <span style={{ fontWeight: 600 }}>{n} untrusted memo{n > 1 ? "s" : ""} identified.</span>{" "}
        <span style={{ color: "var(--muted)" }}>Memo text is excluded from policy evaluation. Review the item before approval.</span>
      </p>
    </motion.div>
  );
}

function SummaryBar({ approved, flagged, rejected }: { approved: number; flagged: number; rejected: number }) {
  const stats = [
    { n: approved, label: "approved", dot: "#16a34a" },
    { n: flagged, label: "need review", dot: "#d97706" },
    { n: rejected, label: "rejected", dot: "#dc2626" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, padding: "0 2px" }}>
      {stats.map((s) => (
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: s.dot }} />
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{s.n}</span>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{s.label}</span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11.5, fontFamily: "var(--font-geist-mono), monospace", color: "var(--muted-2)" }}>Policy evaluated · one review request</span>
    </div>
  );
}

/* --------------------------------------------------------------------- Card */

function Card({ item, role, onOpen, onApprove }: { item: BoardItem; role: Role; onOpen: () => void; onApprove: () => void }) {
  const [memo, setMemo] = useState<string | null>(null);
  const poisoned = item.untrusted && item.status !== "approved";
  const badges = item.reasons.filter((r) => r !== "within_policy");

  const reveal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch("/api/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    const data = await res.json();
    setMemo(data.memo ?? "");
  };

  return (
    <motion.div
      layout
      layoutId={item.id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: { type: "spring", stiffness: 350, damping: 32 }, default: { duration: 0.35 } }}
      onClick={onOpen}
      className="sg-card"
      style={{ borderRadius: 8, background: "var(--surface)", padding: "10px 12px", cursor: "pointer", border: "1px solid var(--border)", boxShadow: poisoned ? "inset 3px 0 0 #dc2626" : "none" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 550, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.employee}</p>
          <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.vendor}</p>
        </div>
        <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(item.amount)}</span>
      </div>

      <div style={{ marginTop: 7, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        <span style={{ borderRadius: 5, background: "#f4f4f2", padding: "2px 7px", fontSize: 10, letterSpacing: "0.04em", textTransform: "capitalize", color: "var(--muted)" }}>{item.category}</span>
        {badges.map((r) => (
          <span key={r} style={{ borderRadius: 5, background: "#fdf6e7", border: "1px solid #f1e2bd", padding: "2px 7px", fontSize: 10, fontWeight: 500, color: "#92610a" }}>
            {REASON_LABEL[r] ?? r}
          </span>
        ))}
      </div>

      {poisoned && (
        <div style={{ marginTop: 8, borderRadius: 7, background: "#fef5f5", border: "1px solid #f3caca", padding: "8px 10px" }}>
          {memo === null ? (
            <button onClick={reveal} className="sg-reveal" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 550, color: "#b91c1c" }}>
              <AlertIcon stroke="currentColor" size={12} />
              Review flagged memo
            </button>
          ) : (
            <>
              <p style={{ margin: 0, fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, lineHeight: 1.45, color: "#b45050", textDecoration: "line-through" }}>{memo.slice(0, 90)}</p>
              <p style={{ margin: "6px 0 0", fontSize: 10.5, fontWeight: 600, color: "#991b1b" }}>Excluded from policy evaluation</p>
            </>
          )}
        </div>
      )}

      {role === "manager" && item.requiresApproval && (
        <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            className="sg-ink"
            style={{ borderRadius: 7, border: "1px solid var(--ink)", background: "var(--ink)", padding: "4px 11px", fontSize: 11.5, fontWeight: 550, fontFamily: "inherit", color: "#fff", cursor: "pointer" }}
          >
            Approve
          </button>
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------- Detail panel */

function DetailPanel({
  item,
  read,
  role,
  onApprove,
  onRequestApproval,
  onClose,
}: {
  item: BoardItem;
  read: { id: string; memo: string; untrusted: boolean } | null;
  role: Role;
  onApprove: () => void;
  onRequestApproval: (id: string) => Promise<Verdict>;
  onClose: () => void;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [requesting, setRequesting] = useState(false);
  const doRequest = async () => {
    setRequesting(true);
    try {
      setVerdict(await onRequestApproval(item.id));
    } finally {
      setRequesting(false);
    }
  };
  const badge = STATUS_BADGE[item.status];
  const facts: { k: string; v: string; color: string }[] = [
    { k: "Submitted", v: item.submittedAt.slice(0, 10), color: "var(--foreground)" },
    { k: "Receipt", v: item.hasReceipt ? "Attached" : "Missing", color: item.hasReceipt ? "#15803d" : "#b91c1c" },
    { k: "Employee", v: item.employee, color: "var(--foreground)" },
    { k: "Vendor", v: item.vendor, color: "var(--foreground)" },
  ];
  const trail =
    item.status === "pending"
      ? [{ label: "Awaiting review", dot: "#9ca3af" }]
      : item.reasons.map((r) => ({ label: REASON_LABEL[r] ?? r, dot: REASON_DOT[r] ?? "#9ca3af" }));
  const memoReady = read?.id === item.id;
  const untrusted = memoReady && read!.untrusted;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(20,20,22,0.28)", zIndex: 40 }}
      />
      <motion.aside
        initial={{ x: 32, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 32, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(400px, 92vw)", zIndex: 41, background: "var(--surface)", borderLeft: "1px solid var(--border)", padding: 22, overflowY: "auto", boxSizing: "border-box", boxShadow: "-16px 0 48px rgba(0,0,0,0.1)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--muted-2)" }}>{item.id}</span>
          <button onClick={onClose} className="sg-hover-border" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--muted)", fontSize: 12, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>
            Close
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{item.employee} · {item.vendor}</p>
        <p style={{ margin: "5px 0 0", fontSize: 30, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{money(item.amount)}</p>

        <div style={{ marginTop: 11, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 6, padding: "3px 10px", fontSize: 11.5, fontWeight: 550, background: badge.bg, color: badge.color, border: `1px solid ${badge.ring}` }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: badge.color }} />
            {badge.label}
          </span>
          <span style={{ borderRadius: 5, background: "#f4f4f2", padding: "3px 9px", fontSize: 10.5, textTransform: "capitalize", color: "var(--muted)" }}>{item.category}</span>
        </div>

        <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {facts.map((f) => (
            <div key={f.k} style={{ borderRadius: 8, background: "#fafaf8", border: "1px solid #ececea", padding: "9px 11px" }}>
              <p style={{ margin: 0, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted-2)", fontWeight: 550 }}>{f.k}</p>
              <p style={{ margin: "3px 0 0", fontSize: 12.5, fontWeight: 500, color: f.color }}>{f.v}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20 }}>
          <p style={{ margin: "0 0 8px", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted-2)", fontWeight: 550 }}>Policy review</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {trail.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, borderRadius: 8, background: "#fafaf8", border: "1px solid #ececea", padding: "8px 11px" }}>
                <span style={{ width: 6, height: 6, borderRadius: 2, background: t.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: "#374151" }}>{t.label}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 10.5, fontFamily: "var(--font-geist-mono), monospace", color: "var(--muted-2)" }}>Policy applied during review</p>
        </div>

        <div style={{ marginTop: 20 }}>
          <p style={{ margin: "0 0 8px", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted-2)", fontWeight: 550 }}>Memo review</p>
          {!memoReady ? (
            <div style={{ borderRadius: 9, background: "#fafaf8", border: "1px solid #ececea", padding: "12px 14px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11.5, color: "var(--muted-2)" }}>
              Loading memo…
            </div>
          ) : untrusted ? (
            <div style={{ borderRadius: 9, background: "#fef5f5", border: "1px solid #f3caca", padding: "12px 14px" }}>
              <p style={{ margin: "0 0 7px", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#b91c1c" }}>Untrusted content</p>
              <p style={{ margin: 0, fontFamily: "var(--font-geist-mono), monospace", fontSize: 11.5, lineHeight: 1.55, color: "#b45050", textDecoration: "line-through" }}>{read!.memo}</p>
              <p style={{ margin: "9px 0 0", fontSize: 11, fontWeight: 600, color: "#991b1b" }}>This memo is excluded from policy evaluation.</p>
            </div>
          ) : (
            <div style={{ borderRadius: 9, background: "#fafaf8", border: "1px solid #ececea", padding: "12px 14px" }}>
              <p style={{ margin: 0, fontFamily: "var(--font-geist-mono), monospace", fontSize: 11.5, lineHeight: 1.55, color: "#4b5563" }}>{read!.memo}</p>
            </div>
          )}
        </div>

        {role === "manager" && item.requiresApproval && (
          <button onClick={onApprove} className="sg-ink" style={{ marginTop: 20, width: "100%", borderRadius: 9, border: "1px solid var(--ink)", background: "var(--ink)", padding: 11, fontSize: 13.5, fontWeight: 550, fontFamily: "inherit", color: "#fff", cursor: "pointer" }}>
            Approve as manager
          </button>
        )}
        {role === "analyst" && item.requiresApproval && (
          <div style={{ marginTop: 20 }}>
            {!verdict ? (
              <>
                <button onClick={doRequest} disabled={requesting} className="sg-hover-border" style={{ width: "100%", borderRadius: 9, background: "var(--surface)", border: "1px solid var(--border)", padding: 11, fontSize: 13, fontWeight: 550, fontFamily: "inherit", color: "#374151", cursor: requesting ? "default" : "pointer", opacity: requesting ? 0.6 : 1 }}>
                  {requesting ? "Requesting…" : "Request approval"}
                </button>
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--muted-2)", lineHeight: 1.5 }}>
                  Only a manager can approve this item.
                </p>
              </>
            ) : (
              <div style={{ borderRadius: 9, background: "#fdf6e7", border: "1px solid #f1e2bd", padding: "12px 14px" }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#92610a" }}>Refused · {verdict.reason_code}</p>
                <p style={{ margin: "7px 0 0", fontSize: 12.5, color: "#92610a", lineHeight: 1.5 }}>{verdict.human_reason}</p>
                {verdict.escalation && (
                  <p style={{ margin: "9px 0 0", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "#92610a", lineHeight: 1.5 }}>
                    → {verdict.escalation.action}: {verdict.escalation.message}
                  </p>
                )}
                <p style={{ margin: "10px 0 0", fontSize: 11.5, fontWeight: 600, color: "#374151" }}>Switch to Manager to review this request.</p>
              </div>
            )}
          </div>
        )}
      </motion.aside>
    </>
  );
}

/* -------------------------------------------------------------- Feed/footer */

function ActivityFeed({ feed, supported }: { feed: FeedLine[]; supported: boolean }) {
  return (
    <div style={{ borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)", padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: feed.length && supported ? "#16a34a" : "#d1d5db" }} />
        <p style={{ margin: 0, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted-2)", fontWeight: 550 }}>Activity</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minHeight: 40, fontFamily: "var(--font-geist-mono), monospace", fontSize: 11.5 }}>
        {feed.length === 0 ? (
          <span style={{ color: "var(--muted-2)", padding: "0 1px" }}>No activity yet.</span>
        ) : (
          feed.map((l) => (
            <motion.div key={l.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} style={{ padding: "0 1px" }}>
              <span style={{ color: "var(--muted-2)" }}>{l.tool} · </span>
              <span style={{ color: FEED_TONE[l.tone] ?? "var(--muted)" }}>{l.text}</span>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 2px 6px", fontSize: 11.5, color: "var(--muted-2)" }}>
      <span>Expense approvals are evaluated against policy. Memo text is excluded from the decision.</span>
      <a href="/probe" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>WebMCP status →</a>
    </footer>
  );
}

/* -------------------------------------------------------------------- Icons */

function ShieldIcon({ stroke = "currentColor", size = 20 }: { stroke?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function AlertIcon({ stroke = "currentColor", size = 17 }: { stroke?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size, flexShrink: 0 }}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
