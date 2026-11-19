
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigin = "https://mkhi69756-collab.github.io";

    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (origin && origin !== allowedOrigin) {
      return Response.json(
        { error: "Origin not allowed" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        status: "online",
        message: "MTD Mining Backend Running!"
      }, { headers });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        database: env.DB ? "configured" : "not configured"
      }, { headers });
    }

    return Response.json(
      { error: "Route not found" },
      { status: 404, headers }
    );
  }
};
