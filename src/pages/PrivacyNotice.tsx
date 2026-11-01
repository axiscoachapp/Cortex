import { Link } from 'react-router-dom';
import { BrandLockup } from '@/components/BrandLockup';
import { PRIVACY_CONTROLLER } from '@/config/privacy';

const orPending = (value: string) => value.trim() || 'a definir';

/** Public privacy notice (LGPD art. 9): who processes which data, why, where and for how long. */
export default function PrivacyNotice() {
  const c = PRIVACY_CONTROLLER;
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6 sm:p-10 space-y-6 text-sm leading-relaxed">
        <BrandLockup />
        <h1 className="font-serif text-3xl">Aviso de privacidade</h1>
        <p className="text-muted-foreground">Última revisão: {c.reviewedAt}</p>

        <section className="space-y-2">
          <h2 className="font-semibold text-base">Quem trata os dados</h2>
          <p>
            Controlador: <strong>{c.name}</strong> (CNPJ {orPending(c.cnpj)}). Cada médico é responsável pelos
            prontuários dos seus pacientes. Encarregado de proteção de dados: {orPending(c.dpoName)} —{' '}
            {c.dpoEmail.trim() ? <a href={`mailto:${c.dpoEmail}`}>{c.dpoEmail}</a> : 'contato a definir'}.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-base">Quais dados e para quê</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Dados de identificação e contato do paciente, e dados de saúde do prontuário (consultas, exames,
              prescrições, arquivos e, quando consentido, o áudio da consulta), para a prestação do cuidado em saúde.
            </li>
            <li>Agenda e lembretes de consulta, para organizar o atendimento.</li>
            <li>Dados de acesso dos médicos (e-mail, registros de uso), para segurança e auditoria.</li>
          </ul>
          <p>
            Base legal: tutela da saúde, em procedimento realizado por profissionais de saúde (LGPD art. 11, II, f), e
            cumprimento de obrigação legal de guarda do prontuário (art. 11, II, a). A gravação de áudio só ocorre com
            o consentimento do paciente, registrado pelo médico em cada consulta.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-base">Com quem os dados são compartilhados</h2>
          <p>Operadores que processam dados em nome da clínica, sob contrato:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Supabase — banco de dados, autenticação e armazenamento de arquivos.</li>
            <li>Vercel — hospedagem da aplicação web.</li>
            <li>
              Google (Gemini) — transcrição e geração de rascunhos por inteligência artificial, sempre revisados pelo
              médico antes de entrar no prontuário. Pode envolver transferência internacional de dados (LGPD art. 33).
            </li>
            <li>Google Agenda — somente se o médico conectar sua agenda (sem observações clínicas).</li>
          </ul>
          <p>Prontuários só são compartilhados entre médicos por decisão explícita do médico responsável.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-base">Por quanto tempo</h2>
          <p>
            Prontuários são guardados por no mínimo 20 anos a partir do último registro (Lei 13.787/2018; CFM
            1.821/2007). Áudios de consulta são apagados após o registro da evolução revisada.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-base">Seus direitos</h2>
          <p>
            O paciente pode solicitar confirmação de tratamento, acesso e cópia do prontuário, correção de dados,
            informação sobre compartilhamentos e demais direitos do art. 18 da LGPD, pelo contato do encarregado acima
            ou diretamente com o médico. A eliminação de dados de prontuário é limitada pela obrigação legal de
            guarda.
          </p>
        </section>

        <Link to="/auth" className="inline-block text-primary underline underline-offset-4">
          Voltar
        </Link>
      </div>
    </main>
  );
}
