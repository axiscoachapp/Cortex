import {render,screen,fireEvent} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {DocumentPreviewModal} from './DocumentPreviewModal';
const writeText=vi.fn();
beforeEach(()=>{writeText.mockReset();Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});});
const setup=()=>render(<DocumentPreviewModal open onClose={vi.fn()} type="patient_summary" content="Texto sintético revisado" isLoading={false} patientName="Paciente sintético"/>);
describe('document preview recovery',()=>{
 it('offers recovery when clipboard access is rejected',async()=>{writeText.mockRejectedValue(new Error('denied'));setup();fireEvent.click(screen.getByRole('button',{name:'Copiar'}));expect(await screen.findByRole('alert')).toHaveTextContent('copie manualmente');expect(screen.getByText('Texto sintético revisado')).toBeInTheDocument();});
 it('explains a blocked print window and keeps the document visible',async()=>{vi.spyOn(window,'open').mockReturnValue(null);setup();fireEvent.click(screen.getByRole('button',{name:'Imprimir / PDF'}));expect(await screen.findByRole('alert')).toHaveTextContent('Permita pop-ups');expect(screen.getByRole('button',{name:'Fechar prévia do documento'})).toBeInTheDocument();});
});
