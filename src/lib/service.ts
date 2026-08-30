import { DEFAULT_POLICY, type Expense } from "./policy/types";
import { triageBatch, detectUntrustedContent, type TriageResult } from "./policy/engine";
import type { Session } from "./store";

const APPROVED_DECISION: TriageResult["decision"] = { status: "approved", reasons: ["within_policy"], requiresApproval: false };

// Server-side operations. Every mutation authorizes against session.role, which
// is stored server-side — never trusts a client-supplied role.

export class AuthzError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = "AuthzError";
  }
}

// A board item safe to hand to the agent/UI in bulk: NO memo. The bulk path
// never exposes untrusted free text — raw memo is only revealed by the
// deliberate readExpense call, where untrustedContentHint applies.
export interface BoardItemView {
  id: string;
  employee: string;
  category: string;
  amount: number;
  hasReceipt: boolean;
  vendor: string;
  submittedAt: string;
  status: TriageResult["decision"]["status"] | "pending";
  reasons: TriageResult["decision"]["reasons"];
  untrusted: boolean;
  requiresApproval: boolean;
}

export interface TriageResultView {
  expenseId: string;
  status: TriageResult["decision"]["status"];
  reasons: TriageResult["decision"]["reasons"];
  untrusted: boolean;
  requiresApproval: boolean;
}

function toView(e: Expense, session: Session): BoardItemView {
  const r = session.decisions[e.id];
  return {
    id: e.id,
    employee: e.employee,
    category: e.category,
    amount: e.amount,
    hasReceipt: e.hasReceipt,
    vendor: e.vendor,
    submittedAt: e.submittedAt,
    status: r ? r.decision.status : "pending",
    reasons: r ? r.decision.reasons : [],
    untrusted: r ? r.untrusted : false,
    requiresApproval: r ? r.decision.requiresApproval : false,
  };
}

export function listBoard(session: Session): { role: Session["role"]; items: BoardItemView[] } {
  return { role: session.role, items: session.board.map((e) => toView(e, session)) };
}

// The single WebMCP `triage_batch` call runs this. The SERVER decides everything
// from structured fields; the agent decides nothing. Returns no memo text.
export function runTriage(session: Session): TriageResultView[] {
  const raw = triageBatch(session.board, { role: session.role, policy: DEFAULT_POLICY });
  // Preserve a manager's prior approval across a re-triage instead of erasing it.
  const results = raw.map((r) =>
    session.managerApproved.has(r.expenseId) ? { ...r, decision: APPROVED_DECISION } : r,
  );
  session.decisions = Object.fromEntries(results.map((r) => [r.expenseId, r]));
  return results.map((r) => ({
    expenseId: r.expenseId,
    status: r.decision.status,
    reasons: r.decision.reasons,
    untrusted: r.untrusted,
    requiresApproval: r.decision.requiresApproval,
  }));
}

// read_expense: the ONE place raw memo is returned. Caller marks the tool with
// untrustedContentHint so the agent treats this text as untrusted.
export function readExpense(session: Session, id: string): (Expense & { untrusted: boolean }) | null {
  const e = session.board.find((x) => x.id === id);
  if (!e) return null;
  // Compute the untrusted signal directly from the memo, independent of whether
  // triage has run — the safety hint must not depend on prior state.
  return { ...e, untrusted: detectUntrustedContent(e.memo) };
}

// approve_expense: privileged, MANAGER ONLY, enforced server-side. Clears a
// flagged item. An analyst session cannot reach this regardless of what the
// agent asks — this is the human-in-the-loop money gate.
export function approveExpense(session: Session, id: string): BoardItemView {
  if (session.role !== "manager") {
    throw new AuthzError("Only a manager can approve a flagged expense.");
  }
  const e = session.board.find((x) => x.id === id);
  if (!e) throw new Error(`Expense ${id} not found`);
  const prior = session.decisions[id];
  // Only a flagged item that actually needs approval can be approved — not a
  // pending, already-approved, or rejected one.
  if (!prior || !prior.decision.requiresApproval) {
    throw new AuthzError("Only a flagged expense awaiting approval can be approved.");
  }
  session.managerApproved.add(id);
  session.decisions[id] = { expenseId: id, decision: APPROVED_DECISION, untrusted: prior.untrusted };
  return toView(e, session);
}
