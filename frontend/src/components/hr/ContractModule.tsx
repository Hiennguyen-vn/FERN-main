import { useState } from 'react';
import { Search, FileText, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { mockContracts, CONTRACT_TYPE_CONFIG, CONTRACT_STATUS_CONFIG } from '@/data/mock-hr';
import type { EmployeeContract, ContractType } from '@/types/hr';
import { toast } from 'sonner';

export function ContractModule() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [contracts, setContracts] = useState(mockContracts);
  const [selected, setSelected] = useState<EmployeeContract | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // New contract form state
  const [newContract, setNewContract] = useState({
    employeeName: '', employeeRole: '', outletName: '',
    contractType: 'fixed_term' as ContractType, contractNumber: '',
    startDate: '', endDate: '', baseSalary: '', notes: '',
  });
  const filtered = contracts.filter(c => {
    const matchSearch = c.employeeName.toLowerCase().includes(search.toLowerCase()) ||
      c.contractNumber.toLowerCase().includes(search.toLowerCase()) ||
      c.outletName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchType = typeFilter === 'all' || c.contractType === typeFilter;
    return matchSearch && matchStatus && matchType;
  });

  const active = contracts.filter(c => c.status === 'active').length;
  const expiring = contracts.filter(c => c.status === 'expiring_soon').length;
  const expired = contracts.filter(c => c.status === 'expired').length;
  const terminated = contracts.filter(c => c.status === 'terminated').length;

  const handleRenew = (id: string) => {
    setContracts(prev => prev.map(c =>
      c.id === id ? { ...c, status: 'active' as const, renewalCount: c.renewalCount + 1, notes: 'Renewed' } : c
    ));
    setSelected(null);
    toast.success('Hợp đồng đã được gia hạn');
  };

  const handleTerminate = (id: string) => {
    setContracts(prev => prev.map(c =>
      c.id === id ? { ...c, status: 'terminated' as const } : c
    ));
    setSelected(null);
    toast.success('Hợp đồng đã được chấm dứt');
  };

  const handleCreate = () => {
    if (!newContract.employeeName || !newContract.contractNumber || !newContract.startDate || !newContract.baseSalary) {
      toast.error('Vui lòng điền đầy đủ thông tin bắt buộc');
      return;
    }
    const contract: EmployeeContract = {
      id: `ct-${Date.now()}`,
      employeeId: `emp-${Date.now()}`,
      employeeName: newContract.employeeName,
      employeeRole: newContract.employeeRole,
      outletId: 'outlet-001',
      outletName: newContract.outletName || 'Downtown Flagship',
      contractType: newContract.contractType,
      contractNumber: newContract.contractNumber,
      startDate: newContract.startDate,
      endDate: newContract.endDate || null,
      baseSalary: Number(newContract.baseSalary),
      status: 'active',
      signedAt: new Date().toISOString().split('T')[0],
      renewalCount: 0,
      notes: newContract.notes || undefined,
    };
    setContracts(prev => [contract, ...prev]);
    setCreateOpen(false);
    setNewContract({ employeeName: '', employeeRole: '', outletName: '', contractType: 'fixed_term', contractNumber: '', startDate: '', endDate: '', baseSalary: '', notes: '' });
    toast.success('Hợp đồng mới đã được tạo');
  };

  const formatSalary = (v: number) => `₫${v.toLocaleString()}`;

  return (
    <div className="p-6 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><CheckCircle2 className="h-5 w-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{active}</p><p className="text-xs text-muted-foreground">Đang hiệu lực</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent"><AlertTriangle className="h-5 w-5 text-accent-foreground" /></div>
            <div><p className="text-2xl font-bold">{expiring}</p><p className="text-xs text-muted-foreground">Sắp hết hạn</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10"><XCircle className="h-5 w-5 text-destructive" /></div>
            <div><p className="text-2xl font-bold">{expired}</p><p className="text-xs text-muted-foreground">Đã hết hạn</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></div>
            <div><p className="text-2xl font-bold">{terminated}</p><p className="text-xs text-muted-foreground">Đã chấm dứt</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Tìm nhân viên, mã HĐ, outlet…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Trạng thái" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả trạng thái</SelectItem>
            <SelectItem value="active">Đang hiệu lực</SelectItem>
            <SelectItem value="expiring_soon">Sắp hết hạn</SelectItem>
            <SelectItem value="expired">Đã hết hạn</SelectItem>
            <SelectItem value="terminated">Đã chấm dứt</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Loại HĐ" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả loại</SelectItem>
            <SelectItem value="probation">Thử việc</SelectItem>
            <SelectItem value="fixed_term">Có thời hạn</SelectItem>
            <SelectItem value="indefinite">Không thời hạn</SelectItem>
            <SelectItem value="seasonal">Thời vụ</SelectItem>
            <SelectItem value="part_time">Bán thời gian</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Tạo hợp đồng
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã HĐ</TableHead>
                <TableHead>Nhân viên</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead>Loại HĐ</TableHead>
                <TableHead>Bắt đầu</TableHead>
                <TableHead>Kết thúc</TableHead>
                <TableHead className="text-right">Lương cơ bản</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Gia hạn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(c => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(c)}>
                  <TableCell className="font-mono text-xs">{c.contractNumber}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{c.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{c.employeeRole}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.outletName}</TableCell>
                  <TableCell>
                    <Badge variant={CONTRACT_TYPE_CONFIG[c.contractType]?.variant ?? 'secondary'}>
                      {CONTRACT_TYPE_CONFIG[c.contractType]?.label ?? c.contractType}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.startDate}</TableCell>
                  <TableCell>{c.endDate ?? '—'}</TableCell>
                  <TableCell className="text-right">{formatSalary(c.baseSalary)}</TableCell>
                  <TableCell>
                    <Badge variant={CONTRACT_STATUS_CONFIG[c.status]?.variant ?? 'secondary'}>
                      {CONTRACT_STATUS_CONFIG[c.status]?.label ?? c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{c.renewalCount > 0 ? `${c.renewalCount} lần` : '—'}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Không tìm thấy hợp đồng nào</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Chi tiết hợp đồng</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-muted-foreground">{selected.contractNumber}</span>
                <Badge variant={CONTRACT_STATUS_CONFIG[selected.status]?.variant}>
                  {CONTRACT_STATUS_CONFIG[selected.status]?.label}
                </Badge>
              </div>

              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Nhân viên</p>
                <p className="font-medium text-lg">{selected.employeeName}</p>
                <p className="text-sm text-muted-foreground">{selected.employeeRole} • {selected.outletName}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Loại hợp đồng</p>
                  <Badge variant={CONTRACT_TYPE_CONFIG[selected.contractType]?.variant}>
                    {CONTRACT_TYPE_CONFIG[selected.contractType]?.label}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Lương cơ bản</p>
                  <p className="font-medium">{formatSalary(selected.baseSalary)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Ngày bắt đầu</p>
                  <p>{selected.startDate}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Ngày kết thúc</p>
                  <p>{selected.endDate ?? 'Không thời hạn'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Ngày ký</p>
                  <p>{selected.signedAt}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Số lần gia hạn</p>
                  <p>{selected.renewalCount} lần</p>
                </div>
              </div>

              {selected.notes && (
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <p className="text-sm text-muted-foreground mb-1">Ghi chú</p>
                  <p className="text-sm">{selected.notes}</p>
                </div>
              )}

              {(selected.status === 'expiring_soon' || selected.status === 'expired') && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <p className="text-sm font-medium text-destructive">
                    {selected.status === 'expiring_soon' ? '⚠️ Hợp đồng sắp hết hạn — cần gia hạn sớm' : '❌ Hợp đồng đã hết hạn'}
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {(selected.status === 'expiring_soon' || selected.status === 'expired') && (
                  <Button className="flex-1" onClick={() => handleRenew(selected.id)}>
                    <RefreshCw className="h-4 w-4 mr-2" /> Gia hạn
                  </Button>
                )}
                {selected.status === 'active' && (
                  <Button variant="destructive" className="flex-1" onClick={() => handleTerminate(selected.id)}>
                    <XCircle className="h-4 w-4 mr-2" /> Chấm dứt
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Contract Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tạo hợp đồng mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tên nhân viên *</Label>
                <Input value={newContract.employeeName} onChange={e => setNewContract(p => ({ ...p, employeeName: e.target.value }))} placeholder="Nguyễn Văn A" />
              </div>
              <div className="space-y-2">
                <Label>Vị trí *</Label>
                <Input value={newContract.employeeRole} onChange={e => setNewContract(p => ({ ...p, employeeRole: e.target.value }))} placeholder="Barista" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Mã hợp đồng *</Label>
                <Input value={newContract.contractNumber} onChange={e => setNewContract(p => ({ ...p, contractNumber: e.target.value }))} placeholder="HD-2026-XXX" />
              </div>
              <div className="space-y-2">
                <Label>Outlet</Label>
                <Input value={newContract.outletName} onChange={e => setNewContract(p => ({ ...p, outletName: e.target.value }))} placeholder="Downtown Flagship" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Loại hợp đồng</Label>
                <Select value={newContract.contractType} onValueChange={v => setNewContract(p => ({ ...p, contractType: v as ContractType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="probation">Thử việc</SelectItem>
                    <SelectItem value="fixed_term">Có thời hạn</SelectItem>
                    <SelectItem value="indefinite">Không thời hạn</SelectItem>
                    <SelectItem value="seasonal">Thời vụ</SelectItem>
                    <SelectItem value="part_time">Bán thời gian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Lương cơ bản (₫) *</Label>
                <Input type="number" value={newContract.baseSalary} onChange={e => setNewContract(p => ({ ...p, baseSalary: e.target.value }))} placeholder="10000000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ngày bắt đầu *</Label>
                <Input type="date" value={newContract.startDate} onChange={e => setNewContract(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Ngày kết thúc</Label>
                <Input type="date" value={newContract.endDate} onChange={e => setNewContract(p => ({ ...p, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Ghi chú</Label>
              <Textarea value={newContract.notes} onChange={e => setNewContract(p => ({ ...p, notes: e.target.value }))} placeholder="Ghi chú thêm về hợp đồng…" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Hủy</Button>
            <Button onClick={handleCreate}>Tạo hợp đồng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
