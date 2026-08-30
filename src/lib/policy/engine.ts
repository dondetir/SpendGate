import type { Decision, EvalContext, Expense, ReasonCode } from "./types";

// The decision engine. Consumes ONLY structured fields of `expense`.
// It never reads `expense.memo` — that is the injection-containment guarantee
// enforced by engine.test.ts. Do not reference `.memo` in this function.
export function evaluate(expense: Expense, ctx: EvalContext): Decision {
  const { role, policy, priorExpenses = [] } = ctx;

  // Hard rejects first.
  if (!(expense.amount > 0) || !Number.isFinite(expense.amount)) {
    return { status: "rejected", reasons: ["invalid_amount"], requiresApproval: false };
  }
  if (!policy.allowedCategories.includes(expense.category)) {
    return { status: "rejected", reasons: ["disallowed_category"], requiresApproval: false };
  }

  const reasons: ReasonCode[] = [];

  const cap = policy.categoryCaps[expense.category];
  if (cap !== undefined && expense.amount > cap) reasons.push("over_category_cap");

  if (expense.amount > policy.receiptRequiredAbove && !expense.hasReceipt) {
    reasons.push("receipt_required");
  }

  if (isDuplicate(expense, priorExpenses)) reasons.push("possible_duplicate");

  const roleLimit = policy.roleAutoApproveLimit[role];
  if (expense.amount > roleLimit) reasons.push("over_role_limit");

  if (reasons.length > 0) {
    return { status: "flagged", reasons, requiresApproval: true };
  }
  return { status: "approved", reasons: ["within_policy"], requiresApproval: false };
}

export interface TriageResult {
  expenseId: string;
  decision: Decision;
  untrusted: boolean; // display-only flag; never influences `decision`
}

// The whole-queue decision run. This is exactly what the `triage_batch` WebMCP
// tool executes server-side in ONE call — the agent never decides anything.
// Duplicate detection uses the rest of the batch as priors.
export function triageBatch(expenses: Expense[], ctx: EvalContext): TriageResult[] {
  return expenses.map((e) => ({
    expenseId: e.id,
    decision: evaluate(e, { ...ctx, priorExpenses: expenses }),
    untrusted: detectUntrustedContent(e.memo),
  }));
}

function isDuplicate(expense: Expense, priors: Expense[]): boolean {
  return priors.some(
    (p) =>
      p.id !== expense.id &&
      p.employee === expense.employee &&
      p.vendor === expense.vendor &&
      p.amount === expense.amount,
  );
}

// DISPLAY-ONLY heuristic. Flags memos that look like prompt-injection so the UI
// can mark them as untrusted content. Its output NEVER feeds `evaluate`.
const INJECTION_PATTERNS = [
  /\bignore\b.*\b(prior|previous|all|above)\b/i,
  /\bdisregard\b/i,
  /\bpre-?approved\b/i,
  /\bsystem\s*:/i,
  /\boverride\b/i,
  /\bapprove\b.*\b(in full|regardless|anyway|despite)\b/i,
];

export function detectUntrustedContent(memo: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(memo));
}
