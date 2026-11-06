// Contact form: client-side validation with accessible errors. Nothing is sent
// to a server: a valid form opens the visitor's e-mail app (mailto:) with the
// message ready and offers a WhatsApp link (wa.me) with a short summary.

type Values = Record<'nome' | 'clinica' | 'cidade' | 'medicos' | 'sistema' | 'telefone' | 'email' | 'mensagem', string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const messages: Partial<Record<keyof Values, (v: string) => string | null>> = {
  nome: (v) => (v.length < 2 ? 'Informe seu nome.' : null),
  clinica: (v) => (v.length < 2 ? 'Informe o nome da clínica.' : null),
  cidade: (v) => (v.length < 2 ? 'Informe a cidade e o estado, por exemplo Campinas/SP.' : null),
  medicos: (v) => (!v ? 'Escolha o número de médicos.' : null),
  telefone: (v) => {
    const digits = v.replace(/\D/g, '');
    if (!digits) return 'Informe um telefone ou WhatsApp com DDD.';
    return digits.length < 10 || digits.length > 13 ? 'Confira o telefone: use o DDD e o número, por exemplo (11) 91234-5678.' : null;
  },
  email: (v) => (!v ? 'Informe seu e-mail.' : EMAIL_RE.test(v) ? null : 'Confira o e-mail, por exemplo nome@clinica.com.br.'),
};

const labels: Record<keyof Values, string> = {
  nome: 'Seu nome',
  clinica: 'Clínica',
  cidade: 'Cidade/UF',
  medicos: 'Número de médicos',
  sistema: 'Sistema atual',
  telefone: 'Telefone ou WhatsApp',
  email: 'E-mail',
  mensagem: 'Mensagem',
};

function readValues(form: HTMLFormElement): Values {
  const data = new FormData(form);
  const get = (k: keyof Values) => String(data.get(k) ?? '').trim();
  return {
    nome: get('nome'),
    clinica: get('clinica'),
    cidade: get('cidade'),
    medicos: get('medicos'),
    sistema: get('sistema'),
    telefone: get('telefone'),
    email: get('email'),
    mensagem: get('mensagem'),
  };
}

function setFieldError(form: HTMLFormElement, name: keyof Values, message: string | null): void {
  const input = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  const box = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
  if (!input || !box) return;
  const errorId = box.id;
  const described = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== errorId);
  if (message) {
    box.querySelector<HTMLElement>('[data-error-text]')!.textContent = message;
    box.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    described.push(errorId);
  } else {
    box.hidden = true;
    input.removeAttribute('aria-invalid');
  }
  if (described.length) input.setAttribute('aria-describedby', described.join(' '));
  else input.removeAttribute('aria-describedby');
}

function validate(form: HTMLFormElement, values: Values): Array<[keyof Values, string]> {
  const errors: Array<[keyof Values, string]> = [];
  (Object.keys(labels) as Array<keyof Values>).forEach((name) => {
    const check = messages[name];
    const message = check ? check(values[name]) : null;
    setFieldError(form, name, message);
    if (message) errors.push([name, message]);
  });
  return errors;
}

function buildBody(v: Values): string {
  const lines = [
    'Pedido de demonstração do Cortex',
    '',
    `Nome: ${v.nome}`,
    `Clínica: ${v.clinica}`,
    `Cidade/UF: ${v.cidade}`,
    `Número de médicos: ${v.medicos}`,
    `Sistema atual: ${v.sistema || 'não informado'}`,
    `Telefone/WhatsApp: ${v.telefone}`,
    `E-mail: ${v.email}`,
  ];
  if (v.mensagem) lines.push('', 'Mensagem:', v.mensagem);
  return lines.join('\n');
}

function buildWhatsappText(v: Values): string {
  const parts = [
    'Olá! Quero agendar uma demonstração do Cortex.',
    `Sou ${v.nome}, da ${v.clinica} (${v.cidade}).`,
    `Médicos: ${v.medicos}.`,
  ];
  if (v.sistema) parts.push(`Sistema atual: ${v.sistema}.`);
  parts.push(`E-mail: ${v.email}.`);
  return parts.join(' ');
}

export function initContactForm(): void {
  const form = document.querySelector<HTMLFormElement>('[data-contact-form]');
  if (!form) return;

  const salesEmail = form.dataset.email ?? '';
  const salesWhatsapp = (form.dataset.whatsapp ?? '').replace(/\D/g, '');
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]');
  const summary = document.querySelector<HTMLElement>('[data-error-summary]');
  const summaryList = summary?.querySelector<HTMLElement>('[data-error-list]') ?? null;
  const result = document.querySelector<HTMLElement>('[data-result]');
  const resultText = result?.querySelector<HTMLElement>('[data-result-text]') ?? null;
  const resultEmail = result?.querySelector<HTMLAnchorElement>('[data-result-email]') ?? null;
  const resultWhatsapp = result?.querySelector<HTMLAnchorElement>('[data-result-whatsapp]') ?? null;

  const enabled = Boolean(salesEmail || salesWhatsapp);
  if (!submit || !enabled) return; // stays disabled, with the "not configured" note
  submit.disabled = false;

  let submitted = false;

  // After the first submit, re-validate a field when the visitor leaves it.
  form.addEventListener('focusout', (event) => {
    if (!submitted) return;
    const target = event.target as HTMLInputElement;
    const name = target.name as keyof Values;
    if (!(name in labels)) return;
    const check = messages[name];
    setFieldError(form, name, check ? check(target.value.trim()) : null);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitted = true;
    const values = readValues(form);
    const errors = validate(form, values);

    if (errors.length) {
      if (result) result.hidden = true;
      if (summary && summaryList) {
        summaryList.replaceChildren(
          ...errors.map(([name, message]) => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = `#${name}`;
            a.textContent = `${labels[name]}: ${message}`;
            a.className = 'text-danger';
            a.addEventListener('click', (e) => {
              e.preventDefault();
              (form.elements.namedItem(name) as HTMLElement | null)?.focus();
            });
            li.append(a);
            return li;
          }),
        );
        summary.hidden = false;
        summary.focus();
      } else {
        (form.elements.namedItem(errors[0][0]) as HTMLElement | null)?.focus();
      }
      return;
    }

    if (summary) summary.hidden = true;

    const subject = `Demonstração do Cortex — ${values.clinica}`;
    const mailto = salesEmail
      ? `mailto:${salesEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildBody(values))}`
      : '';
    const whatsapp = salesWhatsapp
      ? `https://wa.me/${salesWhatsapp}?text=${encodeURIComponent(buildWhatsappText(values))}`
      : '';

    if (result && resultText) {
      if (resultEmail) {
        resultEmail.hidden = !mailto;
        if (mailto) resultEmail.href = mailto;
      }
      if (resultWhatsapp) {
        resultWhatsapp.hidden = !whatsapp;
        if (whatsapp) resultWhatsapp.href = whatsapp;
      }
      resultText.textContent = mailto
        ? whatsapp
          ? 'Abrimos o seu aplicativo de e-mail com a mensagem preenchida; é só enviar. Se ele não abriu, use o botão abaixo, ou fale com a gente pelo WhatsApp.'
          : 'Abrimos o seu aplicativo de e-mail com a mensagem preenchida; é só enviar. Se ele não abriu, use o botão abaixo.'
        : 'Sua mensagem está pronta. Clique no botão abaixo para enviá-la pelo WhatsApp.';
      result.hidden = false;
      result.focus();
    }

    if (mailto) window.location.href = mailto;
  });
}
