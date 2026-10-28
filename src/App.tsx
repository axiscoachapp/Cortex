import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Brain } from "lucide-react";
import { AppErrorBoundary, RecoveryScreen } from '@/components/AppErrorBoundary';
import { UnsavedChangesRouteGuard } from '@/hooks/useUnsavedChanges';
import { SessionAssurance } from '@/components/SessionAssurance';

// Critical routes — keep eager.
const Index = lazy(() => import("./pages/Index"));
import Auth from "./pages/Auth";

// Heavy / rarely visited routes — lazy load.
const About = lazy(() => import("./pages/About"));
const PatientManagement = lazy(() => import("./pages/PatientManagement"));
const CalendarPage = lazy(() => import("./pages/Calendar"));
const GoogleOAuthCallback = lazy(() => import("./pages/GoogleOAuthCallback"));
const DataPrivacy = lazy(() => import("./pages/DataPrivacy"));
const TemplatesPage = lazy(() => import("./pages/Templates"));
const KnowledgeBasePage = lazy(() => import("./pages/KnowledgeBase"));
const AssistantPage = lazy(() => import("./pages/Assistant"));
const SharingPage = lazy(() => import('./pages/Sharing'));
const ClinicalWorkspacePage = lazy(() => import('./pages/ClinicalWorkspace'));
const AccountSecurityPage = lazy(() => import('./pages/AccountSecurity'));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,            // 1 min — keeps panels stable on tab switch
      gcTime: 5 * 60_000,           // 5 min cache after unmount
      refetchOnWindowFocus: false,  // saves Supabase reads
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center animate-pulse"
        style={{ background: 'hsl(var(--primary))' }}
      >
        <Brain className="w-4 h-4 text-white" />
      </div>
      <p className="text-sm text-muted-foreground">Carregando...</p>
    </div>
  </div>
);

function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <RouteFallback />;
  if (!user) return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <><UnsavedChangesRouteGuard />{location.pathname==='/seguranca'?<Outlet key={user.id}/>:<SessionAssurance key={user.id}><Outlet key={user.id}/></SessionAssurance>}</>;
}

const router = createBrowserRouter([
  { errorElement: <RecoveryScreen />, children: [
  { path: '/auth', element: <Auth /> },
  { path: '/sobre', element: <About /> },
  { element: <ProtectedRoute />, children: [
    { path: '/', element: <Index /> },
    { path: '/gerenciar-pacientes', element: <PatientManagement /> },
    { path: '/agenda', element: <CalendarPage /> },
    { path: '/google-oauth-callback', element: <GoogleOAuthCallback /> },
    { path: '/privacidade', element: <DataPrivacy /> },
    { path: '/modelos', element: <TemplatesPage /> },
    { path: '/conhecimento', element: <KnowledgeBasePage /> },
    { path: '/assistente', element: <AssistantPage /> },
    { path: '/compartilhamento', element: <SharingPage /> },
    { path: '/trabalho', element: <ClinicalWorkspacePage /> },
    { path: '/seguranca', element: <AccountSecurityPage /> },
  ] },
  { path: '*', element: <NotFound /> },
  ] },
]);

const App = () => (
  <AppErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
          <Suspense fallback={<RouteFallback />}>
            <RouterProvider router={router} />
          </Suspense>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
