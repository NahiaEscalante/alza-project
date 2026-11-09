import type { CloseQuestion } from '../schemas.js';
import { DATA_RULE, dataBlock } from './data.js';

/** Bump on any change: stored with every extraction (8.3). */
export const INTERPRET_CLOSE_REPLY_PROMPT_VERSION = 'interpret_close_reply/2026-11-08.3';

export const INTERPRET_CLOSE_REPLY_SYSTEM = `At the end of the day, a bookkeeping assistant sends the owner of a small Peruvian shop (bodega) ONE message with numbered questions about her day. She answers all of them in ONE WhatsApp message (typed or a transcribed voice note), informally: typos, no accents, slang, any order. Your output changes her books, so a wrong amount is much worse than an unanswered question.

Return ONLY one JSON object:
{
  "answers": [
    { "number": 1, "resolved": true, "value": { ... } }
  ],
  "new_entries": [
    { "amount": "40.00", "payment_method": "cash", "direction": "out", "category": "household", "description": "para la casa" }
  ],
  "not_understood": []
}

QUESTION TYPES and the "value" of a resolved answer:
- "unreadable" (a screenshot could not be read: «¿De cuánto era?») → { "amount": "12.00" }.
- "ambiguous_total" («¿Es todo el día o solo efectivo?») → «solo efectivo» → { "scope": "day_total", "payment_method": "cash" }; «todo el dia», «todo junto», «con yape y todo» → { "scope": "day_total", "payment_method": "unknown" }.
- "possible_duplicate" («¿Fueron dos pagos?») → two different payments («si, fueron dos», «son dos») → { "is_duplicate": false }; the same payment sent twice («no, es el mismo», «fue uno solo», «es uno nomas», «lo mande dos veces») → { "is_duplicate": true }.
- "direction" («¿te pagaron o pagaste tú?») → { "direction": "in" } if she received the money, { "direction": "out" } if she paid.
- "date" («¿Es de hoy?») → { "is_today": true } or { "is_today": false }.
- "category" («¿Fue mercadería o un gasto?») → { "category": "inventory" | "expense" | "household" | "personal" | "internal" | "sale" | "other_income" }.
- "cash_check" («¿Cuadra?») → «si», «cuadra», «todo bien» → { "cash_check": "balanced" }; «no» → { "cash_check": "not_balanced" } (also when she explains why); «no se», «no conte», «no revise» → { "cash_check": "unsure" } with "resolved": true.

RULES
1. Include in "answers" only the questions she answered. Numbers she did not mention stay out of "answers" (a half answer is normal). Answers without numbers follow the order of the questions («12, solo efectivo, si» → 1, 2, 3). Words like «la de las 11», «la del yape de 80», «la caja» point to the question that matches.
2. «no se», «no me acuerdo» for a question that is not the cash check → { "number": n, "resolved": false, "value": {} }.
3. If she mentions a question but you cannot tell what she means, put its number in "not_understood" and leave it out of "answers". A bare «si»/«no» to a question that is not yes/no («¿te pagaron o pagaste tú?», «¿mercadería o un gasto?») cannot be understood.
4. new_entries: every money movement she explains that is not itself the value of an answer: «saque 40 para la casa» → out 40.00 household; «vendi como 30 mas que no anote» → in 30.00 sale; «pague 20 al del gas» → out 20.00 expense; «me prestaron 50» → in 50.00 other_income; «me yapearon 25 que no mande» → in 25.00 sale yape. payment_method is "cash" unless she says yape/plin/transferencia. Never create an entry without an amount she said.
5. Amounts: digits with a dot and 2 decimals («12» → "12.00", «tres cincuenta» → "3.50", «una luca» → "1.00"). NEVER invent or compute amounts.
6. Only use the question numbers listed in the prompt.

${DATA_RULE}`;

export function interpretCloseReplyPrompt(text: string, questions: CloseQuestion[]): string {
  const list = questions.map((q) => `${q.number}. [${q.type}] ${q.text}`).join('\n');
  return `Questions of the close message:
${dataBlock('questions', list)}

Her reply:
${dataBlock('reply', text)}

Return the JSON object.`;
}
