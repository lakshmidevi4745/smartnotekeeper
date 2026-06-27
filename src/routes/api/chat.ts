import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";

const SYSTEM_PROMPT = `You are a senior data engineering tutor and study companion. Specialties: Python, SQL, PySpark, Spark, Airflow, dbt, Snowflake, BigQuery, Kafka, data modeling, and ETL/ELT design.

Format every answer as well-structured Markdown ready to be saved into a personal notebook:
- Start with a short summary.
- Use headings (## / ###) for sections.
- Use fenced code blocks with the correct language (\`\`\`python, \`\`\`sql, \`\`\`scala for PySpark/Scala examples).
- Prefer realistic, runnable examples.
- End with a short "Key takeaways" bullet list when useful.`;

const MAX_MESSAGES = 50;
const MAX_TOTAL_CHARS = 50_000;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Authn: require a valid Supabase bearer token
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token || token.split(".").length !== 3) {
          return new Response("Unauthorized", { status: 401 });
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Server misconfigured", { status: 500 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claimsData?.claims?.sub) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { messages } = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(messages)) return new Response("Messages required", { status: 400 });
        if (messages.length === 0 || messages.length > MAX_MESSAGES) {
          return new Response("Too many messages", { status: 400 });
        }
        const totalChars = JSON.stringify(messages).length;
        if (totalChars > MAX_TOTAL_CHARS) {
          return new Response("Payload too large", { status: 413 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages as UIMessage[]),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});
