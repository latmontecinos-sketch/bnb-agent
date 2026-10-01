import { randomUUID } from "node:crypto";
import { handleMessage } from "./agent.js";

type Json = Record<string, any>;

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function extractText(message: Json | undefined): string {
  const parts: Json[] = Array.isArray(message?.parts) ? message!.parts : [];
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : p?.data ? JSON.stringify(p.data) : ""))
    .join("\n")
    .trim();
}

/** Handles one JSON-RPC 2.0 request (A2A). Supports message/send (and SendMessage alias). */
export async function handleRpc(body: unknown): Promise<Json> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return rpcError(null, -32600, "Invalid Request");
  const req = body as Json;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return rpcError(req.id, -32600, "Invalid Request");

  switch (req.method) {
    case "message/send":
    case "SendMessage": {
      const message = req.params?.message as Json | undefined;
      if (!message || !Array.isArray(message.parts)) return rpcError(req.id, -32602, "Invalid params: params.message.parts required");
      const text = extractText(message);
      // Execution is allowed from A2A (hirer-triggered rebalance of the agent's own testnet wallet), rate-limited in executePlan.
      const reply = await handleMessage(text || "status", { allowExecute: true });
      const contextId = (message.contextId as string) || randomUUID();
      return rpcResult(req.id, {
        kind: "message",
        messageId: randomUUID(),
        contextId,
        role: "agent",
        parts: [
          { kind: "text", text: reply.text },
          { kind: "data", data: reply.data },
        ],
      });
    }
    case "tasks/get":
    case "tasks/cancel":
      return rpcError(req.id, -32001, "Task not found (this agent replies synchronously with a Message)");
    case "agent/getAuthenticatedExtendedCard":
      return rpcError(req.id, -32007, "Authenticated extended card not configured");
    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}
