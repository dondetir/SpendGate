import { getOrCreateSession } from "@/lib/session-cookie";
import { readExpense } from "@/lib/service";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const body = (await request.json().catch(() => null)) as unknown;
  const id = body && typeof body === "object" ? (body as { id?: string }).id : undefined;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const expense = readExpense(session, id);
  if (!expense) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(expense);
}
