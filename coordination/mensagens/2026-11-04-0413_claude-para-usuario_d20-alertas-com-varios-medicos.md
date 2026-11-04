# D20: alertas "Atenção" de pacientes com mais de um médico
- De: claude
- Para: usuario
- Data: 2026-11-04 04:13 (America/Sao_Paulo)
- Responde a: —
- Status: aberta
- Decisão do usuário necessária: sim

No PersonalMed, o campo "Atenção" de um paciente aparecia para todos os médicos. No Cortex, cada médico só vê os próprios prontuários. Todo alerta importado chega como "a revisar", e o médico decide se vira alergia, nota clínica ou nota administrativa, ou se descarta.

São 5.277 alertas:
- 4.702 de pacientes com um único médico, que vão para esse médico;
- **575 de pacientes atendidos por mais de um médico.** Esta é a decisão.

**Opções**
1. **Recomendada:** uma cópia para cada médico que tem prontuário do paciente, visível só a ele. Esses médicos já viam o alerta no PersonalMed, então ninguém passa a ver algo novo.
2. Só para o médico que atendeu o paciente mais recentemente.
3. Nenhum: esses 575 ficam guardados no arquivo cifrado da migração.

Outro ponto: 15 alertas citam óbito. Eles vão para o médico revisar e não chegam à recepção automaticamente. Vale a clínica conferir esses casos antes de mandar lembretes de consulta.
