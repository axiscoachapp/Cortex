import { describe, expect, it } from 'vitest';
import { displayPhone, matchesContactSearch, waitingLabel } from './queueTime';

const now = Date.parse('2026-11-11T15:00:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

describe('waiting time of a queue case', () => {
  it('reads like a front desk clock', () => {
    expect(waitingLabel(ago(0), now)).toBe('agora');
    expect(waitingLabel(ago(12), now)).toBe('há 12 min');
    expect(waitingLabel(ago(60), now)).toBe('há 1 h');
    expect(waitingLabel(ago(125), now)).toBe('há 2 h 5 min');
    expect(waitingLabel(ago(60 * 24), now)).toBe('há 1 dia');
    expect(waitingLabel(ago(60 * 24 * 3 + 5), now)).toBe('há 3 dias');
  });
  it('never shows a negative time when the device clock is behind, and nothing for an invalid date', () => {
    expect(waitingLabel(ago(-5), now)).toBe('agora');
    expect(waitingLabel('not a date', now)).toBe('');
  });
});

describe('queue search and phone display', () => {
  const item = { contactName: 'José da Silva', phone: '+5541999990001', subject: 'Remarcar retorno' };
  it('finds a name without accents or case and a phone by its digits', () => {
    expect(matchesContactSearch(item, 'jose')).toBe(true);
    expect(matchesContactSearch(item, 'SILVA')).toBe(true);
    expect(matchesContactSearch(item, '(41) 99999')).toBe(true);
    expect(matchesContactSearch(item, '0001')).toBe(true);
    expect(matchesContactSearch(item, 'remarcar')).toBe(true);
    expect(matchesContactSearch(item, 'Maria')).toBe(false);
    expect(matchesContactSearch(item, '4888')).toBe(false);
    expect(matchesContactSearch(item, '  ')).toBe(true);
  });
  it('formats Brazilian numbers and leaves anything else as typed', () => {
    expect(displayPhone('+5541999990001')).toBe('(41) 99999-0001');
    expect(displayPhone('554130000000')).toBe('(41) 3000-0000');
    expect(displayPhone('419')).toBe('419');
  });
});
