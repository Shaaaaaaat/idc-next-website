import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getMobileStudentContext(req);
  if (!session.ok) {
    if (session.reason === "server_error") {
      return mobileError("INTERNAL_ERROR", 500);
    }
    if (session.reason === "forbidden") {
      return mobileError("FORBIDDEN", 403);
    }
    return mobileError("UNAUTHORIZED", 401);
  }

  return mobileJson({
    user: {
      email: session.context.email,
      clientId: session.context.clientId,
      displayName: session.context.displayName ?? null,
      isActive: true,
    },
  });
}
