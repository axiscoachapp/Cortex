import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { administrativeFieldId, administrativeValues, type AdministrativeField, type RegistrationErrors } from '@/lib/patientRegistration';

export function PatientAdministrativeFields({value,onChange,prefix='patient',errors={}}: {
  value:ReturnType<typeof administrativeValues>;
  onChange:(patch:Partial<ReturnType<typeof administrativeValues>>)=>void;
  prefix?:string;
  /** Messages shown under each field (only the ones the form decided to show). */
  errors?:Pick<RegistrationErrors,AdministrativeField>;
}) {
  const invalid = (field: AdministrativeField) => errors[field]
    ? { 'aria-invalid': true as const, 'aria-describedby': `${administrativeFieldId(prefix, field)}-error` }
    : {};
  const message = (field: AdministrativeField) => errors[field]
    ? <p id={`${administrativeFieldId(prefix, field)}-error`} className="text-sm text-destructive">{errors[field]}</p>
    : null;
  return <div className="grid items-start gap-4 sm:grid-cols-2">
    {([{key:'phone',label:'Telefone / WhatsApp (opcional)',type:'tel',max:25},{key:'email',label:'E-mail (opcional)',type:'email',max:254},{key:'cpf',label:'CPF (opcional)',type:'text',max:14},{key:'healthInsurance',label:'Convênio (opcional)',type:'text',max:120}] as const).map(field=><div key={field.key} className="min-w-0 space-y-2">
      <Label htmlFor={administrativeFieldId(prefix, field.key)}>{field.label}</Label><Input id={administrativeFieldId(prefix, field.key)} type={field.type} maxLength={field.max} value={value[field.key]} onChange={event=>onChange({[field.key]:event.target.value})} {...invalid(field.key)} />
      {message(field.key)}
    </div>)}
    <div className="min-w-0 space-y-2"><Label htmlFor={administrativeFieldId(prefix, 'sex')}>Sexo (opcional)</Label><select id={administrativeFieldId(prefix, 'sex')} className="w-full h-10 rounded-md border px-3 text-sm bg-background" value={value.sex} onChange={event=>onChange({sex:event.target.value})} {...invalid('sex')}>
      <option value="">Não preenchido</option><option value="feminino">Feminino</option><option value="masculino">Masculino</option><option value="intersexo">Intersexo</option><option value="nao_informado">Não informado</option>
    </select>{message('sex')}</div>
  </div>;
}
