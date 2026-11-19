export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "https://mkhi69756-collab.github.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        status: "online",
        message: "MTD Mining Backend Running!"
      }, { headers: cors });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        database: env.DB ? "connected" : "not configured"
      }, { headers: cors });
    }

    return Response.json({
      error: "Route not found"
    }, {
      status: 404,
      headers: cors
    });
  }
};
