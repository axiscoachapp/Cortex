import { Link } from 'react-router-dom';
import { BrandLockup } from '@/components/BrandLockup';
import { Button } from '@/components/ui/button';

const NotFound = () => {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 md:p-6">
      <section className="w-full max-w-lg rounded-xl border bg-card p-5 text-center space-y-5 md:p-8">
        <BrandLockup compact className="mx-auto w-fit" />
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Erro 404</p>
        <h1 className="text-xl font-semibold tracking-tight">Página não encontrada</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Confira o endereço ou volte ao seu ambiente de trabalho.
        </p>
        <Button asChild>
          <Link to="/">Voltar ao início</Link>
        </Button>
      </section>
    </main>
  );
};

export default NotFound;
