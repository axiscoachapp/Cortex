// Settings → WhatsApp: helpers and the automation editor. Synthetic data only; the API is mocked.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationEditor } from './AutomationEditor';
import { describeWhen, previewBody, type WhatsAppTemplate } from './whatsappApi';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

const template: WhatsAppTemplate = {
  name: 'lembrete_consulta', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED',
  body: 'Olá {{1}}, sua consulta é {{2}}. Antes, acesse {{3}}.', paramCount: 3,
};

describe('whatsapp settings helpers', () => {
  it('describes when an automation runs', () => {
    expect(describeWhen('before_start', 2880)).toBe('48 h antes da consulta');
    expect(describeWhen('before_start', 4320)).toBe('3 dias antes da consulta');
    expect(describeWhen('after_end', 120)).toBe('2 h depois da consulta');
    expect(describeWhen('after_end', 30)).toBe('30 min depois da consulta');
    expect(describeWhen('before_start', 0)).toBe('no início da consulta');
  });

  it('previews the message with sample values, fixed text and the rule link', () => {
    expect(previewBody(template, [{ source: 'paciente_primeiro_nome' }, { source: 'data' }, { source: 'link' }], 'https://forms.example/pre'))
      .toBe('Olá Maria, sua consulta é 10/12. Antes, acesse https://forms.example/pre.');
    expect(previewBody(template, [{ source: 'texto', text: 'Ana' }], null)).toBe('Olá Ana, sua consulta é {{2}}. Antes, acesse {{3}}.');
  });
});

describe('automation editor', () => {
  const setup = (onSave = vi.fn()) => {
    render(
      <AutomationEditor open onOpenChange={() => {}} templates={[template, { ...template, name: 'em_analise', status: 'PENDING' }]}
        doctors={[{ id: '11111111-1111-4111-8111-111111111111', name: 'Dra. Ana Exemplo' }]} initial={null}
        preset={{ name: 'Link de pré-consulta', trigger: 'before_start', offsetMinutes: 4320 }} saving={false} error="" onSave={onSave} />,
    );
    return onSave;
  };

  it('starts from the preset and refuses to save without a template', async () => {
    const onSave = setup();
    expect(screen.getByLabelText('Nome')).toHaveValue('Link de pré-consulta');
    expect(screen.getByLabelText('Quantidade')).toHaveValue(3);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Salvar automação' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha o modelo de mensagem.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lists only approved templates', async () => {
    // Radix Select needs pointer capture and scrolling, which jsdom lacks.
    Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, releasePointerCapture: () => {}, scrollIntoView: () => {} });
    setup();
    await userEvent.setup().click(screen.getByLabelText('Modelo de mensagem'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Lembrete consulta · Português · Aviso']);
  });
});
