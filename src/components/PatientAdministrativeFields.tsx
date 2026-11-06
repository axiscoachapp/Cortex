import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { administrativeValues } from '@/lib/patientRegistration';
export function PatientAdministrativeFields({value,onChange,prefix='patient'}: {
  value:ReturnType<typeof administrativeValues>;
  onChange:(patch:Partial<ReturnType<typeof administrativeValues>>)=>void;
  prefix?:string;
}) {
  return <div className="grid items-end gap-4 sm:grid-cols-2">
    {([{key:'phone',label:'Telefone / WhatsApp (opcional)',type:'tel',max:25},{key:'email',label:'E-mail (opcional)',type:'email',max:254},{key:'cpf',label:'CPF (opcional)',type:'text',max:14},{key:'healthInsurance',label:'Convênio (opcional)',type:'text',max:120}] as const).map(field=><div key={field.key} className="space-y-2">
      <Label htmlFor={prefix+'-'+field.key}>{field.label}</Label><Input id={prefix+'-'+field.key} type={field.type} maxLength={field.max} value={value[field.key]} onChange={event=>onChange({[field.key]:event.target.value})} />
    </div>)}
    <div className="space-y-2"><Label htmlFor={prefix+'-sex'}>Sexo (opcional)</Label><select id={prefix+'-sex'} className="w-full h-10 rounded-md border px-3 text-sm bg-background" value={value.sex} onChange={event=>onChange({sex:event.target.value})}>
      <option value="">Não preenchido</option><option value="feminino">Feminino</option><option value="masculino">Masculino</option><option value="intersexo">Intersexo</option><option value="nao_informado">Não informado</option>
    </select></div>
  </div>;
}
