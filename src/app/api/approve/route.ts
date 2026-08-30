import { getOrCreateSession } from "@/lib/session-cookie";
import { approveExpense, AuthzError } from "@/lib/service";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const body = (await request.json().catch(() => null)) as unknown;
  const id = body && typeof body === "object" ? (body as { id?: string }).id : undefined;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    const view = approveExpense(session, id);
    return Response.json({ ok: true, expense: view });
  } catch (err) {
    if (err instanceof AuthzError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "error";
    return Response.json({ error: message }, { status: 400 });
  }
}
