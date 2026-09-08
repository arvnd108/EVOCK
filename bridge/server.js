/**
 * EVOCK - Local Node.js Proxy Bridge
 *
 * Implements the local API-key bridge according to Plan/Role A.md A6
 * and Plan/Building Plan.md §3.3 & §8.
 *
 * CRITICAL SECURITY ARCHITECTURE:
 * 1. Holds the OPENROUTER_API_KEY on the developer's local machine via .env.
 * 2. Listens ONLY on 127.0.0.1:8787 (never 0.0.0.0) - enforced below.
 * 3. Restricts CORS to Chrome extension origins (chrome-extension://) and localhost.
 * 4. NEVER logs the screenshot image, API key, or sensitive evidence message texts.
 * 5. NEVER writes screenshots to disk.
 *
 * Zero runtime dependencies: Node's built-in http + a tiny .env reader.
 * Requires Node >= 18 (global fetch / AbortController).
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Minimal .env reader for bridge/.env (git-ignored). Shell env always wins. */
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip one pair of surrounding quotes, if present.
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

// This service must never be reachable from the network. Force loopback even
// if BRIDGE_HOST is set to a public/wildcard address.
let HOST = process.env.BRIDGE_HOST || "127.0.0.1";
if (["0.0.0.0", "::", "*", ""].includes(HOST)) {
  console.warn(`EVOCK bridge: refusing to bind "${HOST || "(empty)"}"; using 127.0.0.1.`);
  HOST = "127.0.0.1";
}
const PORT = Number.parseInt(process.env.BRIDGE_PORT || "8787", 10);
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL?.trim() || "qwen/qwen3-vl-30b-a3b-instruct";
// Optional: pin CORS to exactly one origin, e.g. chrome-extension://<your-id>.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN?.trim() || "";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30000; // 30 second timeout per Role A.md

/**
 * Validates whether the origin is a trusted extension or local developer context.
 * @param {string|undefined} origin
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGIN) return origin === ALLOWED_ORIGIN;
  if (!origin) return true; // Direct local requests (curl, extensions without origin)
  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("http://localhost")
  );
}

/**
 * Sets restricted CORS headers based on request origin.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {boolean} True if origin was allowed, false if rejected
 */
function handleCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Max-Age", "86400");
    // Chrome Private Network Access: a fetch from an extension page/worker to a
    // loopback address triggers a preflight carrying this request header. Without
    // the matching response header Chrome blocks the request outright and the
    // extension only sees a generic "failed to fetch" — which surfaces in EVOCK
    // as "AI extraction failed". Echo the grant so the loopback call is allowed.
    if (req.headers["access-control-request-private-network"] === "true") {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  } else if (origin) {
    return false;
  }
  return true;
}

/**
 * Handle GET /health
 */
function handleHealth(req, res) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const status = {
    status: "ok",
    service: "evock-bridge",
    version: "0.1.0",
    model,
    apiKeyConfigured: Boolean(apiKey && apiKey.trim().length > 0)
  };

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(status, null, 2));
}

/**
 * Handle POST /extract
 */
async function handleExtract(req, res, bodyString) {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] POST /extract - Request received`);

  let body;
  try {
    body = JSON.parse(bodyString);
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] POST /extract - Invalid JSON body: ${err.message}`);
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Invalid JSON request body." }));
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Request body must be a JSON object." }));
  }

  // 1. Validate image presence
  if (!body.image || typeof body.image !== "string") {
    console.warn(`[${new Date().toISOString()}] POST /extract - Missing or invalid image field`);
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Missing image in request body." }));
  }

  // 2. Validate image format (must be data URL)
  if (!body.image.startsWith("data:image/")) {
    console.warn(`[${new Date().toISOString()}] POST /extract - Unsupported image format`);
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: false,
        error: "Invalid image format: must be a base64 image data URL (e.g. data:image/png;base64,...)."
      })
    );
  }

  // 3. Validate OpenRouter API key configuration
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.error(`[${new Date().toISOString()}] POST /extract - OPENROUTER_API_KEY is missing`);
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: false,
        error: "OPENROUTER_API_KEY is not configured in bridge/.env. Please configure your API key."
      })
    );
  }

  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  const systemPrompt =
    body.system ||
    "You are a digital evidence preservation assistant for EVOCK. Extract ONLY visibly present digital evidence in strict JSON. Never guess, infer, hallucinate, or alter message text.";
  const userPrompt =
    body.prompt ||
    "Extract visible digital conversation metadata from this screenshot into strict JSON.";

  console.log(
    `[${new Date().toISOString()}] POST /extract - Dispatching to OpenRouter (model: ${model}, image length: ${body.image.length} chars)`
  );

  // 4. Construct OpenRouter chat completion request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const openRouterResponse = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:8787",
        "X-Title": "EVOCK Digital Evidence Preservation"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userPrompt
              },
              {
                type: "image_url",
                image_url: {
                  url: body.image,
                  // Dense chat screenshots get downsampled at default detail,
                  // which is when the model starts missing/merging/reordering
                  // bubbles. Ask for full-resolution analysis.
                  detail: "high"
                }
              }
            ]
          }
        ],
        // Deterministic decoding: ordering and verbatim text must not vary
        // between runs on the same screenshot.
        temperature: 0,
        top_p: 1,
        seed: 42,
        // A full WhatsApp Web screenshot can hold many messages; 4096 was
        // truncating the JSON mid-array. Give the completion real headroom.
        max_tokens: 8192,
        response_format: {
          type: "json_object"
        },
        // OpenRouter may route one model to several backend providers with
        // different determinism guarantees. Only use backends that actually
        // honour temperature/seed/response_format, and don't silently fall back.
        provider: {
          require_parameters: true,
          allow_fallbacks: false
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
      } catch {}

      console.error(
        `[${new Date().toISOString()}] OpenRouter failed in ${duration}ms (status: ${openRouterResponse.status}): ${errorDetails}`
      );

      res.writeHead(openRouterResponse.status, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: false,
          error: `OpenRouter API error (${openRouterResponse.status}): ${errorDetails}`
        })
      );
    }

    const openRouterData = await openRouterResponse.json();
    const content = openRouterData.choices?.[0]?.message?.content;

    if (!content) {
      console.warn(`[${new Date().toISOString()}] OpenRouter returned empty content in ${duration}ms`);
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: false,
          error: "OpenRouter returned empty content in model completion."
        })
      );
    }

    console.log(`[${new Date().toISOString()}] POST /extract - Success in ${duration}ms (model: ${openRouterData.model || model})`);

    // Return model output cleanly to extension
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: true,
        model: openRouterData.model || model,
        content
      })
    );
  } catch (fetchError) {
    clearTimeout(timeoutId);

    if (fetchError.name === "AbortError") {
      console.error(`[${new Date().toISOString()}] POST /extract - OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      res.writeHead(504, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: false,
          error: `OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`
        })
      );
    }

    console.error(`[${new Date().toISOString()}] POST /extract - Network/Fetch error: ${fetchError.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: false,
        error: `Failed to communicate with OpenRouter: ${fetchError.message}`
      })
    );
  }
}

/**
 * Initializes and starts the HTTP server.
 */
export function createBridgeServer() {
  const server = http.createServer(async (req, res) => {
    // 1. CORS Check
    const allowed = handleCors(req, res);
    if (!allowed) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Origin not allowed by bridge CORS policy." }));
    }

    // 2. Preflight OPTIONS
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    // 3. GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      return handleHealth(req, res);
    }

    // 4. POST /extract
    if (req.method === "POST" && url.pathname === "/extract") {
      const maxLimit = 10 * 1024 * 1024; // 10MB limit per Role A.md
      let body = "";
      let aborted = false;

      const fail = (code, message) => {
        if (aborted) return;
        aborted = true;
        if (!res.headersSent) {
          res.writeHead(code, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: message }));
        }
        req.destroy();
      };

      req.on("data", (chunk) => {
        if (aborted) return;
        body += chunk;
        if (body.length > maxLimit) fail(413, "Payload exceeds the 10MB limit.");
      });
      req.on("error", () => fail(400, "Request stream error."));
      req.on("end", () => {
        if (aborted) return;
        handleExtract(req, res, body).catch((err) => {
          console.error(`[${new Date().toISOString()}] POST /extract - unhandled: ${err?.message || err}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Internal bridge error." }));
          }
        });
      });
      return;
    }

    // 404 Not Found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `Route not found: ${req.method} ${url.pathname}` }));
  });

  // Drop malformed connections instead of crashing the process.
  server.on("clientError", (err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return server;
}

// Start server if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.on("unhandledRejection", (reason) => {
    console.error(`[${new Date().toISOString()}] Unhandled rejection: ${reason?.message || reason}`);
  });

  const server = createBridgeServer();
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`EVOCK bridge: port ${PORT} is already in use. Stop the other process or set BRIDGE_PORT.`);
    } else {
      console.error(`EVOCK bridge: server error: ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log("==================================================");
    console.log("  EVOCK Local Node Bridge");
    console.log(`  Listening on: http://${HOST}:${PORT}`);
    console.log(`  Health Check: http://${HOST}:${PORT}/health`);
    console.log(`  Extract API:  POST http://${HOST}:${PORT}/extract`);
    console.log("==================================================");
  });
}
