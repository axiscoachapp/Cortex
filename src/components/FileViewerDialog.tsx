import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dialogLayout } from '@/lib/dialogLayout';
import { cn } from '@/lib/utils';

export interface ViewerFile {
  storagePath: string;
  fileName: string;
  mimeType: string | null;
}

interface FileViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: ViewerFile;
}

type View =
  | { status: 'loading' }
  | { status: 'error'; detail?: string }
  | { status: 'image'; url: string }
  | { status: 'pdf'; pdf: PDFDocumentProxy }
  | { status: 'other' };

const BUCKET = 'patient-files';
/** How long the address behind "Abrir em nova aba" works. */
const NEW_TAB_LINK_SECONDS = 60;
/** Pages drawn at first, and added by each "Mostrar mais páginas". */
const PAGE_BATCH = 5;
/** Phones report up to 3: drawing at that density keeps small print readable when the doctor zooms in. */
const MAX_PIXEL_RATIO = 3;
/** About 16 MB of memory per page: the limit that counts on a large, dense screen. */
const MAX_CANVAS_PIXELS = 4_000_000;
/** Used when the page's place on the screen cannot be measured. */
const FALLBACK_PAGE_WIDTH = 800;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
/**
 * Where the app serves pdf.js's decoders for fax (CCITT), JBIG2 and JPEG 2000 images, the formats
 * of most scanned reports: `public/pdfjs/`, copied from `pdfjs-dist/wasm/` (a test keeps the copies
 * equal to the installed version). The pdf.js worker imports them from here the first time a
 * document needs one; without them it leaves those images out and reports no error. They are the
 * JavaScript versions: the site's security policy does not allow WebAssembly. The app is served
 * from the root of its address, so the path is absolute.
 */
const PDF_DECODERS_URL = '/pdfjs/';

function kindOf(mimeType: string | null, fileName: string): 'image' | 'pdf' | 'other' {
  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (IMAGE_TYPES.has(type)) return 'image';
  if (type === 'application/pdf') return 'pdf';
  // A row saved without a usable type: go by the file's extension, as the file list does.
  if (!type || type === 'application/octet-stream') {
    if (/\.pdf$/i.test(fileName)) return 'pdf';
    if (/\.(jpe?g|png|webp|gif)$/i.test(fileName)) return 'image';
  }
  return 'other';
}

/**
 * pdf.js stays out of the main bundle: it is fetched only when a PDF is opened.
 * The "legacy" build is used on purpose. The default build of this version calls functions that
 * only the browsers of 2026 have (`Math.sumPrecise`, `Map.prototype.getOrInsert`,
 * `Uint8Array.prototype.toHex`): on a tablet a year or two behind, every PDF would fail to open.
 * The legacy build carries its own versions of them and asks for the same decoder files.
 */
async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** pdf.js hands the page `null` in place of an image it could not decode, and still reports success. */
function hasMissingImage(page: PDFPageProxy): boolean {
  for (const objects of [page.objs, page.commonObjs])
    for (const [id, data] of objects) if (data === null && String(id).includes('img_')) return true;
  return false;
}

/** Fits the page to the width it has on the screen, sharp on dense displays, within the canvas limit. */
function scaleFor(pageWidth: number, pageHeight: number, cssWidth: number): number {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  let scale = (cssWidth * ratio) / pageWidth;
  const pixels = pageWidth * pageHeight * scale * scale;
  if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
  return scale;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The browser starts reading the address after the click returns: release it later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Shows a patient's attached file inside the app. The bytes come through the Supabase client and
 * are shown from memory (`blob:` image, PDF pages drawn on canvases): the site's security policy
 * allows neither frames nor images from another address.
 */
export function FileViewerDialog({ open, onOpenChange, file }: FileViewerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('h-[90dvh] max-w-4xl', dialogLayout.content)}>
        <DialogHeader className={cn(dialogLayout.header, 'border-b')}>
          <DialogTitle className="break-words text-base leading-snug">{file.fileName}</DialogTitle>
          <DialogDescription className="text-xs">Visualização do arquivo anexado ao prontuário.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while the dialog is open: closing it releases the file from memory. */}
        <FileView key={file.storagePath} file={file} />
      </DialogContent>
    </Dialog>
  );
}

function FileView({ file }: { file: ViewerFile }) {
  const { storagePath, fileName, mimeType } = file;
  const [view, setView] = useState<View>({ status: 'loading' });
  const [blob, setBlob] = useState<Blob | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [newTabFailed, setNewTabFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let imageUrl = '';
    let loadingTask: PDFDocumentLoadingTask | undefined;
    const load = async () => {
      const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
      if (error || !data) throw error ?? new Error('Empty file');
      if (cancelled) return;
      setBlob(data);
      const kind = kindOf(mimeType, fileName);
      if (kind === 'other') {
        setView({ status: 'other' });
        return;
      }
      if (kind === 'image') {
        imageUrl = URL.createObjectURL(data);
        setView({ status: 'image', url: imageUrl });
        return;
      }
      const [bytes, pdfjs] = await Promise.all([
        data.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
        loadPdfJs(),
      ]);
      if (cancelled) return;
      loadingTask = pdfjs.getDocument({ data: bytes, useWasm: false, wasmUrl: PDF_DECODERS_URL, enableXfa: false });
      const pdf = await loadingTask.promise;
      if (!cancelled) setView({ status: 'pdf', pdf });
    };
    load().catch((error) => {
      if (cancelled) return;
      const locked = error instanceof Error && error.name === 'PasswordException';
      setView({
        status: 'error',
        detail: locked
          ? 'Este PDF é protegido por senha. Baixe o arquivo para abri-lo com a senha.'
          : loadingTask
            ? 'O PDF parece estar danificado ou em um formato que não é exibido aqui. Você ainda pode baixar o arquivo.'
            : undefined,
      });
    });
    return () => {
      cancelled = true;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      // Ends the page drawings still running and frees the document in the worker.
      loadingTask?.destroy().catch(() => {});
    };
  }, [storagePath, fileName, mimeType, attempt]);

  const retry = () => {
    setView({ status: 'loading' });
    setBlob(null);
    setAttempt((current) => current + 1);
  };

  const openInNewTab = async () => {
    setNewTabFailed(false);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, NEW_TAB_LINK_SECONDS);
      if (error || !data?.signedUrl) throw error ?? new Error('No address');
      // The opened file must not reach back into the app (window.opener) nor learn its URL (Referer).
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setNewTabFailed(true);
    }
  };

  return (
    <>
      {/* Focusable so the keyboard can scroll a file that has no control inside it. */}
      <div
        role="region"
        aria-label="Conteúdo do arquivo"
        tabIndex={0}
        className={cn(
          dialogLayout.body,
          'bg-muted/40 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        {view.status === 'loading' && (
          <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando o arquivo…
          </p>
        )}
        {view.status === 'error' && (
          <div role="alert" className="mx-auto max-w-md space-y-3 py-10 text-center text-sm">
            <p className="font-medium">Não foi possível abrir o arquivo.</p>
            {view.detail && <p className="text-muted-foreground">{view.detail}</p>}
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Tentar novamente
            </Button>
          </div>
        )}
        {view.status === 'image' && (
          <img
            src={view.url}
            alt={fileName}
            className="mx-auto block h-auto max-w-full bg-white shadow-sm"
            onError={() =>
              setView({
                status: 'error',
                detail:
                  'A imagem parece estar danificada ou em um formato que não é exibido aqui. Você ainda pode baixar o arquivo.',
              })
            }
          />
        )}
        {view.status === 'pdf' && <PdfPages pdf={view.pdf} />}
        {view.status === 'other' && (
          <p className="mx-auto max-w-md py-10 text-center text-sm">
            Este tipo de arquivo não pode ser exibido aqui. Use “Baixar” para abrir no seu dispositivo.
          </p>
        )}
      </div>
      <div className={dialogLayout.footer}>
        {newTabFailed && (
          <p role="alert" className={dialogLayout.error}>
            Não foi possível abrir em nova aba. Tente novamente.
          </p>
        )}
        <div className={dialogLayout.actions}>
          <Button type="button" variant="outline" className={dialogLayout.button} onClick={openInNewTab}>
            <ExternalLink aria-hidden="true" />
            Abrir em nova aba
          </Button>
          <Button
            type="button"
            className={dialogLayout.button}
            disabled={!blob}
            onClick={() => blob && saveBlob(blob, fileName)}
          >
            <Download aria-hidden="true" />
            Baixar
          </Button>
        </div>
      </div>
    </>
  );
}

function PdfPages({ pdf }: { pdf: PDFDocumentProxy }) {
  const total = pdf.numPages;
  const [shown, setShown] = useState(Math.min(PAGE_BATCH, total));
  return (
    <div className="space-y-4">
      {Array.from({ length: shown }, (_, index) => (
        <PdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} total={total} />
      ))}
      {shown < total && (
        <div className="space-y-2 pb-2 text-center">
          <p className="text-xs text-muted-foreground">
            Mostrando {shown} de {total} páginas.
          </p>
          <Button
            type="button"
            variant="outline"
            className={dialogLayout.button}
            onClick={() => setShown((current) => Math.min(current + PAGE_BATCH, total))}
          >
            Mostrar mais páginas
          </Button>
        </div>
      )}
    </div>
  );
}

function PdfPage({ pdf, pageNumber, total }: { pdf: PDFDocumentProxy; pageNumber: number; total: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'drawing' | 'drawn' | 'incomplete' | 'failed'>('drawing');

  useEffect(() => {
    let cancelled = false;
    let page: PDFPageProxy | undefined;
    let task: RenderTask | undefined;
    const draw = async () => {
      page = await pdf.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const natural = page.getViewport({ scale: 1 });
      const cssWidth = canvas.parentElement?.clientWidth || FALLBACK_PAGE_WIDTH;
      const viewport = page.getViewport({ scale: scaleFor(natural.width, natural.height, cssWidth) });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      await task.promise;
      if (cancelled) return;
      setStatus(hasMissingImage(page) ? 'incomplete' : 'drawn');
      // The page is on the canvas: pdf.js can let go of its decoded images.
      page.cleanup();
    };
    draw().catch(() => {
      if (!cancelled) setStatus('failed');
    });
    return () => {
      cancelled = true;
      task?.cancel();
      page?.cleanup();
    };
  }, [pdf, pageNumber]);

  const label = `Página ${pageNumber} de ${total}`;
  return (
    <figure className="space-y-1" aria-busy={status === 'drawing'}>
      <figcaption className="text-center text-xs text-muted-foreground">{label}</figcaption>
      {status === 'failed' && (
        <p role="alert" className={dialogLayout.error}>
          Não foi possível exibir a página {pageNumber} aqui. Baixe o arquivo para ver o documento completo.
        </p>
      )}
      {status === 'incomplete' && (
        <p role="alert" className={dialogLayout.error}>
          Uma imagem da página {pageNumber} não pôde ser exibida aqui. Baixe o arquivo para ver o documento completo.
        </p>
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={cn('h-auto w-full bg-white shadow-sm', status === 'failed' ? 'hidden' : 'block')}
      />
    </figure>
  );
}
