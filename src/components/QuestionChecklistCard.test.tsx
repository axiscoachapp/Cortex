import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionChecklistCard } from './QuestionChecklistCard';

describe('question checklist readability and explicit generation',()=>{
  it('offers explicit generation instead of hiding an empty checklist',()=>{
    const refresh=vi.fn();render(<QuestionChecklistCard questions={[]} isLoading={false} onRefresh={refresh}/>);
    fireEvent.click(screen.getByRole('button',{name:'Gerar roteiro com IA'}));expect(refresh).toHaveBeenCalledOnce();
  });
  it('does not carry checked indexes into a different question set',()=>{
    const props={isLoading:false,onRefresh:vi.fn()};
    const {rerender}=render(<QuestionChecklistCard {...props} questions={['Primeira pergunta','Segunda pergunta']}/>);
    fireEvent.click(screen.getByRole('checkbox',{name:'Primeira pergunta'}));expect(screen.getByText('1/2')).toBeInTheDocument();
    rerender(<QuestionChecklistCard {...props} questions={['Pergunta diferente']}/>);
    expect(screen.getByText('0/1')).toBeInTheDocument();expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it('announces the expanded state and permits label-based checking',()=>{
    render(<QuestionChecklistCard questions={['Uma pergunta que pode ocupar mais de uma linha.']} isLoading={false} onRefresh={vi.fn()}/>);
    const toggle=screen.getByRole('button',{name:/roteiro de perguntas 0\/1/i});expect(toggle).toHaveAttribute('aria-expanded','true');
    fireEvent.click(screen.getByText('Uma pergunta que pode ocupar mais de uma linha.'));expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
