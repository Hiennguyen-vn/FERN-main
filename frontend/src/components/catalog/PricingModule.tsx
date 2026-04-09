import { useState, useMemo } from 'react';
import {
  DollarSign, Tag, ShieldCheck, Search, AlertTriangle,
  Calendar, CheckCircle2, XCircle, Clock, Info,
  ChevronRight, Layers, Percent, Store, Package,
  FileEdit, Eye, ArrowLeft, BarChart3, Plus, Edit, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  mockPricingRules, mockPromotions, mockAvailability, mockProducts,
} from '@/data/mock-catalog';
import type { PricingRule, Promotion, AvailabilityRule } from '@/types/catalog';
import { toast } from 'sonner';

type SubTab = 'pricing' | 'promotions' | 'availability';

const PROMO_STATUS: Record<string, { label: string; class: string; icon: React.ElementType }> = {
  active: { label: 'Active', class: 'bg-success/10 text-success', icon: CheckCircle2 },
  scheduled: { label: 'Scheduled', class: 'bg-info/10 text-info', icon: Clock },
  expired: { label: 'Expired', class: 'bg-muted text-muted-foreground', icon: XCircle },
  disabled: { label: 'Disabled', class: 'bg-destructive/10 text-destructive', icon: XCircle },
};

const PROMO_TYPE_LABEL: Record<string, { label: string; class: string }> = {
  percentage: { label: '% Off', class: 'bg-primary/10 text-primary' },
  fixed: { label: '$ Off', class: 'bg-warning/10 text-warning' },
  bogo: { label: 'BOGO', class: 'bg-info/10 text-info' },
};

const emptyPriceRule = (): Partial<PricingRule> => ({ productId: '', productName: '', outletId: '', outletName: '', basePrice: 0, effectiveFrom: '', taxRate: 8, taxInclusive: true });
const emptyPromo = (): Partial<Promotion> => ({ code: '', name: '', type: 'percentage', value: 0, appliesTo: 'all', effectiveFrom: '', effectiveTo: '', status: 'active', outletScope: 'all' });
const emptyAvail = (): Partial<AvailabilityRule> => ({ productId: '', productName: '', outletId: '', outletName: '', available: true, reason: '', effectiveFrom: '' });

export function PricingModule() {
  const [subTab, setSubTab] = useState<SubTab>('pricing');
  const [search, setSearch] = useState('');
  const [selectedRule, setSelectedRule] = useState<PricingRule | null>(null);
  const [selectedPromo, setSelectedPromo] = useState<Promotion | null>(null);

  // CRUD state
  const [pricingRules, setPricingRules] = useState<PricingRule[]>(mockPricingRules);
  const [promotions, setPromotions] = useState<Promotion[]>(mockPromotions);
  const [availability, setAvailability] = useState<AvailabilityRule[]>(mockAvailability);

  const [priceFormOpen, setPriceFormOpen] = useState(false);
  const [priceFormData, setPriceFormData] = useState<Partial<PricingRule>>(emptyPriceRule());
  const [priceEditId, setPriceEditId] = useState<string | null>(null);

  const [promoFormOpen, setPromoFormOpen] = useState(false);
  const [promoFormData, setPromoFormData] = useState<Partial<Promotion>>(emptyPromo());
  const [promoEditId, setPromoEditId] = useState<string | null>(null);

  const [availFormOpen, setAvailFormOpen] = useState(false);
  const [availFormData, setAvailFormData] = useState<Partial<AvailabilityRule>>(emptyAvail());
  const [availEditId, setAvailEditId] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string } | null>(null);

  // KPI
  const totalRules = pricingRules.length;
  const outlets = new Set(pricingRules.map(r => r.outletId)).size;
  const activePromos = promotions.filter(p => p.status === 'active').length;
  const scheduledPromos = promotions.filter(p => p.status === 'scheduled').length;
  const blockedItems = availability.filter(a => !a.available).length;
  const totalProducts = mockProducts.length;

  // Overlap detection
  const overlaps = useMemo(() => {
    const pairs: string[] = [];
    pricingRules.forEach((a, i) => {
      pricingRules.forEach((b, j) => {
        if (i < j && a.productId === b.productId && a.outletId === b.outletId) pairs.push(`${a.productName} @ ${a.outletName}`);
      });
    });
    return [...new Set(pairs)];
  }, [pricingRules]);

  const filteredRules = useMemo(() => pricingRules.filter(r => !search || r.productName.toLowerCase().includes(search.toLowerCase()) || r.outletName.toLowerCase().includes(search.toLowerCase())), [pricingRules, search]);
  const filteredPromos = useMemo(() => promotions.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.code.toLowerCase().includes(search.toLowerCase())), [promotions, search]);
  const filteredAvail = useMemo(() => availability.filter(a => !search || a.productName.toLowerCase().includes(search.toLowerCase()) || a.outletName.toLowerCase().includes(search.toLowerCase())), [availability, search]);

  // Price Rule CRUD
  const openPriceCreate = () => { setPriceFormData(emptyPriceRule()); setPriceEditId(null); setPriceFormOpen(true); };
  const openPriceEdit = (r: PricingRule) => { setPriceFormData({ ...r }); setPriceEditId(r.id); setPriceFormOpen(true); };
  const handlePriceSave = () => {
    if (!priceFormData.productName || !priceFormData.outletName || !priceFormData.effectiveFrom) { toast.error('Fill required fields'); return; }
    if (priceEditId) {
      setPricingRules(prev => prev.map(r => r.id === priceEditId ? { ...r, ...priceFormData } as PricingRule : r));
      toast.success('Price rule updated');
    } else {
      setPricingRules(prev => [{ ...priceFormData as PricingRule, id: `pr-${Date.now()}` }, ...prev]);
      toast.success('Price rule created');
    }
    setPriceFormOpen(false);
  };

  // Promo CRUD
  const openPromoCreate = () => { setPromoFormData(emptyPromo()); setPromoEditId(null); setPromoFormOpen(true); };
  const openPromoEdit = (p: Promotion) => { setPromoFormData({ ...p }); setPromoEditId(p.id); setPromoFormOpen(true); };
  const handlePromoSave = () => {
    if (!promoFormData.code || !promoFormData.name) { toast.error('Fill required fields'); return; }
    if (promoEditId) {
      setPromotions(prev => prev.map(p => p.id === promoEditId ? { ...p, ...promoFormData } as Promotion : p));
      toast.success('Promotion updated');
    } else {
      setPromotions(prev => [{ ...promoFormData as Promotion, id: `promo-${Date.now()}` }, ...prev]);
      toast.success('Promotion created');
    }
    setPromoFormOpen(false);
  };

  // Availability CRUD
  const openAvailCreate = () => { setAvailFormData(emptyAvail()); setAvailEditId(null); setAvailFormOpen(true); };
  const openAvailEdit = (a: AvailabilityRule) => { setAvailFormData({ ...a }); setAvailEditId(a.id); setAvailFormOpen(true); };
  const handleAvailSave = () => {
    if (!availFormData.productName || !availFormData.outletName) { toast.error('Fill required fields'); return; }
    if (availEditId) {
      setAvailability(prev => prev.map(a => a.id === availEditId ? { ...a, ...availFormData } as AvailabilityRule : a));
      toast.success('Availability rule updated');
    } else {
      setAvailability(prev => [{ ...availFormData as AvailabilityRule, id: `av-${Date.now()}` }, ...prev]);
      toast.success('Availability rule created');
    }
    setAvailFormOpen(false);
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'pricing') setPricingRules(prev => prev.filter(r => r.id !== deleteConfirm.id));
    if (deleteConfirm.type === 'promo') setPromotions(prev => prev.filter(p => p.id !== deleteConfirm.id));
    if (deleteConfirm.type === 'avail') setAvailability(prev => prev.filter(a => a.id !== deleteConfirm.id));
    setDeleteConfirm(null); setSelectedRule(null); setSelectedPromo(null);
    toast.success('Deleted successfully');
  };

  // Detail views
  if (selectedRule) {
    const product = mockProducts.find(p => p.id === selectedRule.productId);
    const otherRules = pricingRules.filter(r => r.productId === selectedRule.productId && r.id !== selectedRule.id);
    const finalPrice = selectedRule.taxInclusive ? selectedRule.basePrice : selectedRule.basePrice * (1 + selectedRule.taxRate / 100);
    return (
      <div className="p-6 space-y-5 animate-fade-in">
        <button onClick={() => setSelectedRule(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"><ArrowLeft className="h-3 w-3" /> Back to pricing</button>
        {product && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-muted/30 border border-border">
            <Package className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{product.name}</span><span>·</span><span className="font-mono">{product.sku}</span></div>
          </div>
        )}
        <div className="surface-elevated p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="h-5 w-5 text-primary" /></div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">{selectedRule.productName}</h2>
                <p className="text-xs text-muted-foreground mt-0.5"><Store className="h-3 w-3 inline mr-1" />{selectedRule.outletName} · Effective {selectedRule.effectiveFrom}{selectedRule.effectiveTo ? ` → ${selectedRule.effectiveTo}` : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { openPriceEdit(selectedRule); setSelectedRule(null); }}><Edit className="h-3.5 w-3.5 mr-1.5" /> Edit</Button>
              <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => setDeleteConfirm({ type: 'pricing', id: selectedRule.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[{ label: 'Base Price', value: `$${selectedRule.basePrice.toFixed(2)}` }, { label: 'Tax Rate', value: `${selectedRule.taxRate}%` }, { label: 'Tax Inclusive', value: selectedRule.taxInclusive ? 'Yes' : 'No' }, { label: 'Final Price', value: `$${finalPrice.toFixed(2)}` }].map(k => (
            <div key={k.label} className="surface-elevated p-4">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</span>
              <p className="text-xl font-semibold text-foreground mt-1">{k.value}</p>
            </div>
          ))}
        </div>
        {otherRules.length > 0 && (
          <div className="surface-elevated overflow-hidden">
            <div className="px-4 py-3 border-b"><span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Other Outlet Prices</span></div>
            <div className="divide-y divide-border">
              {otherRules.map(r => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                  <div><p className="text-sm font-medium text-foreground">{r.outletName}</p><p className="text-[10px] text-muted-foreground mt-0.5">from {r.effectiveFrom}</p></div>
                  <span className="font-mono text-sm font-medium">${r.basePrice.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Confirm Delete</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Delete this rule?</p><DialogFooter><Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button></DialogFooter></DialogContent>
        </Dialog>
      </div>
    );
  }

  if (selectedPromo) {
    const sCfg = PROMO_STATUS[selectedPromo.status]; const tCfg = PROMO_TYPE_LABEL[selectedPromo.type]; const SIcon = sCfg.icon;
    return (
      <div className="p-6 space-y-5 animate-fade-in">
        <button onClick={() => setSelectedPromo(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"><ArrowLeft className="h-3 w-3" /> Back to promotions</button>
        <div className="surface-elevated p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center', selectedPromo.status === 'active' ? 'bg-success/10' : 'bg-muted/50')}><Tag className={cn('h-5 w-5', selectedPromo.status === 'active' ? 'text-success' : 'text-muted-foreground')} /></div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-semibold text-foreground">{selectedPromo.name}</h2>
                  <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{selectedPromo.code}</span>
                  <span className={cn('inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-medium', sCfg.class)}><SIcon className="h-2.5 w-2.5" />{sCfg.label}</span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{selectedPromo.effectiveFrom} → {selectedPromo.effectiveTo}</span>
                  <span className="flex items-center gap-1"><Store className="h-3 w-3" />{selectedPromo.outletScope === 'all' ? 'All outlets' : `${selectedPromo.outlets?.length || 0} outlet(s)`}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { openPromoEdit(selectedPromo); setSelectedPromo(null); }}><Edit className="h-3.5 w-3.5 mr-1.5" /> Edit</Button>
              <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => setDeleteConfirm({ type: 'promo', id: selectedPromo.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[{ label: 'Type', value: tCfg.label }, { label: 'Value', value: selectedPromo.type === 'percentage' ? `${selectedPromo.value}%` : selectedPromo.type === 'fixed' ? `$${selectedPromo.value}` : 'Buy 1 Get 1' }, { label: 'Applies To', value: selectedPromo.appliesTo === 'all' ? 'All Products' : selectedPromo.targetName || selectedPromo.appliesTo }, { label: 'Scope', value: selectedPromo.outletScope === 'all' ? 'All Outlets' : 'Specific' }].map(k => (
            <div key={k.label} className="surface-elevated p-4"><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</span><p className="text-lg font-semibold text-foreground mt-1">{k.value}</p></div>
          ))}
        </div>
        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Confirm Delete</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Delete this promotion?</p><DialogFooter><Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button></DialogFooter></DialogContent>
        </Dialog>
      </div>
    );
  }

  const tabs: { key: SubTab; label: string; count: number; icon: React.ElementType }[] = [
    { key: 'pricing', label: 'Pricing & Tax', count: totalRules, icon: DollarSign },
    { key: 'promotions', label: 'Promotions', count: promotions.length, icon: Tag },
    { key: 'availability', label: 'Availability', count: availability.length, icon: ShieldCheck },
  ];

  const handleNew = () => {
    if (subTab === 'pricing') openPriceCreate();
    else if (subTab === 'promotions') openPromoCreate();
    else openAvailCreate();
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Pricing, Promotions & Availability</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Outlet-level pricing, tax configuration, promotions, and product availability rules</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleNew}>
          <Plus className="h-3.5 w-3.5" /> {subTab === 'pricing' ? 'New Price Rule' : subTab === 'promotions' ? 'New Promotion' : 'New Rule'}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Price Rules', value: totalRules, icon: DollarSign, color: 'text-foreground' },
          { label: 'Outlets', value: outlets, icon: Store, color: 'text-foreground' },
          { label: 'Active Promos', value: activePromos, icon: Tag, color: activePromos > 0 ? 'text-success' : 'text-foreground' },
          { label: 'Scheduled', value: scheduledPromos, icon: Clock, color: scheduledPromos > 0 ? 'text-info' : 'text-foreground' },
          { label: 'Blocked Items', value: blockedItems, icon: XCircle, color: blockedItems > 0 ? 'text-destructive' : 'text-foreground' },
          { label: 'Products', value: totalProducts, icon: Package, color: 'text-foreground' },
        ].map(kpi => (
          <div key={kpi.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2"><kpi.icon className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span></div>
            <p className={cn('text-xl font-semibold', kpi.color)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {overlaps.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-md bg-warning/5 border border-warning/20">
          <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 flex-shrink-0" />
          <div><p className="text-[11px] font-medium text-warning">Potential pricing overlap detected</p><p className="text-[10px] text-warning/80 mt-0.5">{overlaps.join(' · ')}</p></div>
        </div>
      )}

      <div className="flex items-center gap-0 border-b">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setSubTab(t.key); setSearch(''); }} className={cn('flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors', subTab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <t.icon className="h-3.5 w-3.5" />{t.label}<span className={cn('text-[10px] px-1.5 py-0.5 rounded-full ml-0.5', subTab === t.key ? 'bg-primary/10' : 'bg-muted')}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
      </div>

      {/* PRICING TAB */}
      {subTab === 'pricing' && (
        <div className="surface-elevated overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b bg-muted/30">
              {['Product', 'Outlet', 'Base Price', 'Tax', 'Tax Incl.', 'Effective From', 'Effective To', ''].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', ['Base Price', 'Tax'].includes(h) ? 'text-right' : h === 'Tax Incl.' ? 'text-center' : 'text-left')}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filteredRules.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">No pricing rules found</td></tr>}
              {filteredRules.map(rule => (
                <tr key={rule.id} onClick={() => setSelectedRule(rule)} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{rule.productName}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{rule.outletName}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">${rule.basePrice.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{rule.taxRate}%</td>
                  <td className="px-4 py-2.5 text-center">{rule.taxInclusive ? <span className="inline-flex items-center gap-0.5 text-success text-[10px] font-medium"><CheckCircle2 className="h-3 w-3" />Yes</span> : <span className="text-xs text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{rule.effectiveFrom}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{rule.effectiveTo || '—'}</td>
                  <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => openPriceEdit(rule)}><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => setDeleteConfirm({ type: 'pricing', id: rule.id })}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PROMOTIONS TAB */}
      {subTab === 'promotions' && (
        <div className="surface-elevated overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b bg-muted/30">
              {['Code', 'Name', 'Type', 'Value', 'Applies To', 'Period', 'Status', ''].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Value' ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filteredPromos.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">No promotions found</td></tr>}
              {filteredPromos.map(promo => {
                const sCfg2 = PROMO_STATUS[promo.status]; const tCfg2 = PROMO_TYPE_LABEL[promo.type]; const SIcon2 = sCfg2.icon;
                return (
                  <tr key={promo.id} onClick={() => setSelectedPromo(promo)} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors">
                    <td className="px-4 py-2.5 font-mono text-sm font-medium text-primary">{promo.code}</td>
                    <td className="px-4 py-2.5 text-sm font-medium text-foreground">{promo.name}</td>
                    <td className="px-4 py-2.5"><span className={cn('text-[10px] px-2 py-0.5 rounded font-medium', tCfg2.class)}>{tCfg2.label}</span></td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">{promo.type === 'percentage' ? `${promo.value}%` : promo.type === 'fixed' ? `$${promo.value}` : '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{promo.appliesTo === 'all' ? 'All Products' : promo.targetName || promo.appliesTo}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{promo.effectiveFrom} → {promo.effectiveTo}</td>
                    <td className="px-4 py-2.5"><span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium', sCfg2.class)}><SIcon2 className="h-2.5 w-2.5" />{sCfg2.label}</span></td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => openPromoEdit(promo)}><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => setDeleteConfirm({ type: 'promo', id: promo.id })}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* AVAILABILITY TAB */}
      {subTab === 'availability' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-md bg-info/5 border border-info/10">
            <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-info leading-relaxed">Products with restricted availability. Products not listed here are available at all outlets.</p>
          </div>
          <div className="surface-elevated overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b bg-muted/30">
                {['Product', 'Outlet', 'Status', 'Reason', 'Effective From', ''].map(h => (
                  <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Status' ? 'text-center' : 'text-left')}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filteredAvail.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">No restrictions found</td></tr>}
                {filteredAvail.map(av => (
                  <tr key={av.id} className={cn('border-b last:border-0 hover:bg-muted/20 transition-colors', !av.available && 'bg-destructive/[0.02]')}>
                    <td className="px-4 py-2.5 text-sm font-medium text-foreground">{av.productName}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{av.outletName}</td>
                    <td className="px-4 py-2.5 text-center"><span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium', av.available ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>{av.available ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}{av.available ? 'Available' : 'Blocked'}</span></td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{av.reason || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{av.effectiveFrom}</td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => openAvailEdit(av)}><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => setDeleteConfirm({ type: 'avail', id: av.id })}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Price Rule Form */}
      <Dialog open={priceFormOpen} onOpenChange={setPriceFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{priceEditId ? 'Edit Price Rule' : 'New Price Rule'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-xs">Product Name *</Label><Input value={priceFormData.productName || ''} onChange={e => setPriceFormData(p => ({ ...p, productName: e.target.value }))} className="h-8 text-sm" /></div>
              <div className="space-y-2"><Label className="text-xs">Outlet Name *</Label><Input value={priceFormData.outletName || ''} onChange={e => setPriceFormData(p => ({ ...p, outletName: e.target.value }))} className="h-8 text-sm" /></div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label className="text-xs">Base Price ($) *</Label><Input type="number" step="0.01" value={priceFormData.basePrice || ''} onChange={e => setPriceFormData(p => ({ ...p, basePrice: Number(e.target.value) }))} className="h-8 text-sm" /></div>
              <div className="space-y-2"><Label className="text-xs">Tax Rate (%)</Label><Input type="number" value={priceFormData.taxRate || ''} onChange={e => setPriceFormData(p => ({ ...p, taxRate: Number(e.target.value) }))} className="h-8 text-sm" /></div>
              <div className="space-y-2"><Label className="text-xs">Effective From *</Label><Input type="date" value={priceFormData.effectiveFrom || ''} onChange={e => setPriceFormData(p => ({ ...p, effectiveFrom: e.target.value }))} className="h-8 text-sm" /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setPriceFormOpen(false)}>Cancel</Button><Button size="sm" onClick={handlePriceSave}>{priceEditId ? 'Update' : 'Create'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promo Form */}
      <Dialog open={promoFormOpen} onOpenChange={setPromoFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{promoEditId ? 'Edit Promotion' : 'New Promotion'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-xs">Code *</Label><Input value={promoFormData.code || ''} onChange={e => setPromoFormData(p => ({ ...p, code: e.target.value.toUpperCase() }))} className="h-8 text-sm font-mono" /></div>
              <div className="space-y-2"><Label className="text-xs">Name *</Label><Input value={promoFormData.name || ''} onChange={e => setPromoFormData(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm" /></div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Type</Label>
                <Select value={promoFormData.type || 'percentage'} onValueChange={v => setPromoFormData(p => ({ ...p, type: v as Promotion['type'] }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="percentage">% Off</SelectItem><SelectItem value="fixed">$ Off</SelectItem><SelectItem value="bogo">BOGO</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label className="text-xs">Value</Label><Input type="number" value={promoFormData.value || ''} onChange={e => setPromoFormData(p => ({ ...p, value: Number(e.target.value) }))} className="h-8 text-sm" /></div>
              <div className="space-y-2">
                <Label className="text-xs">Status</Label>
                <Select value={promoFormData.status || 'active'} onValueChange={v => setPromoFormData(p => ({ ...p, status: v as Promotion['status'] }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-xs">From</Label><Input type="date" value={promoFormData.effectiveFrom || ''} onChange={e => setPromoFormData(p => ({ ...p, effectiveFrom: e.target.value }))} className="h-8 text-sm" /></div>
              <div className="space-y-2"><Label className="text-xs">To</Label><Input type="date" value={promoFormData.effectiveTo || ''} onChange={e => setPromoFormData(p => ({ ...p, effectiveTo: e.target.value }))} className="h-8 text-sm" /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setPromoFormOpen(false)}>Cancel</Button><Button size="sm" onClick={handlePromoSave}>{promoEditId ? 'Update' : 'Create'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Availability Form */}
      <Dialog open={availFormOpen} onOpenChange={setAvailFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{availEditId ? 'Edit Availability Rule' : 'New Availability Rule'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-xs">Product *</Label><Input value={availFormData.productName || ''} onChange={e => setAvailFormData(p => ({ ...p, productName: e.target.value }))} className="h-8 text-sm" /></div>
              <div className="space-y-2"><Label className="text-xs">Outlet *</Label><Input value={availFormData.outletName || ''} onChange={e => setAvailFormData(p => ({ ...p, outletName: e.target.value }))} className="h-8 text-sm" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Available</Label>
                <Select value={availFormData.available ? 'true' : 'false'} onValueChange={v => setAvailFormData(p => ({ ...p, available: v === 'true' }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="true">Available</SelectItem><SelectItem value="false">Blocked</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label className="text-xs">Effective From</Label><Input type="date" value={availFormData.effectiveFrom || ''} onChange={e => setAvailFormData(p => ({ ...p, effectiveFrom: e.target.value }))} className="h-8 text-sm" /></div>
            </div>
            <div className="space-y-2"><Label className="text-xs">Reason</Label><Input value={availFormData.reason || ''} onChange={e => setAvailFormData(p => ({ ...p, reason: e.target.value }))} className="h-8 text-sm" /></div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setAvailFormOpen(false)}>Cancel</Button><Button size="sm" onClick={handleAvailSave}>{availEditId ? 'Update' : 'Create'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Confirm Delete</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure? This action cannot be undone.</p>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
