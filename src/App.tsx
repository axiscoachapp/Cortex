import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { Brain } from "lucide-react";

// Critical routes — keep eager.
import Index from "./pages/Index";
import Auth from "./pages/Auth";

// Heavy / rarely visited routes — lazy load.
const About = lazy(() => import("./pages/About"));
const PatientManagement = lazy(() => import("./pages/PatientManagement"));
const CalendarPage = lazy(() => import("./pages/Calendar"));
const GoogleOAuthCallback = lazy(() => import("./pages/GoogleOAuthCallback"));
const DataPrivacy = lazy(() => import("./pages/DataPrivacy"));
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
        style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 40%))' }}
      >
        <Brain className="w-4 h-4 text-white" />
      </div>
      <p className="text-sm text-muted-foreground">Carregando...</p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/sobre" element={<About />} />
              <Route path="/gerenciar-pacientes" element={<PatientManagement />} />
              <Route path="/agenda" element={<CalendarPage />} />
              <Route path="/google-oauth-callback" element={<GoogleOAuthCallback />} />
              <Route path="/privacidade" element={<DataPrivacy />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
