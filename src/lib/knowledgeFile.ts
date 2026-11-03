const MAX_BYTES=10*1024*1024;
const MAX_CHARS=60_000;
type ImportFile=Pick<File,'name'|'size'|'arrayBuffer'|'text'>;

/** Local text extraction only: no upload, model request, HTML or PDF rendering. */
export async function extractKnowledgeFile(file: ImportFile, signal?: AbortSignal): Promise<string> {
  if(!file.size || file.size>MAX_BYTES)throw new Error('Escolha um arquivo de até 10 MB, com conteúdo.');
  signal?.throwIfAborted();
  const pdf=/\.pdf$/i.test(file.name);
  if(!pdf && !/\.(txt|md)$/i.test(file.name))throw new Error('Use PDF com texto selecionável, TXT ou Markdown.');
  const check=(text:string)=>{
    const clean=text.split('\u0000').join('').trim();
    if(clean.length<20)throw new Error('Não foi encontrado texto suficiente. PDFs digitalizados precisam de OCR antes da importação.');
    if(clean.length>MAX_CHARS)throw new Error('O texto excede 60.000 caracteres. Importe uma seção menor; nenhum conteúdo foi truncado.');
    return clean;
  };
  if(!pdf){const text=await file.text();signal?.throwIfAborted();return check(text);}
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('O arquivo não tem uma estrutura PDF válida.');
  const [{getDocument,GlobalWorkerOptions},worker]=await Promise.all([import('pdfjs-dist'),import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  signal?.throwIfAborted();
  GlobalWorkerOptions.workerSrc=worker.default;
  const task=getDocument({data:bytes,disableFontFace:true,useSystemFonts:false,useWasm:false,enableXfa:false,stopAtErrors:true});
  let timer:ReturnType<typeof setTimeout>;
  let abort=()=>{};
  try {
    const cancelled=new Promise<never>((_resolve,reject)=>{
      abort=()=>reject(new Error('Importação cancelada.'));
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>reject(new Error('O PDF demorou demais para ser lido. Use um arquivo menor.')),30_000);
    });
    const extract=async()=>{
      const doc=await task.promise;
      if(doc.numPages>60)throw new Error('O PDF excede 60 páginas. Importe uma seção menor.');
      let text='';
      for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++) {
        signal?.throwIfAborted();
        const page=await doc.getPage(pageNumber);
        const content=await page.getTextContent();
        text+=content.items.map(item=>'str' in item ? item.str+('hasEOL' in item && item.hasEOL?'\n':' ') : '').join('')+'\n\n';
        page.cleanup();
        if(text.length>MAX_CHARS)throw new Error('O texto excede 60.000 caracteres. Importe uma seção menor; nenhum conteúdo foi truncado.');
      }
      return check(text);
    };
    return await Promise.race([extract(),cancelled]);
  } catch(error) {
    if(error instanceof Error && error.name==='PasswordException')throw new Error('O PDF está protegido por senha. Use uma cópia desbloqueada.');
    throw error;
  } finally {
    clearTimeout(timer!);signal?.removeEventListener('abort',abort);
    await task.destroy().catch(()=>{});
  }
}
