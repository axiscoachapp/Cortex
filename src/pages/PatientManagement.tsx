import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { mapPatientRow } from '@/lib/patientMapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brain, Plus, Pencil, Trash2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Patient } from '@/types/patient';

const PatientManagement = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    profession: '',
    last_visit: '',
    status: 'novo' as const,
  });

  if (!user) { navigate('/auth'); return null; }

  const { data: patients = [], isLoading: loading } = useQuery<Patient[]>({
    queryKey: ['patients', user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('patients').select('*').order('name');
      if (error) throw error;
      return (data ?? []).map(mapPatientRow);
    },
    enabled: !!user,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.age || !formData.last_visit) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }

    try {
      const patientData = {
        name: formData.name,
        age: parseInt(formData.age),
        profession: formData.profession,
        last_visit: formData.last_visit,
        status: formData.status,
        user_id: user?.id,
      };

      if (editingPatient) {
        const { error } = await supabase
          .from('patients')
          .update(patientData)
          .eq('id', editingPatient.id);

        if (error) throw error;
        toast.success('Paciente atualizado com sucesso!');
      } else {
        const { error } = await supabase
          .from('patients')
          .insert([patientData]);

        if (error) throw error;
        toast.success('Paciente adicionado com sucesso!');
      }

      setDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['patients', user.id] });
    } catch (error: any) {
      toast.error('Erro ao salvar paciente');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este paciente?')) return;

    try {
      const { error } = await supabase
        .from('patients')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Paciente excluído com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['patients', user.id] });
    } catch (error: any) {
      toast.error('Erro ao excluir paciente');
    }
  };

  const handleEdit = (patient: Patient) => {
    setEditingPatient(patient);
    setFormData({
      name: patient.name,
      age: patient.age.toString(),
      profession: patient.profession,
      last_visit: patient.lastVisit,
      status: patient.status,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      age: '',
      profession: '',
      last_visit: '',
      status: 'novo',
    });
    setEditingPatient(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-background border-b">
        <div className="container mx-auto px-4 py-3 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
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
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 md:mr-2" />
                  <span className="hidden sm:inline">Novo Paciente</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingPatient ? 'Editar Paciente' : 'Novo Paciente'}
                  </DialogTitle>
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
                    <Label htmlFor="age">Idade *</Label>
                    <Input
                      id="age"
                      type="number"
                      value={formData.age}
                      onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                      required
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
                    <Label htmlFor="last_visit">Última Visita *</Label>
                    <Input
                      id="last_visit"
                      type="date"
                      value={formData.last_visit}
                      onChange={(e) => setFormData({ ...formData, last_visit: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="status">Status</Label>
                    <Select
                      value={formData.status}
                      onValueChange={(value: any) => setFormData({ ...formData, status: value })}
                    >
                      <SelectTrigger>
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
                  <Button type="submit" className="w-full">
                    {editingPatient ? 'Atualizar' : 'Adicionar'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-center py-8 text-muted-foreground">Carregando...</p>
            ) : patients.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">Nenhum paciente cadastrado</p>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {patients.map((patient) => (
                    <div key={patient.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold bg-medical-blue/10 text-medical-blue">
                        {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground truncate">{patient.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {patient.age} anos{patient.profession ? ` · ${patient.profession}` : ''}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] capitalize font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {patient.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(patient.lastVisit).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(patient)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(patient.id)}>
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
                      {patients.map((patient) => (
                        <TableRow key={patient.id}>
                          <TableCell className="font-medium">{patient.name}</TableCell>
                          <TableCell>{patient.age}</TableCell>
                          <TableCell>{patient.profession}</TableCell>
                          <TableCell>{new Date(patient.lastVisit).toLocaleDateString('pt-BR')}</TableCell>
                          <TableCell><span className="capitalize">{patient.status}</span></TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(patient)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(patient.id)}>
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
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default PatientManagement;