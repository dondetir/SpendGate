import { getOrCreateSession } from "@/lib/session-cookie";
import { listBoard } from "@/lib/service";

export async function GET() {
  const session = await getOrCreateSession();
  return Response.json(listBoard(session));
}
