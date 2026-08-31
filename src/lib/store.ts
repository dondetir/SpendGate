import type { Expense, Role } from "./policy/types";
import type { TriageResult } from "./policy/engine";
import { seedBoard } from "./seed";

// Session-keyed, in-process store. State lives for the lifetime of the Node
// process, correct on a persistent server (Render / `next start`), NOT on
// per-invocation serverless. Each judge session gets its own seeded board so
// concurrent testers never corrupt each other's demo.
//
// ROLE IS SERVER-AUTHORITATIVE: it lives here, keyed by an opaque session id.
// The client cookie carries only the signed id, never the role. That is what
// makes `approve_expense`'s manager gate real rather than cosmetic.
export interface Session {
  id: string;
  role: Role;
  board: Expense[];
  decisions: Record<string, TriageResult>; // by expense id, set by triage
  managerApproved: Set<string>; // ids a manager cleared; preserved across re-triage
}

const sessions = new Map<string, Session>();
const MAX_SESSIONS = 500; // bound process memory; evict oldest (insertion order)

export function createSession(id: string, role: Role = "analyst"): Session {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
  const s: Session = { id, role, board: seedBoard(), decisions: {}, managerApproved: new Set() };
  sessions.set(id, s);
  return s;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function setRole(id: string, role: Role): Session | undefined {
  const s = sessions.get(id);
  if (s) s.role = role;
  return s;
}

// test/demo helper
export function resetSession(id: string): Session {
  return createSession(id, "analyst");
}
