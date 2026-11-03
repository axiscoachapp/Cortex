import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractKnowledgeFile } from './knowledgeFile';
const mock=vi.hoisted(()=>({pages:1,text:'Texto sintético selecionável para revisão do médico.',destroy:vi.fn(),getDocument:vi.fn()}));
vi.mock('pdfjs-dist',()=>({GlobalWorkerOptions:{workerSrc:''},getDocument:mock.getDocument}));
beforeEach(()=>{
  vi.clearAllMocks();mock.pages=1;mock.destroy.mockResolvedValue(undefined);
  mock.getDocument.mockImplementation(()=>({promise:Promise.resolve({numPages:mock.pages,getPage:async()=>({getTextContent:async()=>({items:[{str:mock.text,hasEOL:true}]}),cleanup:vi.fn()})}),destroy:mock.destroy}));
});
const file=(name='protocol.pdf',size=100)=>({name,size,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nsynthetic fixture').buffer,text:async()=>mock.text});
describe('local knowledge file import',()=>{
  it('extracts text locally and destroys the PDF worker after review preparation',async()=>{
    expect(await extractKnowledgeFile(file())).toBe(mock.text);
    expect(mock.getDocument).toHaveBeenCalledWith(expect.objectContaining({disableFontFace:true,enableXfa:false,stopAtErrors:true}));
    expect(mock.destroy).toHaveBeenCalledOnce();
  });
  it('accepts TXT without loading the PDF parser',async()=>{
    expect(await extractKnowledgeFile(file('protocol.txt'))).toBe(mock.text);
    expect(mock.getDocument).not.toHaveBeenCalled();
  });
  it('rejects invalid type, excessive bytes and pages without silently truncating',async()=>{
    await expect(extractKnowledgeFile(file('script.html'))).rejects.toThrow('Use PDF');
    await expect(extractKnowledgeFile(file('large.pdf',11*1024*1024))).rejects.toThrow('10 MB');
    mock.pages=61;await expect(extractKnowledgeFile(file())).rejects.toThrow('60 páginas');
    expect(mock.destroy).toHaveBeenCalledOnce();
  });
  it('requires text/OCR and preserves explicit cancellation',async()=>{
    const controller=new AbortController();controller.abort();
    await expect(extractKnowledgeFile(file(),controller.signal)).rejects.toThrow();
    mock.pages=0;await expect(extractKnowledgeFile(file())).rejects.toThrow('OCR');
  });
});
