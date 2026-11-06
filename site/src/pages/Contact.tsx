import type { ReactNode } from 'react';
import { CircleAlert, Mail, MessageCircle } from 'lucide-react';
import { formatPhone, hasContactChannel, siteConfig } from '../config';
import { PageHero } from '../components/sections';
import { Container, Icon, cx } from '../components/ui';

function Field({
  id,
  label,
  optional = false,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} data-field={id}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional ? <span className="font-semibold text-muted"> (opcional)</span> : null}
      </label>
      {hint ? (
        <p id={`${id}-dica`} className="mt-0.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {children}
      <p id={`${id}-erro`} className="field-error" hidden data-error-for={id}>
        <Icon icon={CircleAlert} size={16} className="mt-0.5 shrink-0" />
        <span data-error-text="" />
      </p>
    </div>
  );
}

export function Contact() {
  const { salesEmail, salesWhatsapp } = siteConfig;
  const enabled = hasContactChannel();
  const waGreeting = encodeURIComponent('Olá! Quero saber mais sobre o Cortex.');

  return (
    <>
      <PageHero
        eyebrow="Contato"
        title="Agende uma demonstração"
        lead="Conte um pouco sobre a sua clínica. Mostramos o Cortex com dados fictícios e conversamos sobre a migração do seu sistema atual."
      />

      <section aria-label="Formulário e canais de contato" className="py-14 md:py-20">
        <Container className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
          {/* Form */}
          <div className="lg:col-span-7">
            <div className="card p-6 shadow-card sm:p-8">
              <h2 className="text-2xl">Seus dados</h2>
              <p className="mt-1.5 text-sm text-muted">Todos os campos são obrigatórios, exceto os marcados como opcionais.</p>

              <div
                data-error-summary=""
                hidden
                tabIndex={-1}
                role="alert"
                aria-labelledby="resumo-erros-titulo"
                className="mt-6 rounded-card border border-danger/40 bg-[#fdf3f2] p-4"
              >
                <p id="resumo-erros-titulo" className="flex items-center gap-2 font-bold text-danger">
                  <Icon icon={CircleAlert} size={18} /> Confira os campos abaixo
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-danger" data-error-list="" />
              </div>

              <form
                id="form-contato"
                method="post"
                action="/contato"
                noValidate
                className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2"
                data-contact-form=""
                data-email={salesEmail}
                data-whatsapp={salesWhatsapp}
              >
                <Field id="nome" label="Seu nome">
                  <input id="nome" name="nome" type="text" autoComplete="name" required maxLength={120} className="field-input" />
                </Field>
                <Field id="clinica" label="Clínica">
                  <input
                    id="clinica"
                    name="clinica"
                    type="text"
                    autoComplete="organization"
                    required
                    maxLength={120}
                    className="field-input"
                  />
                </Field>
                <Field id="cidade" label="Cidade/UF" hint="Ex.: Campinas/SP">
                  <input
                    id="cidade"
                    name="cidade"
                    type="text"
                    autoComplete="address-level2"
                    required
                    maxLength={80}
                    aria-describedby="cidade-dica"
                    className="field-input"
                  />
                </Field>
                <Field id="medicos" label="Número de médicos" hint="Quantos atendem na clínica">
                  <select id="medicos" name="medicos" required aria-describedby="medicos-dica" className="field-input" defaultValue="">
                    <option value="" disabled>
                      Selecione
                    </option>
                    <option value="1 médico">1 médico</option>
                    <option value="2 a 5 médicos">2 a 5 médicos</option>
                    <option value="6 a 10 médicos">6 a 10 médicos</option>
                    <option value="11 a 20 médicos">11 a 20 médicos</option>
                    <option value="Mais de 20 médicos">Mais de 20 médicos</option>
                  </select>
                </Field>
                <Field id="sistema" label="Sistema atual" optional className="sm:col-span-2">
                  <input
                    id="sistema"
                    name="sistema"
                    type="text"
                    maxLength={120}
                    placeholder="Ex.: PersonalMed, planilhas, papel"
                    className="field-input"
                  />
                </Field>
                <Field id="telefone" label="Telefone ou WhatsApp" hint="Com DDD">
                  <input
                    id="telefone"
                    name="telefone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    maxLength={20}
                    aria-describedby="telefone-dica"
                    className="field-input"
                  />
                </Field>
                <Field id="email" label="E-mail" hint="Para enviarmos a proposta">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={160}
                    aria-describedby="email-dica"
                    className="field-input"
                  />
                </Field>
                <Field id="mensagem" label="Mensagem" optional className="sm:col-span-2">
                  <textarea
                    id="mensagem"
                    name="mensagem"
                    rows={4}
                    maxLength={1000}
                    placeholder="O que você gostaria de ver na demonstração?"
                    className="field-input min-h-[120px] resize-y"
                  />
                </Field>

                <div className="sm:col-span-2">
                  <button type="submit" className="btn-primary w-full sm:w-auto" disabled data-submit="" data-enabled={enabled ? 'true' : 'false'}>
                    Pedir demonstração
                  </button>
                  {enabled ? (
                    <noscript>
                      <p className="mt-3 text-sm text-muted">
                        O formulário precisa de JavaScript. Use os contatos diretos ao lado.
                      </p>
                    </noscript>
                  ) : (
                    <p className="mt-3 rounded-[10px] bg-bg px-3.5 py-2.5 text-sm text-muted ring-1 ring-inset ring-line">
                      O canal de contato ainda não foi configurado. Em breve você poderá pedir uma demonstração por aqui.
                    </p>
                  )}
                  <p className="mt-4 text-sm text-muted">
                    Nada é enviado por este site: o botão abre o seu e-mail ou o WhatsApp com a mensagem pronta, e usamos os
                    dados só para responder. Veja a <a href="/privacidade">política de privacidade</a>.
                  </p>
                </div>
              </form>

              <div
                data-result=""
                hidden
                tabIndex={-1}
                role="status"
                className="mt-6 rounded-card border border-teal-700/30 bg-teal-50 p-5"
              >
                <p className="text-lg font-bold text-teal-800" data-result-title="">
                  Mensagem pronta
                </p>
                <p className="mt-1.5 text-ink/85" data-result-text="" />
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <a href="/contato" className="btn-primary" hidden data-result-email="">
                    <Icon icon={Mail} size={18} />
                    Abrir e-mail
                  </a>
                  <a href="/contato" className="btn-secondary" hidden data-result-whatsapp="" target="_blank" rel="noopener noreferrer">
                    <Icon icon={MessageCircle} size={18} />
                    Falar pelo WhatsApp
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Side */}
          <aside className="space-y-6 lg:col-span-5" aria-label="Como funciona e contatos diretos">
            <div className="card p-6 sm:p-8">
              <h2 className="text-2xl">O que acontece depois</h2>
              <ol className="mt-5 space-y-5">
                {[
                  { t: 'Respondemos', d: 'Pelo canal que você usou, para combinar o melhor horário.' },
                  { t: 'Demonstração', d: 'Mostramos o Cortex num ambiente com dados fictícios, nenhum dado real de paciente.' },
                  { t: 'Diagnóstico e proposta', d: 'Se fizer sentido, levantamos a rotina da clínica e enviamos a proposta.' },
                ].map((s, i) => (
                  <li key={s.t} className="flex gap-4">
                    <span className="tabular inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-extrabold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-bold">{s.t}</p>
                      <p className="text-muted">{s.d}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div id="canais" className={cx('card p-6 sm:p-8', enabled && 'on-ink border-ink bg-ink')}>
              <h2 className={cx('text-2xl', enabled && 'text-white')}>Contato direto</h2>
              {enabled ? (
                <ul className="mt-5 space-y-3">
                  {salesEmail ? (
                    <li>
                      <a
                        href={`mailto:${salesEmail}`}
                        className="flex items-center gap-3 rounded-[10px] bg-white/[0.06] px-4 py-3 text-white no-underline ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <Icon icon={Mail} size={20} className="shrink-0 text-teal-300" />
                        <span className="min-w-0">
                          <span className="block text-sm text-muted-ink">E-mail</span>
                          <span className="block break-all font-bold">{salesEmail}</span>
                        </span>
                      </a>
                    </li>
                  ) : null}
                  {salesWhatsapp ? (
                    <li>
                      <a
                        href={`https://wa.me/${salesWhatsapp}?text=${waGreeting}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-[10px] bg-white/[0.06] px-4 py-3 text-white no-underline ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <Icon icon={MessageCircle} size={20} className="shrink-0 text-teal-300" />
                        <span className="min-w-0">
                          <span className="block text-sm text-muted-ink">WhatsApp (abre em nova aba)</span>
                          <span className="tabular block font-bold">{formatPhone(salesWhatsapp)}</span>
                        </span>
                      </a>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="mt-3 text-muted">Os canais de contato direto ainda não foram configurados.</p>
              )}
            </div>
          </aside>
        </Container>
      </section>
    </>
  );
}
