import { describe, expect, it } from 'vitest';
import { EXPLAIN_TOPICS, explainTopicFor } from './texts.js';

describe('explainTopicFor (explain tool, 10.5)', () => {
  it.each([
    ['comodín', 'freeze'],
    ['¿Qué es un comodín?', 'freeze'],
    ['racha', 'streak'],
    ['puntos', 'points'],
    ['canjear premios', 'rewards'],
    ['cierre completo', 'complete_close'],
    ['cierre a medias', 'partial_close'],
    ['el cierre', 'daily_close'],
    ['día del negocio', 'business_day'],
    ['Lo contaste tú', 'self_reported'],
    ['Con captura', 'with_screenshot'],
    ['Por confirmar', 'pending_to_confirm'],
    ['pendientes', 'pending_items'],
    ['te quedó', 'left'],
    ['Entró', 'came_in'],
    ['PIN', 'pin'],
    ['descargar mi historial', 'history_download'],
    ['privacidad', 'privacy'],
    ['freeze', 'freeze'],
    ['history_download', 'history_download'],
  ])('«%s» → %s', (words, topic) => {
    expect(explainTopicFor(words)).toBe(topic);
  });

  it('every key resolves to itself; unknown words resolve to nothing', () => {
    for (const key of Object.keys(EXPLAIN_TOPICS)) expect(explainTopicFor(key)).toBe(key);
    expect(explainTopicFor('el clima de mañana')).toBeNull();
  });
});
