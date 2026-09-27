import { NextResponse, type NextRequest } from "next/server";
import { isCrossSiteWrite } from "@/lib/crossSite";

// Turns away API writes that another website tried to make through the
// browser — see lib/crossSite.ts.
export function proxy(request: NextRequest) {
  if (isCrossSiteWrite(request.method, request.headers)) {
    return NextResponse.json({ error: "Cross-site requests aren't allowed" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
