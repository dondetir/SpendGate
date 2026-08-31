import { getOrCreateSession } from "@/lib/session-cookie";
import { requestApproval } from "@/lib/service";

// request_approval: a read-only authority probe. Returns a structured verdict
// (authorized / role_limit_exceeded / not_awaiting_approval) with a next action
// the agent can act on. Never mutates — the money action stays approve_expense.
export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const body = (await request.json().catch(() => null)) as unknown;
  const id = body && typeof body === "object" ? (body as { id?: string }).id : undefined;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  return Response.json(requestApproval(session, id));
}
