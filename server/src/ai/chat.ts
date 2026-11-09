/**
 * `chat` of the AI layer (8.3, 10.5): message + history + tools → text, plus whatever the tool
 * session collected (e.g. a proposed change). The tool loop is vendor neutral; each provider only
 * runs one step (`ProviderClient.chat`).
 *
 * - Tools are executed by the caller's session, never by the model: the model only asks.
 * - Tool results go back as delimited DATA (RF-CH-04): names from screenshots are never
 *   instructions.
 * - A failover restarts the turn on the next route with a fresh tool session, so a half-done
 *   attempt leaves nothing behind (`ChatToolbox.open`).
 */
import { dataBlock } from './prompts/data.js';
import { type ChatTurn, ProviderError, type ToolCall, type ToolSpec } from './providers/types.js';
import { InvalidOutput, type Route } from './router.js';

/** Model steps per turn; the last one must answer in text. */
export const CHAT_MAX_STEPS = 4;
/** Tool calls honored per step (extra ones get an error result). */
export const CHAT_MAX_CALLS_PER_STEP = 4;
/** Longest reply kept (the prompt asks for 1–3 sentences). */
export const CHAT_MAX_REPLY_CHARS = 1_200;

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** One turn's tool executor. `finish` returns what it collected (read by the caller). */
export interface ChatToolSession<T> {
  /**
   * Runs a tool. Bad arguments return an error object for the model; an unexpected exception is
   * turned into `tool_failed` by the loop so it never counts against the provider.
   */
  execute(name: string, args: unknown): Promise<unknown>;
  finish(): T;
}

export interface ChatToolbox<T> {
  specs: ToolSpec[];
  /** A fresh session per attempt. */
  open(): ChatToolSession<T>;
}

export interface ChatInput<T> {
  message: string;
  /** Oldest first, without the current message. */
  history: ChatHistoryMessage[];
  tools: ChatToolbox<T>;
  /** Approved answer for credit questions (RF-CH-02), quoted in the prompt. */
  creditAnswer: string;
  /** Business clock for «hoy». Default: the layer's clock. */
  now?: Date;
}

export interface ChatOutput<T> {
  text: string;
  /** What the successful attempt's tool session collected. */
  tools: T;
  /** Tool names called, in order (logs and tests; never arguments). */
  toolCalls: string[];
}

function toolResult(output: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(output ?? null);
  } catch {
    json = '{"error":"unserializable"}';
  }
  return dataBlock('tool_result', json);
}

/** One attempt on one route: the whole tool loop. */
export async function runChatAttempt<T>(
  route: Route,
  input: ChatInput<T>,
  system: string,
  signal: AbortSignal,
): Promise<ChatOutput<T> | InvalidOutput> {
  const client = route.client;
  if (!client.chat) throw new ProviderError('unsupported');
  const session = input.tools.open();
  const messages: ChatTurn[] = [
    ...input.history.map((m): ChatTurn => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.message },
  ];
  const called: string[] = [];

  for (let step = 1; step <= CHAT_MAX_STEPS; step++) {
    const last = step === CHAT_MAX_STEPS;
    const res = await client.chat(
      route.model,
      {
        system,
        messages,
        tools: input.tools.specs,
        toolChoice: last ? 'none' : 'auto',
        temperature: 0.2,
        maxOutputTokens: 1_024,
      },
      signal,
    );
    if (res.toolCalls.length === 0 || last) {
      const text = res.text.trim();
      if (!text) return new InvalidOutput('chat_empty_reply');
      return {
        text: text.length > CHAT_MAX_REPLY_CHARS ? `${text.slice(0, CHAT_MAX_REPLY_CHARS)}…` : text,
        tools: session.finish(),
        toolCalls: called,
      };
    }
    const calls: ToolCall[] = res.toolCalls.map((call, i) => ({
      ...call,
      id: call.id || `call_${step}_${i + 1}`,
    }));
    messages.push({
      role: 'assistant',
      content: res.text,
      toolCalls: calls,
      providerData: res.providerData,
    });
    for (const [i, call] of calls.entries()) {
      let output: unknown;
      if (i >= CHAT_MAX_CALLS_PER_STEP) output = { error: 'too_many_calls' };
      else {
        called.push(call.name);
        try {
          output = await session.execute(call.name, call.arguments);
        } catch {
          // Our failure (e.g. the database), not the provider's: the model says it could not
          // look, and the route is not blamed.
          output = {
            ok: false,
            error: 'tool_failed',
            say: 'Dile: «No pude revisar tus datos ahora. Intenta de nuevo en un momento.»',
          };
        }
      }
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: toolResult(output),
      });
    }
  }
  return new InvalidOutput('chat_too_many_steps');
}
