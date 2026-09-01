/*
  Cloudflare Workersへ、このファイル全体を貼り付けてDeployしてください。

  Productionで設定する項目:
  Variable:
    REPLIT_API_URL   = Replit APIの公開HTTPSベースURL（/apiは付けない）
  Secrets:
    WORKER_API_KEY   = Workerを呼び出す側のキー
    REPLIT_API_KEY   = ReplitのSAVE_ARTICLE_API_KEYと同じキー
*/

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders },
  });
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-headers": "authorization, content-type, x-api-key",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}

function isAuthorized(request, expectedKey) {
  const bearer = request.headers.get("authorization");
  const apiKey = request.headers.get("x-api-key");
  return (
    (bearer === `Bearer ${expectedKey}` || apiKey === expectedKey) &&
    expectedKey.length > 0
  );
}

function getReplitEndpoint(apiUrl) {
  return `${apiUrl.replace(/\/+$/, "")}/api/saveArticle`;
}

async function handleRequest(request, env = {}) {
    const origin = request.headers.get("origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    const isHealthCheck = request.method === "GET" && url.pathname === "/health";
    const allowedPath =
      url.pathname === "/" ||
      url.pathname === "/saveArticle" ||
      url.pathname === "/api/saveArticle" ||
      isHealthCheck;

    if (!allowedPath) {
      return json({ error: "not_found" }, 404, headers);
    }

    if (!env.WORKER_API_KEY || !env.REPLIT_API_KEY || !env.REPLIT_API_URL) {
      return json(
        {
          error: "worker_not_configured",
          message:
            "Set WORKER_API_KEY, REPLIT_API_KEY, and REPLIT_API_URL in the Production environment.",
        },
        503,
        headers,
      );
    }

    if (!isAuthorized(request, env.WORKER_API_KEY)) {
      return json({ error: "unauthorized" }, 401, {
        ...headers,
        "www-authenticate": "Bearer",
      });
    }

    if (isHealthCheck) {
      return json({ status: "ok" }, 200, headers);
    }

    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, {
        ...headers,
        allow: "POST, OPTIONS",
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400, headers);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(getReplitEndpoint(env.REPLIT_API_URL), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.REPLIT_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let responseBody;
      try {
        responseBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        responseBody = { error: "invalid_upstream_response" };
      }

      return json(responseBody, response.status, headers);
    } catch (error) {
      const message =
        error?.name === "AbortError" ? "Replit API request timed out" : "Replit API request failed";
      return json({ error: "upstream_unavailable", message }, 502, headers);
    } finally {
      clearTimeout(timeout);
    }
}

export default {
  async fetch(request, env = {}) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Worker request failed", { message });
      return json(
        {
          error: "worker_exception",
          message: "The Worker failed before completing the request.",
        },
        500,
        corsHeaders(request.headers.get("origin") || ""),
      );
    }
  },
};