import { getOrCreateSession } from "@/lib/session-cookie";
import { setRole } from "@/lib/store";
import type { Role } from "@/lib/policy/types";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const { role } = (await request.json().catch(() => ({}))) as { role?: string };
  if (role !== "analyst" && role !== "manager") {
    return Response.json({ error: "role must be analyst or manager" }, { status: 400 });
  }
  setRole(session.id, role as Role);
  return Response.json({ ok: true, role });
}
