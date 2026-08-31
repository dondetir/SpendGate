import { DEFAULT_POLICY, type Expense, type Role } from "./policy/types";
import { triageBatch, detectUntrustedContent, type TriageResult } from "./policy/engine";
import type { Session } from "./store";

const APPROVED_DECISION: TriageResult["decision"] = { status: "approved", reasons: ["within_policy"], requiresApproval: false };

// Server-side operations. Every mutation authorizes against session.role, which
// is stored server-side — never trusts a client-supplied role.

// A machine-actionable refusal. When a tool call is denied, the server does not
// return an opaque error — it returns a structured `reason_code` plus the next
// action the agent can take (escalate, switch role), so the agent can
// self-correct without a human decoding a prose error. This is the difference
// between a tool that fails and a tool that says "no, and here's what to do."
export type RefusalReason = "role_limit_exceeded" | "not_awaiting_approval" | "not_found";

export interface Escalation {
  action: string; // e.g. "escalate_to_manager"
  message: string; // human-readable next step
}

export class AuthzError extends Error {
  status = 403;
  reason_code: RefusalReason;
  required_role?: Role;
  escalation?: Escalation;
  expenseId?: string;
  constructor(message: string, opts: { reason_code: RefusalReason; required_role?: Role; escalation?: Escalation; expenseId?: string }) {
    super(message);
    this.name = "AuthzError";
    this.reason_code = opts.reason_code;
    this.required_role = opts.required_role;
    this.escalation = opts.escalation;
    this.expenseId = opts.expenseId;
  }
}

// The structured verdict returned by `request_approval` — the analyst-safe
// "can this be cleared, and by whom?" probe. It NEVER mutates; it only reports
// authority. An analyst gets a refusal with an escalation path; a manager gets
// an authorization pointing at the actual money tool (`approve_expense`).
export interface ApprovalVerdict {
  ok: boolean;
  reason_code: "authorized" | RefusalReason;
  human_reason: string;
  expenseId: string;
  required_role?: Role;
  escalation?: Escalation;
  next_action?: { tool: string; id: string };
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
    throw new AuthzError("Only a manager can approve a flagged expense.", {
      reason_code: "role_limit_exceeded",
      required_role: "manager",
      escalation: { action: "escalate_to_manager", message: "Route this expense to a manager, who can run approve_expense to clear it." },
      expenseId: id,
    });
  }
  const e = session.board.find((x) => x.id === id);
  if (!e) throw new AuthzError(`Expense ${id} not found`, { reason_code: "not_found", expenseId: id });
  const prior = session.decisions[id];
  // Only a flagged item that actually needs approval can be approved — not a
  // pending, already-approved, or rejected one.
  if (!prior || !prior.decision.requiresApproval) {
    throw new AuthzError("Only a flagged expense awaiting approval can be approved.", {
      reason_code: "not_awaiting_approval",
      escalation: { action: "run_triage_batch", message: "This item is not awaiting approval. Run triage_batch first, or pick a flagged item." },
      expenseId: id,
    });
  }
  session.managerApproved.add(id);
  session.decisions[id] = { expenseId: id, decision: APPROVED_DECISION, untrusted: prior.untrusted };
  return toView(e, session);
}

// request_approval: the analyst-safe probe. Reports WHO can clear a flagged
// item without ever mutating anything. This is the tool an analyst agent calls
// instead of the (unregistered-for-analysts) approve_expense — and the refusal
// it returns is machine-actionable, so the agent self-corrects by escalating.
// Manager-side it authorizes and points at the real money tool.
export function requestApproval(session: Session, id: string): ApprovalVerdict {
  const e = session.board.find((x) => x.id === id);
  if (!e) {
    return { ok: false, reason_code: "not_found", human_reason: `No expense ${id} on the board.`, expenseId: id };
  }
  const prior = session.decisions[id];
  if (!prior || !prior.decision.requiresApproval) {
    return {
      ok: false,
      reason_code: "not_awaiting_approval",
      human_reason: "This expense is not a flagged item awaiting approval, so there is nothing to authorize.",
      expenseId: id,
      escalation: { action: "run_triage_batch", message: "Run triage_batch first, then request approval only for flagged items." },
    };
  }
  if (session.role === "manager") {
    return {
      ok: true,
      reason_code: "authorized",
      human_reason: "You are authorized to clear this flagged expense.",
      expenseId: id,
      next_action: { tool: "approve_expense", id },
    };
  }
  // analyst: cannot clear it, and there is no tool path that would let it.
  return {
    ok: false,
    reason_code: "role_limit_exceeded",
    human_reason: "Approving a flagged expense requires a manager; an analyst cannot clear it.",
    expenseId: id,
    required_role: "manager",
    escalation: { action: "escalate_to_manager", message: "Route this to a manager, who can run approve_expense." },
  };
}
