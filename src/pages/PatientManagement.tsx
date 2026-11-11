import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { mapPatientRow } from '@/lib/patientMapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, LifeBuoy, Archive, RotateCcw, MoreHorizontal, Search, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { functionErrorMessage } from '@/lib/functionErrors';
import { useToast } from '@/hooks/use-toast';
import { Patient } from '@/types/patient';
import { ageFromBirthdate } from '@/lib/patientImport';
import { clinicDate, formatDateOnly } from '@/lib/dates';
import { fetchAllRows } from '@/lib/pagination';
import { PatientAdministrativeFields } from '@/components/PatientAdministrativeFields';
import { validatePatientRegistration, validatePatientChanges, normalizeCpf, administrativeValues } from '@/lib/patientRegistration';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { PageHeading } from '@/components/PageHeading';

const STATUS_LABEL: Record<Patient['status'], string> = {
  novo: 'Novo',
  retorno: 'Retorno',
  seguimento: 'Seguimento',
  atendimento: 'Em atendimento',
};

/** Lower case without accents, so "joao" finds "João". */
function folded(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

/** Name, CPF or phone; digits in the query also match formatted CPF and phone. */
function patientMatches(patient: Patient, query: string): boolean {
  const text = folded(query.trim());
  if (!text) return true;
  if (folded(patient.name).includes(text)) return true;
  const digits = text.replace(/\D/g, '');
  if (digits.length < 3 || digits.length !== text.replace(/[\s().\-/+]/g, '').length) return false;
  return [patient.cpf, patient.phone].some((value) => (value ?? '').replace(/\D/g, '').includes(digits));
}

const PatientManagement = () => {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [migrationInfoOpen, setMigrationInfoOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    patient: Patient;
    kind: 'archive' | 'restore' | 'delete';
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    date_of_birth: '',
    profession: '',
    last_visit: '',
    status: 'novo' as Patient['status'],
    ...administrativeValues(),
  });

  const {
    data: patients = [],
    isLoading: loading,
    isError,
    refetch,
  } = useQuery<Patient[]>({
    queryKey: ['patients', user?.id, 'all', showArchived ? 'archived' : 'active'],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => {
        const query = supabase.from('patients').select('*');
        return (showArchived ? query.not('archived_at', 'is', null) : query.is('archived_at', null))
          .order('name')
          .order('id')
          .range(from, to);
      });
      return data.map(mapPatientRow);
    },
    enabled: !!user,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (saving) return;
    const registration={...formData,age:formData.date_of_birth?ageFromBirthdate(formData.date_of_birth,clinicDate()):formData.age === '' ? null : Number(formData.age)};
    const registrationError = editingPatient ? validatePatientChanges(registration,{...baseline,age:editingPatient.age}) : validatePatientRegistration(registration);
    if (registrationError) { toast({title:registrationError,variant:'destructive'}); return; }
    if (
      ((!editingPatient || formData.age !== baseline.age) && !formData.date_of_birth &&
        formData.age !== '' &&
        (!Number.isInteger(Number(formData.age)) || Number(formData.age) < 0 || Number(formData.age) > 130)) ||
      ((!editingPatient || formData.date_of_birth !== baseline.date_of_birth) && formData.date_of_birth && ageFromBirthdate(formData.date_of_birth, clinicDate()) === null)
    ) {
      toast({ title: 'Preencha todos os campos obrigatórios', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const patientData = {
        name: formData.name.trim(),
        age: formData.date_of_birth
          ? ageFromBirthdate(formData.date_of_birth, clinicDate())
          : formData.age === ''
            ? null
            : Number(formData.age),
        date_of_birth: formData.date_of_birth || null,
        profession: formData.profession,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        cpf: normalizeCpf(formData.cpf) || null,
        sex: formData.sex || null,
        health_insurance: formData.healthInsurance.trim() || null,
        last_visit: formData.last_visit || null,
        status: formData.status,
        user_id: user?.id,
      };

      if (editingPatient) {
        const columns={name:'name',age:'age',date_of_birth:'date_of_birth',profession:'profession',last_visit:'last_visit',status:'status',phone:'phone',email:'email',cpf:'cpf',sex:'sex',healthInsurance:'health_insurance'} as const;
        const patch:Partial<typeof patientData>={};
        for(const key of Object.keys(formData) as (keyof typeof formData)[]) {
          if(formData[key]!==baseline[key])Object.assign(patch,{[columns[key]]:patientData[columns[key]]});
        }
        if(formData.date_of_birth!==baseline.date_of_birth)patch.age=patientData.age;
        if(!Object.keys(patch).length){setDialogOpen(false);return;}
        const { data: updated, error } = await supabase
          .from('patients')
          .update(patch)
          .eq('id', editingPatient.id)
          .eq('revision', editingPatient.revision ?? 0)
          .select('id')
          .maybeSingle();
        if (!updated && !error) {
          await refreshAfterConflict(editingPatient.id);
          return;
        }

        if (error) throw error;
        toast({ title: 'Paciente atualizado com sucesso!' });
      } else {
        const { error } = await supabase.from('patients').insert([patientData]);

        if (error) throw error;
        toast({ title: 'Paciente adicionado com sucesso!' });
      }

      setDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    } catch {
      toast({ title: 'Erro ao salvar paciente', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Charts with clinical records must be retained (CFM 1.821/2007; Lei 13.787/2018):
  // the everyday action is "Arquivar", which hides the patient and can be undone.
  const runPendingAction = async () => {
    if (!pendingAction || actionBusy) return;
    const { patient, kind } = pendingAction;
    setActionBusy(true);
    try {
      if (kind === 'delete') {
        const { data, error } = await supabase.functions.invoke('delete-patient', { body: { patientId: patient.id } });
        if (error || data?.success !== true) throw error ?? new Error('Exclusão incompleta');
        toast({ title: 'Paciente excluído definitivamente' });
      } else {
        const { error } = await supabase
          .from('patients')
          .update({ archived_at: kind === 'archive' ? new Date().toISOString() : null })
          .eq('id', patient.id);
        if (error) throw error;
        toast({ title: kind === 'archive' ? 'Paciente arquivado' : 'Paciente restaurado' });
      }
      setPendingAction(null);
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    } catch (error) {
      toast({
        title: kind === 'delete' ? 'Não foi possível excluir' : 'Não foi possível atualizar o paciente',
        description: await functionErrorMessage(error, 'Tente novamente.'),
        variant: 'destructive',
      });
    } finally {
      setActionBusy(false);
    }
  };

  // Another session changed this patient: load the current version, keep only
  // the fields the doctor changed here, and let them save against it.
  const refreshAfterConflict = async (patientId: string) => {
    queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    const { data: row } = await supabase.from('patients').select('*').eq('id', patientId).maybeSingle();
    if (!row) {
      toast({
        title: 'Paciente alterado em outra sessão',
        description: 'Não foi possível carregar a versão atual. Seus dados continuam no formulário; tente salvar de novo.',
        variant: 'destructive',
      });
      return;
    }
    const fresh = mapPatientRow(row);
    const freshValues = formValues(fresh);
    setFormData((current) => {
      const merged = { ...freshValues };
      for (const key of Object.keys(current) as (keyof typeof current)[]) {
        if (current[key] !== baseline[key]) Object.assign(merged, { [key]: current[key] });
      }
      return merged;
    });
    setEditingPatient(fresh);
    toast({
      title: 'Paciente alterado em outra sessão',
      description: 'O formulário foi atualizado com a versão atual e manteve o que você mudou. Confira e salve de novo.',
      variant: 'destructive',
    });
  };

  const formValues = (patient: Patient) => ({
    name: patient.name,
    age: patient.age?.toString() ?? '',
    date_of_birth: patient.dateOfBirth ?? '',
    profession: patient.profession,
    last_visit: patient.lastVisit ?? '',
    status: patient.status,
    ...administrativeValues(patient),
  });

  const handleEdit = (patient: Patient) => {
    setEditingPatient(patient);
    setFormData(formValues(patient));
    setDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      age: '',
      date_of_birth: '',
      profession: '',
      last_visit: '',
      status: 'novo',
      ...administrativeValues(),
    });
    setEditingPatient(null);
  };

  const baseline = editingPatient
    ? formValues(editingPatient)
    : { name: '', age: '', date_of_birth: '', profession: '', last_visit: '', status: 'novo' as Patient['status'], ...administrativeValues() };
  const dirty = JSON.stringify(formData) !== JSON.stringify(baseline);
  const canClose = useUnsavedChanges(dialogOpen && dirty);
  const setDialog = (open: boolean) => {
    if (saving || !canClose(open)) return;
    setDialogOpen(open);
    if (!open) resetForm();
  };
  const filtered = patients.filter((patient) => patientMatches(patient, search));
  const openNewPatient = () => {
    resetForm();
    // A searched name that found nobody becomes the new patient's name.
    const typed = search.trim();
    if (typed && !/\d/.test(typed)) setFormData((current) => ({ ...current, name: typed }));
    setDialogOpen(true);
  };
  const rowActions = (patient: Patient) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 shrink-0" aria-label={`Ações para ${patient.name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handleEdit(patient)}>
          <Pencil className="mr-2 h-4 w-4" />
          Editar cadastro
        </DropdownMenuItem>
        {showArchived ? (
          <>
            <DropdownMenuItem onSelect={() => setPendingAction({ patient, kind: 'restore' })}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Restaurar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setPendingAction({ patient, kind: 'delete' })}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir definitivamente…
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={() => setPendingAction({ patient, kind: 'archive' })}>
            <Archive className="mr-2 h-4 w-4" />
            Arquivar…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const pageCount = Math.ceil(filtered.length / 50);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visiblePatients = filtered.slice(currentPage * 50, currentPage * 50 + 50);

  if (authLoading)
    return (
      <p role="status" className="p-8">
        Carregando…
      </p>
    );
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <WorkspaceShell section="Pacientes" contentClassName="space-y-6">
      <PageHeading title="Pacientes" description="Consulte e mantenha seus cadastros. O acesso ao prontuário de outro médico depende de compartilhamento explícito." />
      <div>
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 p-4 pb-3 md:p-6 md:pb-3">
            <h2 className="text-base font-semibold md:text-lg">Seus cadastros</h2>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Mais opções de pacientes">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setShowArchived((value) => !value);
                      setPage(0);
                    }}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    {showArchived ? 'Voltar aos pacientes ativos' : 'Ver pacientes arquivados'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setMigrationInfoOpen(true)}>
                    <LifeBuoy className="mr-2 h-4 w-4" />
                    Migração de pacientes
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Dialog open={dialogOpen} onOpenChange={setDialog}>
                <DialogTrigger asChild>
                  <Button className="min-h-11 gap-2" onClick={openNewPatient}>
                    <Plus className="h-4 w-4" />
                    Novo paciente
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-[calc(100vw-16px)] sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{editingPatient ? 'Editar cadastro' : 'Novo paciente'}</DialogTitle>
                    <DialogDescription className="sr-only">
                      Revise os dados do paciente antes de salvar.
                    </DialogDescription>
                  </DialogHeader>
                  <form noValidate onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="name">Nome *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="age">Idade (se conhecida)</Label>
                      <Input
                        id="age"
                        type="number"
                        min={0}
                        max={130}
                        step={1}
                        value={formData.age}
                        onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                        disabled={!!formData.date_of_birth}
                      />
                    </div>
                    <div>
                      <Label htmlFor="date_of_birth">Data de nascimento (se conhecida)</Label>
                      <Input
                        id="date_of_birth"
                        type="date"
                        max={clinicDate()}
                        value={formData.date_of_birth}
                        onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="profession">Profissão</Label>
                      <Input
                        id="profession"
                        value={formData.profession}
                        onChange={(e) => setFormData({ ...formData, profession: e.target.value })}
                      />
                    </div>
                    <div>
                      <PatientAdministrativeFields value={formData} onChange={patch=>setFormData(previous=>({...previous,...patch}))} />
                      <Label htmlFor="last_visit">Última visita concluída (se conhecida)</Label>
                      <Input
                        id="last_visit"
                        type="date"
                        value={formData.last_visit}
                        onChange={(e) => setFormData({ ...formData, last_visit: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="status">Status</Label>
                      <Select
                        value={formData.status}
                        onValueChange={(value: Patient['status']) => setFormData({ ...formData, status: value })}
                      >
                        <SelectTrigger id="status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="novo">Novo</SelectItem>
                          <SelectItem value="retorno">Retorno</SelectItem>
                          <SelectItem value="seguimento">Seguimento</SelectItem>
                          <SelectItem value="atendimento">Atendimento</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" className="w-full" disabled={saving}>
                      {saving ? 'Salvando…' : editingPatient ? 'Atualizar' : 'Adicionar'}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Buscar pacientes"
                placeholder="Nome, CPF ou telefone"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>
            {showArchived && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <span>Pacientes arquivados</span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => {
                    setShowArchived(false);
                    setPage(0);
                  }}
                >
                  Voltar aos pacientes ativos
                </Button>
              </div>
            )}
            {loading ? (
              <div className="space-y-1.5">
                <p role="status" className="sr-only">Carregando pacientes…</p>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} aria-hidden="true" className="h-[60px] rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : isError ? (
              <div role="alert" className="text-center py-8 space-y-3">
                <p>Não foi possível carregar os pacientes.</p>
                <Button variant="outline" onClick={() => refetch()}>
                  Tentar novamente
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              search.trim() ? (
                <div role="status" className="py-8 text-center space-y-3">
                  <p className="text-sm break-words">Nenhum paciente com “{search.trim()}”.</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" className="min-h-11 gap-2" onClick={() => setSearch('')}>
                      <X className="h-4 w-4" />
                      Limpar busca
                    </Button>
                    {!showArchived && (
                      <Button className="min-h-11 gap-2" onClick={openNewPatient}>
                        <Plus className="h-4 w-4" />
                        Cadastrar paciente
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">
                  {showArchived ? 'Nenhum paciente arquivado' : 'Nenhum paciente cadastrado'}
                </p>
              )
            ) : (
              <div>
                {/* Column labels for the desktop rows; each row also names its fields for screen readers. */}
                <div
                  aria-hidden="true"
                  className="hidden md:grid md:grid-cols-[minmax(0,2.4fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_2.25rem] md:gap-3 px-3 pb-2 text-xs font-medium text-muted-foreground border-b"
                >
                  <span>Nome</span>
                  <span>Idade</span>
                  <span>Telefone</span>
                  <span>Última consulta</span>
                  <span>Status</span>
                  <span />
                </div>
                <ul aria-label="Pacientes" className="divide-y">
                  {visiblePatients.map((patient) => (
                    <li
                      key={patient.id}
                      className="flex items-center gap-2 px-1 py-2 md:grid md:min-h-[56px] md:grid-cols-[minmax(0,2.4fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_2.25rem] md:gap-3 md:px-3 md:py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/?patient=${encodeURIComponent(patient.id)}`}
                          aria-label={`Abrir prontuário de ${patient.name}`}
                          className="block font-medium text-sm text-medical-blue hover:underline break-words md:truncate"
                        >
                          {patient.name}
                        </Link>
                        {/* Phone: the details share one line under the name. */}
                        <p className="md:hidden text-xs text-muted-foreground break-words">
                          {[
                            patient.age === null ? null : `${patient.age} anos`,
                            patient.phone,
                            patient.lastVisit ? `Última: ${formatDateOnly(patient.lastVisit)}` : 'Sem consulta concluída',
                            STATUS_LABEL[patient.status] ?? patient.status,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <span className="hidden md:block text-sm">
                        <span className="sr-only">Idade: </span>
                        {patient.age === null ? '—' : `${patient.age} anos`}
                      </span>
                      <span className="hidden md:block text-sm truncate">
                        <span className="sr-only">Telefone: </span>
                        {patient.phone ?? '—'}
                      </span>
                      <span className="hidden md:block text-sm">
                        <span className="sr-only">Última consulta: </span>
                        {patient.lastVisit ? formatDateOnly(patient.lastVisit) : 'Nenhuma'}
                      </span>
                      <span className="hidden md:block">
                        <span className="sr-only">Status: </span>
                        <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {STATUS_LABEL[patient.status] ?? patient.status}
                        </span>
                      </span>
                      {rowActions(patient)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pageCount > 1 && (
              <nav aria-label="Paginação de pacientes" className="flex items-center justify-center gap-3 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </Button>
                <span className="text-sm" aria-live="polite">
                  Página {currentPage + 1} de {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Próxima
                </Button>
              </nav>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={migrationInfoOpen} onOpenChange={setMigrationInfoOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-[calc(100vw-16px)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Migração acompanhada pela equipe Cortex</DialogTitle>
            <DialogDescription>
              A equipe Cortex prepara e confere a migração com o responsável da clínica, preservando os prontuários de cada médico.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Para trazer pacientes de outro sistema, combine com a equipe de implantação a origem, o escopo e a conferência dos dados. A transferência de arquivos é orientada por um canal seguro.
          </p>
          <Button className="sm:ml-auto" onClick={() => setMigrationInfoOpen(false)}>Entendi</Button>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && !actionBusy && setPendingAction(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-16px)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.kind === 'archive'
                ? `Arquivar ${pendingAction.patient.name}?`
                : pendingAction?.kind === 'restore'
                  ? `Restaurar ${pendingAction?.patient.name}?`
                  : `Excluir ${pendingAction?.patient.name} definitivamente?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.kind === 'archive'
                ? 'O paciente sai das listas e da agenda, mas o prontuário é mantido (guarda obrigatória de 20 anos). Você pode restaurá-lo a qualquer momento em "Ver pacientes arquivados".'
                : pendingAction?.kind === 'restore'
                  ? 'O paciente volta a aparecer nas listas.'
                  : 'Use apenas para cadastros feitos por engano, sem consultas, documentos ou arquivos. Prontuários com registros clínicos não podem ser excluídos.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionBusy}
              className={pendingAction?.kind === 'delete' ? 'bg-destructive hover:bg-destructive/90' : undefined}
              onClick={(event) => {
                event.preventDefault();
                void runPendingAction();
              }}
            >
              {actionBusy
                ? 'Aguarde…'
                : pendingAction?.kind === 'archive'
                  ? 'Arquivar'
                  : pendingAction?.kind === 'restore'
                    ? 'Restaurar'
                    : 'Excluir definitivamente'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspaceShell>
  );
};

export default PatientManagement;
