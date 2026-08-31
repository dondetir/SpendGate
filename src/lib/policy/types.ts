// SpendGate domain model. The decision engine consumes ONLY structured fields.
// `memo` is attacker-controlled free text and must never influence a decision
// (see engine.test.ts: injection-containment). It exists for display + untrusted-content flagging.

export type Role = "analyst" | "manager";

export type Category = "travel" | "meals" | "software" | "equipment" | "other";

export interface Expense {
  id: string;
  employee: string;
  category: Category;
  amount: number; // USD, positive
  hasReceipt: boolean;
  memo: string; // FREE TEXT, untrusted, display-only
  vendor: string;
  submittedAt: string; // ISO date
}

export type ReasonCode =
  | "within_policy"
  | "over_category_cap"
  | "receipt_required"
  | "possible_duplicate"
  | "over_role_limit"
  | "invalid_amount"
  | "disallowed_category";

export type DecisionStatus = "approved" | "flagged" | "rejected";

export interface Decision {
  status: DecisionStatus;
  reasons: ReasonCode[];
  requiresApproval: boolean; // true when a privileged approve_expense is needed to clear it
}

export interface Policy {
  categoryCaps: Record<Category, number>; // per-expense ceiling before approval needed
  receiptRequiredAbove: number; // amount above which a receipt is mandatory
  roleAutoApproveLimit: Record<Role, number>; // max amount a role can auto-approve
  allowedCategories: Category[];
}

export interface EvalContext {
  role: Role;
  policy: Policy;
  priorExpenses?: Expense[]; // for duplicate detection
}

export const DEFAULT_POLICY: Policy = {
  categoryCaps: { travel: 2000, meals: 150, software: 500, equipment: 3000, other: 200 },
  receiptRequiredAbove: 75,
  roleAutoApproveLimit: { analyst: 500, manager: Number.POSITIVE_INFINITY },
  allowedCategories: ["travel", "meals", "software", "equipment", "other"],
};
