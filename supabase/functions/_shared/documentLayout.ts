/** Wrap using font metrics, including a single word wider than the page. */
export function wrapMeasuredText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line && measure(`${line} ${word}`) > width) { lines.push(line); line = ''; }
      if (measure(word) <= width) line = line ? `${line} ${word}` : word;
      else {
        for (const char of word) {
          if (line && measure(line + char) > width) { lines.push(line); line = ''; }
          line += char;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

interface FontMetrics { widthOfTextAtSize(text: string, size: number): number }
interface TextOptions<Color> { x?: number; size?: number; bold?: boolean; color?: Color }

/** The same writer lays out both production PDFs and deterministic regressions. */
export function createPaginatedWriter<Page, Font extends FontMetrics, Color>(config: {
  page: Page; width: number; top: number; bottom: number; margin: number;
  regular: Font; bold: Font; ink: Color; continuation: string;
  addPage: () => Page;
  draw: (page: Page, text: string, options: { x: number; y: number; size: number; font: Font; color: Color }) => void;
}) {
  let page = config.page;
  let y = config.top;
  let body = true;
  return {
    get page() { return page; }, get y() { return y; },
    down(amount: number) { y -= amount; },
    footer(footerPage: Page, top: number) { body = false; page = footerPage; y = top; },
    text(value: string, options: TextOptions<Color> = {}) {
      const font = options.bold ? config.bold : config.regular;
      const size = options.size ?? 10.5;
      const x = options.x ?? config.margin;
      const lines = wrapMeasuredText(value, config.width - config.margin - x, text => font.widthOfTextAtSize(text, size));
      lines.forEach((line, index) => {
        if (index) y -= size + 4;
        if (body && y < config.bottom) {
          page = config.addPage(); y = config.top;
          const heading = wrapMeasuredText(config.continuation, config.width - 2 * config.margin, text => config.bold.widthOfTextAtSize(text, 10));
          for (const title of heading) {
            config.draw(page, title, { x: config.margin, y, size: 10, font: config.bold, color: config.ink }); y -= 14;
          }
          y -= 16;
        }
        config.draw(page, line, { x, y, size, font, color: options.color ?? config.ink });
      });
    },
  };
}

export function validateDocumentCounts(type: string, medicationCount: number, examCount: number): void {
  if (type.startsWith('receita') && medicationCount > 15) throw new Error('Selecione no máximo 15 medicamentos por documento. Nenhum item foi omitido.');
  if (type === 'solicitacao_exames' && examCount > 20) throw new Error('Selecione no máximo 20 exames por documento. Nenhum item foi omitido.');
}
