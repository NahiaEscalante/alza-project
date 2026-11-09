/**
 * Chat (4.6, 5.9, 12.2, HU-13): she asks about her numbers or how ALZA works; when she asks for a
 * change, ALZA shows «Encontré este registro: … Después: …» with [Confirmar] [Cancelar]. Nothing
 * changes until she confirms with her PIN (the shared PIN sheet retries by itself, 14.3).
 * 30 messages a day (PR06): past that, the box gives way to a friendly notice.
 */
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { MethodIcon } from '../components/entry-row';
import { CheckIcon, InfoIcon } from '../components/icons';
import { HIDDEN_AMOUNT, Money } from '../components/money';
import { PersonalRuleOfferBody } from '../components/personal-rule';
import { Page } from '../components/shell';
import { BeforeAfter, Button, ErrorState, Notice, Sheet, Spinner } from '../components/ui';
import { ApiError, api, errorMessage } from '../lib/api';
import { capitalize, plural } from '../lib/format';
import type {
  ChatAnswerResponse,
  ChatHistoryResponse,
  ChatLimit,
  ChatMessageView,
  ChatSendResponse,
  CounterpartyRulesResponse,
  PersonalRuleOffer,
  ProposalEntryCard,
  ProposalView,
} from '../lib/types';
import { useApi } from '../lib/use-api';
import { useHideAmounts } from '../state/hide-amounts';
import { isPinCancelled, usePinGate } from '../state/pin';

const MAX_CHARS = 500;
const LIMIT_TEXT =
  'Por hoy ya llegamos a los 30 mensajes del chat. Mañana puedes seguir preguntándome. Tus números siguen en Inicio y Movimientos.';
const FALLBACK_SUGGESTIONS = ['¿Cuánto vendí esta semana?', '¿Cuántos puntos tengo?'];

/** «S/ 1 234,50» in a reply becomes «S/ ••••» when she hides amounts (RF-WP-11). */
const AMOUNT = /S\/\s?\d+(?:[  ]\d{3})*(?:[.,]\d+)*/g;

function ReplyText({ text }: { text: string }) {
  const { hidden } = useHideAmounts();
  return <>{hidden ? text.replace(AMOUNT, HIDDEN_AMOUNT) : text}</>;
}

type Pending = { text: string } | null;

export function ChatScreen() {
  const history = useApi<ChatHistoryResponse>('/chat/history');
  const [messages, setMessages] = useState<ChatMessageView[] | null>(null);
  const [limit, setLimit] = useState<ChatLimit | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<Pending>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [offer, setOffer] = useState<PersonalRuleOffer | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (history.data && messages === null) {
      setMessages(history.data.messages);
      setLimit(history.data.limit);
    }
  }, [history.data, messages]);

  const count = (messages?.length ?? 0) + (sending ? 1 : 0) + (failure ? 1 : 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the conversation grows
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending || limit?.reached) return;
    setDraft('');
    setFailure(null);
    setSending({ text: message });
    try {
      const res = await api.post<ChatSendResponse>('/chat', { message });
      setMessages((current) => [...(current ?? []), ...res.messages]);
      setLimit(res.limit);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'chat_limit') {
        setLimit(
          (err.body.limit as ChatLimit | undefined) ?? {
            used: 30,
            max: 30,
            remaining: 0,
            reached: true,
          },
        );
      } else {
        setDraft(message);
        setFailure(errorMessage(err));
      }
    } finally {
      setSending(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function answered(result: ChatAnswerResponse) {
    setMessages((current) => [
      ...(current ?? []).map((m) =>
        m.proposal?.id === result.proposal.id ? { ...m, proposal: result.proposal } : m,
      ),
      result.reply,
    ]);
  }

  function updateProposal(proposal: ProposalView) {
    setMessages((current) =>
      (current ?? []).map((m) => (m.proposal?.id === proposal.id ? { ...m, proposal } : m)),
    );
  }

  /** PR14: after marking an incoming payment «personal», the offer may be due (as in Movimientos). */
  async function checkPersonalOffer(proposal: ProposalView) {
    const entry = proposal.before;
    if (proposal.type !== 'change_category' || proposal.after.entry?.category !== 'personal')
      return;
    if (!entry?.counterparty || entry.direction !== 'in') return;
    try {
      const rules = await api.get<CounterpartyRulesResponse>('/counterparty-rules');
      const match = rules.offers.find(
        (o) => o.counterparty.toLowerCase() === entry.counterparty?.toLowerCase(),
      );
      setOffer(match ?? null);
    } catch {
      // The offer also waits in Inicio.
    }
  }

  const suggestions = history.data?.suggestions ?? FALLBACK_SUGGESTIONS;
  const empty = messages !== null && messages.length === 0 && !sending;

  return (
    <Page docTitle="Chat">
      <h1 className="mx-1 mt-1 mb-1 text-2xl leading-tight font-bold text-text">Chat</h1>
      <p className="mx-1 mb-3 text-[15px] text-muted">
        Pregúntame por tus números. No cambio nada sin que lo confirmes con tu PIN.
      </p>

      {history.error && messages === null ? (
        <ErrorState message={errorMessage(history.error)} onRetry={history.reload} />
      ) : messages === null ? (
        <div role="status" className="flex justify-center py-10 text-purple">
          <Spinner className="size-7" />
          <span className="sr-only">Cargando…</span>
        </div>
      ) : (
        <div role="log" aria-label="Conversación con ALZA" className="flex flex-col gap-2.5 pt-1">
          {empty && (
            <Bubble from="assistant">
              Hola. Puedo decirte cuánto vendiste, cuánto salió o cuántos puntos tienes. Si algo
              está mal anotado, dime cuál y te muestro el cambio para que lo confirmes.
            </Bubble>
          )}
          {messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-2">
              <Bubble from={m.role}>
                {m.role === 'assistant' ? <ReplyText text={m.content} /> : m.content}
              </Bubble>
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  onAnswered={(result) => {
                    answered(result);
                    if (result.proposal.status === 'confirmed') {
                      void checkPersonalOffer(result.proposal);
                    }
                  }}
                  onStale={updateProposal}
                />
              )}
            </div>
          ))}
          {sending && (
            <>
              <Bubble from="user">{sending.text}</Bubble>
              <Bubble from="assistant">
                <span className="flex items-center gap-1.5 py-1" aria-hidden="true">
                  <Dot delay="0ms" />
                  <Dot delay="150ms" />
                  <Dot delay="300ms" />
                </span>
                <span className="sr-only">ALZA está escribiendo…</span>
              </Bubble>
            </>
          )}
          {failure && (
            <div role="alert">
              <Bubble from="assistant" tone="muted">
                {failure}
              </Bubble>
            </div>
          )}
          {empty && (
            <fieldset className="mt-1 flex flex-wrap gap-2">
              <legend className="sr-only">Preguntas sugeridas</legend>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="min-h-11 rounded-full bg-[#eef2f8] px-4 text-sm font-semibold text-navy hover:bg-[#e2e8f3]"
                >
                  {s}
                </button>
              ))}
            </fieldset>
          )}
          {empty && (
            <p className="mx-1 mt-2 text-sm text-muted">
              Este chat no evalúa ni promete créditos. Para mostrar tu historial, descárgalo en
              Movimientos.
            </p>
          )}
          {/* The newest message lands above the fixed box and the tabs (~140 px). */}
          <div ref={endRef} className="scroll-mb-44" />
          <div className="h-20" aria-hidden="true" />
        </div>
      )}

      {messages !== null && (
        <div className="fixed inset-x-0 bottom-[calc(71px+env(safe-area-inset-bottom))] z-20 mx-auto max-w-110 border-t border-border bg-bg/95 px-3 pt-2 pb-2 backdrop-blur supports-backdrop-filter:bg-bg/85">
          {limit?.reached ? (
            <Notice tone="info">{LIMIT_TEXT}</Notice>
          ) : (
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <label htmlFor={inputId} className="sr-only">
                Escribe tu pregunta
              </label>
              <textarea
                id={inputId}
                value={draft}
                rows={1}
                maxLength={MAX_CHARS}
                enterKeyHint="send"
                placeholder="Escribe tu pregunta…"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
                className="max-h-28 min-h-12 flex-1 resize-none rounded-3xl border border-border bg-white px-4 py-3 text-base text-text placeholder:text-muted"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending !== null}
                aria-label="Enviar"
                className="grid size-12 shrink-0 place-items-center rounded-full bg-purple text-white disabled:opacity-50"
              >
                {sending ? <Spinner className="size-5" /> : <SendIcon />}
              </button>
            </form>
          )}
          {limit && !limit.reached && limit.remaining <= 5 && (
            <p className="mx-2 mt-1.5 text-sm text-muted">
              Te {plural(limit.remaining, 'queda', 'quedan')} {limit.remaining}{' '}
              {plural(limit.remaining, 'mensaje', 'mensajes')} hoy.
            </p>
          )}
        </div>
      )}

      <Sheet open={offer !== null} onClose={() => setOffer(null)} title="¿Quieres que no cuenten?">
        {offer && <PersonalRuleOfferBody offer={offer} onDone={() => setOffer(null)} />}
      </Sheet>
    </Page>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-2 rounded-full bg-muted motion-safe:animate-pulse"
      style={{ animationDelay: delay }}
    />
  );
}

function Bubble({
  from,
  tone,
  children,
}: {
  from: 'user' | 'assistant';
  tone?: 'muted';
  children: ReactNode;
}) {
  const mine = from === 'user';
  return (
    <div
      className={`max-w-[88%] px-3.5 py-3 text-base leading-normal whitespace-pre-line ${
        mine
          ? 'self-end rounded-[16px_16px_4px_16px] bg-lav-soft text-text'
          : `self-start rounded-[16px_16px_16px_4px] border border-border ${
              tone === 'muted' ? 'bg-[#fdf3e7] text-[#8a3f06]' : 'bg-card text-text'
            }`
      }`}
    >
      <span className="sr-only">{mine ? 'Tú: ' : 'ALZA: '}</span>
      {children}
    </div>
  );
}

/** «Jue 12 · 11:05 · Yape · Carlos R.» and «S/ 100 · Venta · Con captura». */
function EntryLines({ entry, label = true }: { entry: ProposalEntryCard; label?: boolean }) {
  const head = [capitalize(entry.dayLabel), entry.time, entry.methodText, entry.counterparty]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="flex items-start gap-2.5">
      <MethodIcon entry={entry} />
      <span className="min-w-0">
        <span className="block font-normal break-words">{head}</span>
        <span className="block">
          <Money cents={entry.amountCents} sign={entry.direction} className="font-semibold" /> ·{' '}
          {entry.categoryText}
          {label && <span className="font-normal text-muted"> · {entry.labelText}</span>}
        </span>
      </span>
    </span>
  );
}

function AfterLine({ proposal }: { proposal: ProposalView }) {
  const { entry, text } = proposal.after;
  if (proposal.type === 'correct_amount' && entry) {
    return (
      <span>
        <Money cents={entry.amountCents} className="font-semibold" /> · {entry.labelText}
      </span>
    );
  }
  return <span>{capitalize(text)}</span>;
}

function ProposalCard({
  proposal,
  onAnswered,
  onStale,
}: {
  proposal: ProposalView;
  onAnswered: (result: ChatAnswerResponse) => void;
  onStale: (proposal: ProposalView) => void;
}) {
  const withPin = usePinGate();
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = proposal.status === 'proposed';

  async function answer(kind: 'confirm' | 'cancel') {
    setBusy(kind);
    setError(null);
    try {
      const path = `/chat/actions/${proposal.id}/${kind}`;
      const result =
        kind === 'confirm'
          ? await withPin(() => api.post<ChatAnswerResponse>(path), 'chat')
          : await api.post<ChatAnswerResponse>(path);
      onAnswered(result);
    } catch (err) {
      if (isPinCancelled(err)) return;
      if (err instanceof ApiError && err.status === 409 && err.body.proposal) {
        onStale(err.body.proposal as ProposalView);
      }
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Cambio propuesto"
      className="self-stretch rounded-[18px] border border-[#d9c8f5] bg-card p-4"
    >
      <p className="mb-2.5 text-base font-semibold text-navy">{proposal.intro}</p>
      {proposal.type === 'add_past_entry' && proposal.after.entry ? (
        <div className="rounded-[14px] bg-bg px-4 py-3 text-base">
          <EntryLines entry={proposal.after.entry} />
        </div>
      ) : (
        <BeforeAfter
          before={
            <span className="flex flex-col gap-1.5">
              {proposal.question && <span className="font-normal">{proposal.question}</span>}
              {proposal.before && <EntryLines entry={proposal.before} />}
            </span>
          }
          after={<AfterLine proposal={proposal} />}
        />
      )}

      {open ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              onClick={() => void answer('confirm')}
              loading={busy === 'confirm'}
              disabled={busy !== null}
            >
              Confirmar
            </Button>
            <Button
              variant="secondary"
              onClick={() => void answer('cancel')}
              loading={busy === 'cancel'}
              disabled={busy !== null}
            >
              Cancelar
            </Button>
          </div>
          <p className="mx-1 mt-2 text-sm text-muted">Para confirmar te pediré tu PIN.</p>
        </>
      ) : (
        <p
          className={`mt-3 flex items-center gap-2 text-[15px] font-semibold ${
            proposal.status === 'confirmed' ? 'text-ok' : 'text-muted'
          }`}
        >
          {proposal.status === 'confirmed' ? (
            <CheckIcon className="size-5 shrink-0" />
          ) : (
            <InfoIcon className="size-5 shrink-0" />
          )}
          {proposal.status === 'confirmed'
            ? 'Cambio hecho'
            : proposal.status === 'rejected'
              ? 'No cambiaste nada'
              : 'Este cambio ya no está vigente'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[15px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}
