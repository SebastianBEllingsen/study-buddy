import { NextResponse, type NextRequest } from "next/server";
import { isCrossSiteWrite, isUntrustedHost } from "@/lib/crossSite";

// Turns away API writes that another website tried to make through the
// browser, and requests that reach the app under a hostname that isn't the
// machine's own (DNS rebinding) — see lib/crossSite.ts.
export function proxy(request: NextRequest) {
  if (isUntrustedHost(request.headers, process.env.STUDY_BUDDY_ALLOWED_HOSTS)) {
    return NextResponse.json(
      { error: "This host isn't allowed. Set STUDY_BUDDY_ALLOWED_HOSTS to use another hostname." },
      { status: 403 }
    );
  }
  if (isCrossSiteWrite(request.method, request.headers)) {
    return NextResponse.json({ error: "Cross-site requests aren't allowed" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
