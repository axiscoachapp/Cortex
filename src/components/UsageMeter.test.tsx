import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageMeter } from './UsageMeter';

const usage = vi.hoisted(() => ({ data: null as null | Record<string, unknown> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('@/hooks/useUsage', () => ({ useUsage: () => ({ data: usage.data, isLoading: false, isError: false }) }));
afterEach(cleanup);
const at = (percent: number) => ({
  used: percent * 15,
  limit: 1500,
  percent,
  remaining: 0,
  resetsInHours: 5,
  level: percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'safe',
});

describe('UsageMeter', () => {
  it('stays out of the composer below 80% and shows plain usage from 80%', () => {
    usage.data = at(79);
    const { rerender } = render(<UsageMeter variant="inline" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    usage.data = at(80);
    rerender(<UsageMeter variant="inline" />);
    expect(screen.getByRole('button', { name: 'Uso de IA hoje: 80%' })).toBeInTheDocument();
    expect(screen.queryByText(/1500/)).not.toBeInTheDocument();
  });

  it('is never shown in the patient profile', () => {
    usage.data = at(95);
    render(<UsageMeter variant="pill" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
