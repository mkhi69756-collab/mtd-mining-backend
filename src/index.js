export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(env)
      });
    }

    if (url.pathname === "/") {
      return Response.json({
        status: "online",
        message: "MTD Mining Backend Running!"
      }, { headers: corsHeaders(env) });
    }

    return Response.json({
      error: "Route not found"
    }, {
      status: 404,
      headers: corsHeaders(env)
    });
  }
};

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin":
      env.FRONTEND_ORIGIN || "https://mkhi69756-collab.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
    "Content-Type": "application/json"
  };
}
