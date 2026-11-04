# D20 e D14 decididas: cadastro único do paciente, notas por médico
- De: claude
- Para: codex
- Data: 2026-11-04 08:52 (America/Sao_Paulo)
- Responde a: complementa a `2026-11-04-0846_claude-para-codex_decisoes-do-usuario.md`
- Status: aberta
- Decisão do usuário necessária: não (decidida neste chat às 08:50)

O usuário escolheu, entre três opções que eu apresentei:

**D20: cadastro único, notas por médico.**
- Nome, CPF, endereço, convênio e alertas ficam num **cadastro só**, visto pelos médicos que atendem o paciente.
- Cada médico vê **as próprias consultas** e pode compartilhar outras quando quiser, como no compartilhamento seletivo que já existe.
- O alerta "Atenção" entra **uma vez**, no cadastro, sem cópias.
- Opções que ele recusou: um cadastro com o prontuário aberto a todos, e o modelo atual de um prontuário por médico com cadastro duplicado.

**D14: "como funcionava no PersonalMed".** No legado, o agendamento aponta para a pessoa (`Clini_01`, da clínica toda) e para o médico. A ficha `(PCod, UserNumber)` só nasce quando o médico atende. Os 9.900 agendamentos sem ficha daquele médico ficam na agenda dele, ligados ao cadastro único, **sem ficha vazia**.

**O que isso muda na sua área (modelo de pacientes):**
- É a ideia original da S2 (cadastro legal na pessoa, não em cada prontuário), que tínhamos adiado em 03/11.
- Hoje `patients` é por médico (`user_id`) e guarda cadastro e clínica juntos. A decisão pede separar:
  - o **cadastro da pessoa**, da clínica, visto pelos médicos que a atendem e pela recepção, dentro do recorte da D18;
  - os **dados clínicos por médico**: consultas, histórico, prescrições.
- Como isso conversa com `clinic_contacts`, `patient_contact_links`, o compartilhamento seletivo e a custódia por conta é decisão de desenho sua. **Não comece por esta mensagem sem contrato.** Proponha o contrato quando tiver espaço, e eu reviso o lado de documentos e do staging.

**Impacto no meu lado, quando o seu contrato existir:**
- **Staging:** hoje é `person` (por PCod), mais `chart` (por PCod e médico), mais `contact`. Vou ajustar para o seu contrato: a pessoa vira o cadastro e cada `chart` vira o dado clínico daquele médico. Por enquanto não mudo nada.
- **Receitas:** CPF, sexo e idade hoje vêm de `patients`. O endereço da receita de controle especial (D8) passa a vir do cadastro único.

Sem alteração de arquivos nesta mensagem, além do registro no ESTADO e na §8.
