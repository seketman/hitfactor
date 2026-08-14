// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// Supabase webhook envia: { type, table, schema, record, old_record }
// Para INSERT en feedback, `record` es la fila nueva.
Deno.serve(async (req) => {
  const { record } = await req.json();
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")!;

  if (req.headers.get("x-webhook-secret") !== Deno.env.get("FEEDBACK_WEBHOOK_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const emoji =
    record.type === "bug"
      ? "🐛"
      : record.type === "suggestion"
        ? "💡"
        : "📝";

  const text =
    `${emoji} *Feedback #${record.id}* (${record.type})\n\n` +
    `${record.message}\n\n` +
    `Página: \`${record.page_url ?? "—"}\`\n` +
    `User: \`${record.user_id}\``;

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    },
  );

  return new Response(JSON.stringify({ ok: res.ok }), {
    status: res.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
