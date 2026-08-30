import { getOrCreateSession } from "@/lib/session-cookie";
import { resetSession } from "@/lib/store";

export async function POST() {
  const session = await getOrCreateSession();
  resetSession(session.id);
  return Response.json({ ok: true });
}
