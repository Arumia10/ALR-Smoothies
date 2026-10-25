// Test-only entry point. Never referenced by wrangler.jsonc or deployed.
import { createWorker } from "../../cloudflare/worker.js";
export default createWorker(async (url, options) => {
  if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    const { response } = JSON.parse(options.body);
    if (response === "unavailable") return new Response("", { status: 503 });
    return Response.json({
      success: ["valid-test-token", "wrong-host", "wrong-action"].includes(
        response,
      ),
      hostname:
        response === "wrong-host" ? "evil.invalid" : "vitaminboost.test",
      action: response === "wrong-action" ? "login" : "order",
    });
  }
  if (url === "https://api.resend.com/emails") {
    const body = JSON.parse(options.body);
    if (body.to[0] === "fail@example.invalid")
      return new Response("", { status: 503 });
    return Response.json({ id: "fake-email-id" });
  }
  throw new Error("Unexpected network request: " + url);
});
