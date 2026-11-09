/**
 * RF-WP-08 (PR14): after 3 «personal» marks on the same incoming counterparty, offer that its
 * payments stop counting as sales. Only applies if she accepts (with her PIN: it changes how her
 * records count); saying no needs nothing.
 */
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { MessageResponse, PersonalRuleOffer } from '../lib/types';
import { isPinCancelled, usePinGate } from '../state/pin';
import { useToast } from '../state/toast';
import { Button, FieldError } from './ui';

export function PersonalRuleOfferBody({
  offer,
  onDone,
}: {
  offer: PersonalRuleOffer;
  onDone: () => void;
}) {
  const withPin = usePinGate();
  const toast = useToast();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setBusy(accept ? 'accept' : 'decline');
    setError(null);
    try {
      const body = { counterpartyKey: offer.counterpartyKey };
      const result = accept
        ? await withPin(() => api.post<MessageResponse>('/counterparty-rules/accept', body))
        : await api.post<MessageResponse>('/counterparty-rules/decline', body);
      if (result.message) toast(result.message);
      onDone();
    } catch (err) {
      if (!isPinCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[17px] font-semibold text-text">{offer.question}</p>
      <p className="text-[15px] text-muted">{offer.hint}</p>
      <FieldError>{error}</FieldError>
      <div className="flex flex-col gap-2">
        <Button
          loading={busy === 'accept'}
          disabled={busy !== null}
          onClick={() => void answer(true)}
        >
          Sí, que no cuenten como venta
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'decline'}
          disabled={busy !== null}
          onClick={() => void answer(false)}
        >
          No, que sigan contando
        </Button>
      </div>
    </div>
  );
}
