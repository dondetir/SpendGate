import { getOrCreateSession } from "@/lib/session-cookie";
import { runTriage } from "@/lib/service";

export async function POST() {
  const session = await getOrCreateSession();
  const results = runTriage(session);
  const summary = {
    total: results.length,
    approved: results.filter((r) => r.status === "approved").length,
    flagged: results.filter((r) => r.status === "flagged").length,
    rejected: results.filter((r) => r.status === "rejected").length,
    untrustedFlagged: results.filter((r) => r.untrusted).length,
  };
  return Response.json({ summary, results });
}
