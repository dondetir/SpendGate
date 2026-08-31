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
      // Machine-actionable refusal: reason_code + how to self-correct.
      return Response.json(
        {
          ok: false,
          error: err.message,
          reason_code: err.reason_code,
          human_reason: err.message,
          required_role: err.required_role,
          escalation: err.escalation,
          expenseId: err.expenseId,
        },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : "error";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
