import { useLocation } from 'react-router-dom';
import { MobileBottomBar } from '@/components/AppNavigation';

/** The phone bar for every route except home, which places the same bar in its own column. */
export function MobileSubpageNavigation() {
  const { pathname } = useLocation();
  if (pathname === '/') return null;
  return <MobileBottomBar />;
}
