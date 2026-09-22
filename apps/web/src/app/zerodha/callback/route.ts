import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const api = process.env.API_PROXY ?? "http://127.0.0.1:4000";
  const incoming = new URL(req.url);
  const target = `${api}/zerodha/callback${incoming.search}`;
  const upstream = await fetch(target, {
    redirect: "manual",
    headers: { cookie: req.headers.get("cookie") ?? "" },
  });
  const location = upstream.headers.get("location") ?? "/?connected=1";
  const res = NextResponse.redirect(location, 302);
  const cookies =
    typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : upstream.headers.get("set-cookie")
        ? [upstream.headers.get("set-cookie") as string]
        : [];
  for (const cookie of cookies) {
    res.headers.append("set-cookie", cookie);
  }
  return res;
}
