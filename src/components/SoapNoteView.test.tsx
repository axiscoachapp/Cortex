import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoapNoteView } from '@/components/SoapNoteView';
import { printDossier, printSoap } from '@/lib/printDoc';

const canonical =
  '**S (Subjetivo):** Dor pélvica há 3 dias.\n**O (Objetivo):** PA 120x80.\n**A (Avaliação):** Dismenorreia.\n**P (Plano):** Ibuprofeno 600 mg.';
const variant =
  'Consulta de retorno.\n\n**S (Subjetivo)**: Dor pélvica há 3 dias.\n**Alergias:** dipirona (relatada hoje).\n\n**O (Objetivo)**: PA 120x80.\n\n**A (Avaliação)**: Dismenorreia.\n\n**P (Plano)**: Ibuprofeno 600 mg.\n**Atenção:** suspender se dor epigástrica.\n**Retorno:** 30 dias.';

function capturePrint() {
  const printed: string[] = [];
  const RealBlob = Blob;
  vi.stubGlobal(
    'Blob',
    class extends RealBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        printed.push(String(parts[0]));
      }
    },
  );
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window, 'open').mockReturnValue({ addEventListener: vi.fn() } as unknown as Window);
  return printed;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SoapNoteView', () => {
  it('shows the prompt format as sections', () => {
    const { container } = render(<SoapNoteView text={canonical} />);
    expect(container.querySelector('.bg-blue-50')).not.toBeNull();
    expect(container.textContent).toContain('S (Subjetivo)');
    expect(container.textContent).toContain('Ibuprofeno 600 mg.');
    expect(container.textContent).not.toContain('**');
  });

  it('keeps every line outside S/O/A/P on screen, in order', () => {
    const { container } = render(<SoapNoteView text={variant} />);
    expect(container.querySelector('.bg-blue-50')).not.toBeNull();
    const shown = container.textContent ?? '';
    const order = ['Consulta de retorno', 'Dor pélvica', 'dipirona', 'PA 120x80', 'Dismenorreia', 'Ibuprofeno', 'suspender se dor', '30 dias'];
    order.forEach((piece) => expect(shown).toContain(piece));
    const positions = order.map((piece) => shown.indexOf(piece));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('printSoap', () => {
  it('prints every line of a note with text outside the sections', () => {
    const printed = capturePrint();
    printSoap(variant, { name: 'Paciente', age: 30 });
    const html = printed[0];
    ['Consulta de retorno', 'Dor pélvica', 'dipirona', 'suspender se dor', '30 dias'].forEach((piece) =>
      expect(html).toContain(piece),
    );
  });

  it('prints the prompt format as sections without literal markdown', () => {
    const printed = capturePrint();
    printSoap(canonical, { name: 'Paciente', age: 30 });
    expect(printed[0]).toContain('S (Subjetivo)');
    expect(printed[0]).not.toContain('**');
    printSoap('Texto **livre** sem seções', { name: 'Paciente', age: 30 });
    expect(printed[1]).toContain('<strong>livre</strong>');
    expect(printed[1]).not.toContain('**');
  });

  it('prints the clinic name from the caller and a neutral footer without one', () => {
    const printed = capturePrint();
    printSoap(canonical, { name: 'Paciente', age: 30 }, undefined, { author: { clinicName: 'Clínica Exemplo' } });
    printSoap(canonical, { name: 'Paciente', age: 30 });
    printDossier({ name: 'Paciente', age: 30 }, [{ created_at: '2026-11-01T12:00:00Z', chief_complaint: null, soap_note: canonical }]);
    expect(printed[0]).toContain('Clínica Exemplo · Cortex');
    expect(printed.join('')).not.toContain('Haddad Nicola');
    expect(printed[2]).not.toContain('**');
  });
});
