export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });

    try {
      const url = new URL(request.url);

      // Health check
      if (url.pathname === "/") {
        return json({
          success: true,
          message: "MTD Mining Backend is live 🚀"
        });
      }

      // API status
      if (url.pathname === "/api/status") {
        return json({
          success: true,
          status: "online",
          backend: "mtd-mining-backend"
        });
      }

      // Register user
      if (url.pathname === "/api/register" && request.method === "POST") {
        const body = await request.json();
        const telegramId = String(body.telegramId || "");
        const fullName = String(body.fullName || "").trim();

        if (!telegramId || !fullName) {
          return json({
            success: false,
            message: "Telegram ID and full name required"
          }, 400);
        }

        await env.DB.prepare(
          `INSERT OR IGNORE INTO users (telegram_id, full_name)
           VALUES (?, ?)`
        ).bind(telegramId, fullName).run();

        return json({
          success: true,
          message: "Registration successful"
        });
      }

      // Get user
      if (url.pathname === "/api/user" && request.method === "GET") {
        const telegramId = url.searchParams.get("telegramId");

        if (!telegramId) {
          return json({
            success: false,
            message: "Telegram ID required"
          }, 400);
        }

        const user = await env.DB.prepare(
          "SELECT * FROM users WHERE telegram_id = ?"
        ).bind(telegramId).first();

        return json({
          success: true,
          user: user || null
        });
      }

      return json({
        success: false,
        message: "Route not found"
      }, 404);

    } catch (error) {
      return json({
        success: false,
        message: "Server error",
        error: error.message
      }, 500);
    }
  }
};
