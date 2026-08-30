import { getOrCreateSession } from "@/lib/session-cookie";
import { setRole } from "@/lib/store";
import type { Role } from "@/lib/policy/types";

// DEMO AUTH: this endpoint sets the session's role from the request so the demo
// can switch between the analyst and manager personas with a button. In a real
// deployment, role would come from an authenticated identity (SSO/IdP), not the
// client. Note the AGENT cannot reach this: `login` is not a registered WebMCP
// tool, so an analyst agent has no path to self-promote through its tool surface.
export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const body = (await request.json().catch(() => null)) as unknown;
  const role = body && typeof body === "object" ? (body as { role?: string }).role : undefined;
  if (role !== "analyst" && role !== "manager") {
    return Response.json({ error: "role must be analyst or manager" }, { status: 400 });
  }
  setRole(session.id, role as Role);
  return Response.json({ ok: true, role });
}
