import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { mapPatientRow } from '@/lib/patientMapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brain, Plus, Pencil, Trash2, ArrowLeft, Upload } from 'lucide-react';
import { ImportPatientsModal } from '@/components/ImportPatientsModal';
import { useToast } from '@/hooks/use-toast';
import { Patient } from '@/types/patient';
import { ageFromBirthdate } from '@/lib/patientImport';
import { clinicDate, formatDateOnly } from '@/lib/dates';
import { fetchAllRows } from '@/lib/pagination';

const PatientManagement = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    date_of_birth: '',
    profession: '',
    last_visit: '',
    status: 'novo' as Patient['status'],
  });

  const { data: patients = [], isLoading: loading, isError, refetch } = useQuery<Patient[]>({
    queryKey: ['patients', user?.id],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => supabase.from('patients').select('*').order('name').order('id').range(from, to));
      return data.map(mapPatientRow);
    },
    enabled: !!user,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (saving) return;
    if (!formData.name.trim() || (!formData.date_of_birth && formData.age !== '' && (!Number.isInteger(Number(formData.age)) || Number(formData.age) < 0 || Number(formData.age) > 130)) || (formData.date_of_birth && ageFromBirthdate(formData.date_of_birth, clinicDate()) === null)) {
      toast({ title: 'Preencha todos os campos obrigatórios', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const patientData = {
        name: formData.name.trim(),
        age: formData.date_of_birth ? ageFromBirthdate(formData.date_of_birth, clinicDate()) : formData.age === '' ? null : Number(formData.age),
        date_of_birth: formData.date_of_birth || null,
        profession: formData.profession,
        last_visit: formData.last_visit || null,
        status: formData.status,
        user_id: user?.id,
      };

      if (editingPatient) {
        const { data: updated, error } = await supabase
          .from('patients')
          .update(patientData)
          .eq('id', editingPatient.id).eq('revision', editingPatient.revision ?? 0).select('id').maybeSingle();
        if (!updated && !error) {
          toast({ title: 'Paciente alterado em outra sessão', description: 'Seus dados continuam no formulário. Reabra o paciente para comparar antes de salvar.', variant: 'destructive' });
          return;
        }

        if (error) throw error;
        toast({ title: 'Paciente atualizado com sucesso!' });
      } else {
        const { error } = await supabase
          .from('patients')
          .insert([patientData]);

        if (error) throw error;
        toast({ title: 'Paciente adicionado com sucesso!' });
      }

      setDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    } catch {
      toast({ title: 'Erro ao salvar paciente', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este paciente?')) return;

    try {
      const { data, error } = await supabase.functions.invoke('delete-patient', { body: { patientId: id } });
      if (error || data?.success !== true) throw error ?? new Error('Exclusão incompleta');
      toast({ title: 'Paciente excluído com sucesso!' });
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    } catch {
      toast({ title: 'Exclusão incompleta', description: 'Tente excluir novamente para concluir a remoção dos dados e arquivos.', variant: 'destructive' });
    }
  };

  const handleEdit = (patient: Patient) => {
    setEditingPatient(patient);
    setFormData({
      name: patient.name,
      age: patient.age?.toString() ?? '',
      date_of_birth: patient.dateOfBirth ?? '',
      profession: patient.profession,
      last_visit: patient.lastVisit ?? '',
      status: patient.status,
    });
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
    });
    setEditingPatient(null);
  };

  const baseline = editingPatient ? {
    name: editingPatient.name, age: editingPatient.age?.toString() ?? '', date_of_birth: editingPatient.dateOfBirth ?? '', profession: editingPatient.profession,
    last_visit: editingPatient.lastVisit ?? '', status: editingPatient.status,
  } : { name: '', age: '', date_of_birth: '', profession: '', last_visit: '', status: 'novo' };
  const dirty = JSON.stringify(formData) !== JSON.stringify(baseline);
  const canClose = useUnsavedChanges(dialogOpen && dirty);
  const setDialog = (open: boolean) => {
    if (saving || !canClose(open)) return;
    setDialogOpen(open);
    if (!open) resetForm();
  };
  const filtered = patients.filter(patient => `${patient.name} ${patient.profession}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const pageCount = Math.ceil(filtered.length / 50);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visiblePatients = filtered.slice(currentPage * 50, currentPage * 50 + 50);

  if (authLoading) return <p role="status" className="p-8">Carregando…</p>;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-background border-b">
        <div className="container mx-auto px-4 py-3 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Brain className="h-6 w-6 md:h-8 md:w-8 text-primary shrink-0" />
            <h1 className="text-lg md:text-2xl font-semibold truncate">Gerenciar Pacientes</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 md:py-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base md:text-xl">Pacientes</CardTitle>
            <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" aria-label="Importar pacientes" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 md:mr-2" />
              <span className="hidden sm:inline">Importar</span>
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialog}>
              <DialogTrigger asChild>
                <Button size="sm" aria-label="Novo Paciente">
                  <Plus className="h-4 w-4 md:mr-2" />
                  <span className="hidden sm:inline">Novo Paciente</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-[calc(100vw-16px)] sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    {editingPatient ? 'Editar Paciente' : 'Novo Paciente'}
                  </DialogTitle>
                  <DialogDescription className="sr-only">Revise os dados do paciente antes de salvar.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
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
                    <Input id="date_of_birth" type="date" max={clinicDate()} value={formData.date_of_birth} onChange={e => setFormData({ ...formData, date_of_birth: e.target.value })} />
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
          <CardContent>
            <Input type="search" aria-label="Buscar pacientes" placeholder="Buscar por nome ou profissão…" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} className="mb-4" />
            {loading ? (
              <p className="text-center py-8 text-muted-foreground">Carregando...</p>
            ) : isError ? (
              <div role="alert" className="text-center py-8 space-y-3">
                <p>Não foi possível carregar os pacientes.</p>
                <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">{search ? 'Nenhum paciente corresponde à busca' : 'Nenhum paciente cadastrado'}</p>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {visiblePatients.map((patient) => (
                    <div key={patient.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold bg-medical-blue/10 text-medical-blue">
                        {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link to={`/?patient=${encodeURIComponent(patient.id)}`} aria-label={`Abrir prontuário de ${patient.name}`} className="font-medium text-sm text-medical-blue hover:underline truncate block">{patient.name}</Link>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {patient.age === null ? 'Idade não informada' : `${patient.age} anos`}{patient.profession ? ` · ${patient.profession}` : ''}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] capitalize font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {patient.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {patient.lastVisit ? formatDateOnly(patient.lastVisit) : 'Sem consulta concluída'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar paciente" onClick={() => handleEdit(patient)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Excluir paciente" onClick={() => handleDelete(patient.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Idade</TableHead>
                        <TableHead>Profissão</TableHead>
                        <TableHead>Última Visita</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visiblePatients.map((patient) => (
                        <TableRow key={patient.id}>
                          <TableCell className="font-medium"><Link to={`/?patient=${encodeURIComponent(patient.id)}`} aria-label={`Abrir prontuário de ${patient.name}`} className="text-medical-blue hover:underline">{patient.name}</Link></TableCell>
                          <TableCell>{patient.age ?? 'Não informada'}</TableCell>
                          <TableCell>{patient.profession}</TableCell>
                          <TableCell>{patient.lastVisit ? formatDateOnly(patient.lastVisit) : 'Sem consulta concluída'}</TableCell>
                          <TableCell><span className="capitalize">{patient.status}</span></TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" aria-label="Editar paciente" onClick={() => handleEdit(patient)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label="Excluir paciente" onClick={() => handleDelete(patient.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            {pageCount > 1 && <nav aria-label="Paginação de pacientes" className="flex items-center justify-center gap-3 pt-4">
              <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</Button>
              <span className="text-sm" aria-live="polite">Página {currentPage + 1} de {pageCount}</span>
              <Button variant="outline" size="sm" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</Button>
            </nav>}
          </CardContent>
        </Card>
      </main>

      {user && (
        <ImportPatientsModal open={importOpen} onOpenChange={setImportOpen} userId={user.id} />
      )}
    </div>
  );
};

export default PatientManagement;
