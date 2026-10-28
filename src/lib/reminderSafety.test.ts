// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { escapeHtml, whatsappPhone } from '../../supabase/functions/_shared/reminders';
describe('reminder content safety', () => {
  it('escapes names and notes without creating active HTML', () => {
    expect(escapeHtml('<a href="https://evil">A&B</a>')).toBe('&lt;a href=&quot;https://evil&quot;&gt;A&amp;B&lt;/a&gt;');
  });
  it.each([['(11) 99999-8888','5511999998888'],['+55 11 99999-8888','5511999998888'],['5511999998888','5511999998888'],['+1 415 555 2671','14155552671']])('normalizes %s without duplicate country code',(input,expected)=>{
    expect(whatsappPhone(input)).toBe(expected);
  });
  it.each(['', '123', '55', '+12345678901234567', 'abc5511999998888'])('rejects invalid phone %s', input=>{
    expect(()=>whatsappPhone(input)).toThrow();
  });
});
