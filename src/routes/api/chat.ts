import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

const SYSTEM_PROMPT = `You are a senior data engineering tutor and study companion. Specialties: Python, SQL, PySpark, Spark, Airflow, dbt, Snowflake, BigQuery, Kafka, data modeling, and ETL/ELT design.

Format every answer as well-structured Markdown ready to be saved into a personal notebook:
- Start with a short summary.
- Use headings (## / ###) for sections.
- Use fenced code blocks with the correct language (\`\`\`python, \`\`\`sql, \`\`\`scala for PySpark/Scala examples).
- Prefer realistic, runnable examples.
- End with a short "Key takeaways" bullet list when useful.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(messages)) return new Response("Messages required", { status: 400 });

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
