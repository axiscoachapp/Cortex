import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileViewerDialog, type ViewerFile } from './FileViewerDialog';

const mocks = vi.hoisted(() => ({
  bucket: vi.fn(),
  download: vi.fn(),
  sign: vi.fn(),
  getDocument: vi.fn(),
  destroy: vi.fn(),
  workerOptions: { workerSrc: '' },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        mocks.bucket(bucket);
        return { download: mocks.download, createSignedUrl: mocks.sign };
      },
    },
  },
}));
// jsdom draws nothing on a canvas: the PDF library is replaced by a recorder.
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: mocks.workerOptions, getDocument: mocks.getDocument }));

const image: ViewerFile = {
  storagePath: 'patients/doctor/patient/exame.png',
  fileName: 'exame.png',
  mimeType: 'image/png',
};
const pdf: ViewerFile = {
  storagePath: 'patients/doctor/patient/laudo.pdf',
  fileName: 'laudo.pdf',
  mimeType: 'application/pdf',
};
const bytes = (text: string, type: string) => new Blob([text], { type });

/** A stand-in for a pdf.js document: every page is 600 x 800 points. */
function pdfDocument(numPages: number, images: [string, unknown][] = []) {
  const render = vi.fn((_parameters: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => ({
    promise: Promise.resolve(),
    cancel: vi.fn(),
  }));
  const getPage = vi.fn(async (_pageNumber: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render,
    cleanup: vi.fn(),
    objs: images,
    commonObjs: [],
  }));
  return { numPages, getPage, render };
}
const serve = (document: unknown) =>
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: mocks.destroy });

function Viewer({ file }: { file: ViewerFile }) {
  const [open, setOpen] = useState(true);
  return <FileViewerDialog open={open} onOpenChange={setOpen} file={file} />;
}

describe('file viewer', () => {
  let objectUrls = 0;
  const createObjectURL = vi.fn((_blob: Blob) => `blob:cortex/${++objectUrls}`);
  const revokeObjectURL = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    objectUrls = 0;
    mocks.workerOptions.workerSrc = '';
    mocks.destroy.mockResolvedValue(undefined);
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an image from memory, never from the storage address', async () => {
    const file = bytes('synthetic image', 'image/png');
    mocks.download.mockResolvedValue({ data: file, error: null });
    render(<Viewer file={image} />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando o arquivo…');
    const shown = await screen.findByRole('img', { name: 'exame.png' });
    expect(shown).toHaveAttribute('src', 'blob:cortex/1');
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(mocks.bucket).toHaveBeenCalledWith('patient-files');
    expect(mocks.download).toHaveBeenCalledWith('patients/doctor/patient/exame.png');
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.getDocument).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'exame.png' });
    expect(dialog).toHaveAccessibleDescription('Visualização do arquivo anexado ao prontuário.');
    expect(within(dialog).getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('releases the image from memory when the dialog closes', async () => {
    mocks.download.mockResolvedValue({ data: bytes('synthetic image', 'image/png'), error: null });
    render(<Viewer file={image} />);
    await screen.findByRole('img', { name: 'exame.png' });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cortex/1');
  });

  it('draws the first pages of a PDF on canvases and adds more on request', async () => {
    const loaded = pdfDocument(7);
    serve(loaded);
    mocks.download.mockResolvedValue({ data: bytes('%PDF-1.7 synthetic', 'application/pdf'), error: null });
    render(<Viewer file={pdf} />);
    expect(await screen.findByText('Página 1 de 7')).toBeInTheDocument();
    expect(screen.getByText('Página 5 de 7')).toBeInTheDocument();
    expect(screen.queryByText('Página 6 de 7')).not.toBeInTheDocument();
    expect(screen.getByText('Mostrando 5 de 7 páginas.')).toBeInTheDocument();
    await waitFor(() => expect(loaded.render).toHaveBeenCalledTimes(5));
    // The bytes go to pdf.js as data (no address), with WebAssembly off and the scan decoders the app
    // serves itself (public/pdfjs/), and the worker is the bundled one.
    const options = mocks.getDocument.mock.calls[0][0];
    expect(new TextDecoder().decode(options.data)).toBe('%PDF-1.7 synthetic');
    expect(options).toMatchObject({ useWasm: false, wasmUrl: '/pdfjs/', enableXfa: false });
    expect(options.url).toBeUndefined();
    expect(mocks.workerOptions.workerSrc).toMatch(/pdf\.worker/);
    // Each page is drawn on its own canvas, sized from the page's proportions.
    const first = loaded.render.mock.calls[0][0];
    expect(first.canvas).toBe(screen.getByRole('img', { name: 'Página 1 de 7' }));
    expect(first.canvas.width / first.canvas.height).toBeCloseTo(600 / 800, 2);
    expect(first.canvas.width * first.canvas.height).toBeLessThanOrEqual(4_000_000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar mais páginas' }));
    expect(await screen.findByText('Página 7 de 7')).toBeInTheDocument();
    await waitFor(() => expect(loaded.render).toHaveBeenCalledTimes(7));
    expect(loaded.getPage.mock.calls.map(([pageNumber]) => pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(screen.queryByRole('button', { name: 'Mostrar mais páginas' })).not.toBeInTheDocument();
  });

  it('frees the PDF document when the dialog closes', async () => {
    serve(pdfDocument(1));
    mocks.download.mockResolvedValue({ data: bytes('%PDF-1.7 synthetic', 'application/pdf'), error: null });
    render(<Viewer file={pdf} />);
    await screen.findByText('Página 1 de 1');
    expect(mocks.destroy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  });

  it('treats a PDF that pdf.js cannot read as an error, and still lets the doctor download it', async () => {
    mocks.getDocument.mockImplementation(() => ({
      promise: Promise.reject(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' })),
      destroy: mocks.destroy,
    }));
    mocks.download.mockResolvedValue({ data: bytes('not a pdf', 'application/pdf'), error: null });
    render(<Viewer file={pdf} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível abrir o arquivo.');
    expect(alert).toHaveTextContent('O PDF parece estar danificado');
    expect(within(alert).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeEnabled();
  });

  it('says that a password-protected PDF must be downloaded', async () => {
    mocks.getDocument.mockImplementation(() => ({
      promise: Promise.reject(Object.assign(new Error('No password given'), { name: 'PasswordException' })),
      destroy: mocks.destroy,
    }));
    mocks.download.mockResolvedValue({ data: bytes('%PDF-1.7 locked', 'application/pdf'), error: null });
    render(<Viewer file={pdf} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Este PDF é protegido por senha.');
  });

  it('warns instead of showing a blank page when pdf.js could not decode an image of the page', async () => {
    serve(pdfDocument(1, [['img_p0_1', null]]));
    mocks.download.mockResolvedValue({ data: bytes('%PDF-1.7 synthetic', 'application/pdf'), error: null });
    render(<Viewer file={pdf} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Uma imagem da página 1 não pôde ser exibida aqui. Baixe o arquivo para ver o documento completo.',
    );
  });

  it('says nothing about a scanned PDF whose images were all decoded', async () => {
    serve(pdfDocument(1, [['img_p0_1', { width: 8, height: 8 }]]));
    mocks.download.mockResolvedValue({
      data: bytes('%PDF-1.7 << /Subtype /Image /Filter /CCITTFaxDecode >>', 'application/pdf'),
      error: null,
    });
    render(<Viewer file={pdf} />);
    const page = (await screen.findByText('Página 1 de 1')).closest('figure');
    await waitFor(() => expect(page).toHaveAttribute('aria-busy', 'false'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when one page cannot be drawn, without losing the others', async () => {
    const loaded = pdfDocument(2);
    loaded.render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('bad page')), cancel: vi.fn() }));
    serve(loaded);
    mocks.download.mockResolvedValue({ data: bytes('%PDF-1.7 synthetic', 'application/pdf'), error: null });
    render(<Viewer file={pdf} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível exibir a página 1 aqui.');
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    await waitFor(() => expect(loaded.render).toHaveBeenCalledTimes(2));
    // The canvas of the page that failed is hidden (no half-drawn sheet); the other stays.
    expect(screen.getByRole('img', { name: 'Página 1 de 2' })).toHaveClass('hidden');
    expect(screen.getByRole('img', { name: 'Página 2 de 2' })).not.toHaveClass('hidden');
  });

  it('explains a type it cannot show and saves the file under its own name', async () => {
    const file = bytes('synthetic heic', 'image/heic');
    mocks.download.mockResolvedValue({ data: file, error: null });
    // jsdom cannot save a file: record the link the viewer clicks.
    const saved: { name: string; address: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, address: this.href });
    });
    render(
      <Viewer
        file={{ storagePath: 'patients/doctor/patient/foto.heic', fileName: 'foto.heic', mimeType: 'image/heic' }}
      />,
    );
    expect(await screen.findByText(/Este tipo de arquivo não pode ser exibido aqui\./)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(mocks.getDocument).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar' }));
    // The bytes already downloaded are saved, under the file's own name; nothing is left on the page.
    expect(saved).toEqual([{ name: 'foto.heic', address: 'blob:cortex/1' }]);
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('goes by the extension when the file was saved without a type', async () => {
    mocks.download.mockResolvedValue({ data: bytes('synthetic image', ''), error: null });
    render(
      <Viewer file={{ storagePath: 'patients/doctor/patient/raio-x.JPG', fileName: 'raio-x.JPG', mimeType: null }} />,
    );
    expect(await screen.findByRole('img', { name: 'raio-x.JPG' })).toHaveAttribute('src', 'blob:cortex/1');
  });

  it('reports a failed download and loads the file again on request', async () => {
    mocks.download
      .mockResolvedValueOnce({ data: null, error: new Error('offline') })
      .mockResolvedValueOnce({ data: bytes('synthetic image', 'image/png'), error: null });
    render(<Viewer file={image} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível abrir o arquivo.');
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeDisabled();
    await userEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('img', { name: 'exame.png' })).toBeInTheDocument();
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens a new tab with a one-minute address that cannot reach back into the app', async () => {
    mocks.download.mockResolvedValue({ data: bytes('synthetic image', 'image/png'), error: null });
    mocks.sign
      .mockResolvedValueOnce({ data: { signedUrl: 'https://storage.invalid/signed' }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Viewer file={image} />);
    await screen.findByRole('img', { name: 'exame.png' });
    await userEvent.click(screen.getByRole('button', { name: 'Abrir em nova aba' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://storage.invalid/signed', '_blank', 'noopener,noreferrer'),
    );
    expect(mocks.sign).toHaveBeenCalledWith('patients/doctor/patient/exame.png', 60);
    // With noopener the browser returns no window handle: that is not an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir em nova aba' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir em nova aba.');
    expect(open).toHaveBeenCalledOnce();
  });
});
