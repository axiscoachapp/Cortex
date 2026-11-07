import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LegacyWorkspaceRedirect from './LegacyWorkspaceRedirect';

function Destination() { const location=useLocation(); return <p>{location.pathname+location.search}</p>; }
describe('legacy work links',()=>{
  it.each([
    ['/trabalho','/'],
    ['/trabalho?queue=scheduling','/agenda?queue=scheduling'],
    ['/trabalho?patient=patient-A&new=1&appointment=old&complaint=synthetic','/?patient=patient-A'],
    ['/trabalho?patient=patient-A&queue=scheduling','/?patient=patient-A'],
    ['/trabalho?patient=https%3A%2F%2Fexample.invalid','/?patient=https%3A%2F%2Fexample.invalid'],
  ])('keeps %s local and replaces it with %s',(entry,destination)=>{
    render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/trabalho" element={<LegacyWorkspaceRedirect/>}/><Route path="*" element={<Destination/>}/></Routes></MemoryRouter>);
    expect(screen.getByText(destination)).toBeInTheDocument();
  });
});
