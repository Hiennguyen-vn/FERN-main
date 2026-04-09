import { useState } from 'react';
import { Search, Plus, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { mockIngredients, mockUnits, mockConversions, INGREDIENT_CATEGORY_CONFIG } from '@/data/mock-catalog';
import type { Ingredient, UnitOfMeasure, UnitConversion, IngredientCategory } from '@/types/catalog';
import { toast } from 'sonner';

type SubTab = 'ingredients' | 'units' | 'conversions';

const emptyIngredient = (): Partial<Ingredient> => ({
  name: '', code: '', category: 'produce', defaultUnit: 'kg', costPerUnit: 0, trackInventory: true, allergens: [],
});
const emptyUnit = (): Partial<UnitOfMeasure> => ({ name: '', code: '', type: 'weight', baseUnit: false });
const emptyConversion = (): Partial<UnitConversion> => ({ fromUnit: '', toUnit: '', factor: 1 });

export function IngredientModule() {
  const [subTab, setSubTab] = useState<SubTab>('ingredients');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');

  // Ingredients state
  const [ingredients, setIngredients] = useState<Ingredient[]>(mockIngredients);
  const [ingFormOpen, setIngFormOpen] = useState(false);
  const [ingFormData, setIngFormData] = useState<Partial<Ingredient>>(emptyIngredient());
  const [ingEditId, setIngEditId] = useState<string | null>(null);
  const [ingDeleteId, setIngDeleteId] = useState<string | null>(null);

  // Units state
  const [units, setUnits] = useState<UnitOfMeasure[]>(mockUnits);
  const [unitFormOpen, setUnitFormOpen] = useState(false);
  const [unitFormData, setUnitFormData] = useState<Partial<UnitOfMeasure>>(emptyUnit());
  const [unitEditId, setUnitEditId] = useState<string | null>(null);

  // Conversions state
  const [conversions, setConversions] = useState<UnitConversion[]>(mockConversions);
  const [convFormOpen, setConvFormOpen] = useState(false);
  const [convFormData, setConvFormData] = useState<Partial<UnitConversion>>(emptyConversion());
  const [convEditId, setConvEditId] = useState<string | null>(null);

  // Ingredient CRUD
  const openIngCreate = () => { setIngFormData(emptyIngredient()); setIngEditId(null); setIngFormOpen(true); };
  const openIngEdit = (ing: Ingredient) => { setIngFormData({ ...ing }); setIngEditId(ing.id); setIngFormOpen(true); };
  const handleIngSave = () => {
    if (!ingFormData.name || !ingFormData.code) { toast.error('Name and Code are required'); return; }
    if (ingEditId) {
      setIngredients(prev => prev.map(i => i.id === ingEditId ? { ...i, ...ingFormData } as Ingredient : i));
      toast.success('Ingredient updated');
    } else {
      setIngredients(prev => [{ ...ingFormData as Ingredient, id: `ing-${Date.now()}`, createdAt: new Date().toISOString().split('T')[0] }, ...prev]);
      toast.success('Ingredient created');
    }
    setIngFormOpen(false);
  };
  const handleIngDelete = (id: string) => { setIngredients(prev => prev.filter(i => i.id !== id)); setIngDeleteId(null); toast.success('Ingredient deleted'); };

  // Unit CRUD
  const openUnitCreate = () => { setUnitFormData(emptyUnit()); setUnitEditId(null); setUnitFormOpen(true); };
  const openUnitEdit = (u: UnitOfMeasure) => { setUnitFormData({ ...u }); setUnitEditId(u.id); setUnitFormOpen(true); };
  const handleUnitSave = () => {
    if (!unitFormData.name || !unitFormData.code) { toast.error('Name and Code are required'); return; }
    if (unitEditId) {
      setUnits(prev => prev.map(u => u.id === unitEditId ? { ...u, ...unitFormData } as UnitOfMeasure : u));
      toast.success('Unit updated');
    } else {
      setUnits(prev => [{ ...unitFormData as UnitOfMeasure, id: `u-${Date.now()}` }, ...prev]);
      toast.success('Unit created');
    }
    setUnitFormOpen(false);
  };

  // Conversion CRUD
  const openConvCreate = () => { setConvFormData(emptyConversion()); setConvEditId(null); setConvFormOpen(true); };
  const openConvEdit = (c: UnitConversion) => { setConvFormData({ ...c }); setConvEditId(c.id); setConvFormOpen(true); };
  const handleConvSave = () => {
    if (!convFormData.fromUnit || !convFormData.toUnit) { toast.error('From and To units are required'); return; }
    if (convEditId) {
      setConversions(prev => prev.map(c => c.id === convEditId ? { ...c, ...convFormData } as UnitConversion : c));
      toast.success('Conversion updated');
    } else {
      setConversions(prev => [{ ...convFormData as UnitConversion, id: `cv-${Date.now()}` }, ...prev]);
      toast.success('Conversion created');
    }
    setConvFormOpen(false);
  };

  const handleNew = () => {
    if (subTab === 'ingredients') openIngCreate();
    else if (subTab === 'units') openUnitCreate();
    else openConvCreate();
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Ingredients & Units of Measure</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Reference data for recipes and inventory tracking</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleNew}>
          <Plus className="h-3.5 w-3.5" /> {subTab === 'ingredients' ? 'New Ingredient' : subTab === 'units' ? 'New Unit' : 'New Conversion'}
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b">
        {([{ key: 'ingredients' as SubTab, label: 'Ingredients' }, { key: 'units' as SubTab, label: 'Units of Measure' }, { key: 'conversions' as SubTab, label: 'Conversions' }]).map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} className={cn('px-3 py-2 text-xs font-medium border-b-2 transition-colors', subTab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>{t.label}</button>
        ))}
      </div>

      {subTab === 'ingredients' && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search ingredients…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {['all', 'produce', 'protein', 'dairy', 'dry-goods', 'beverage', 'spice'].map(c => (
                <button key={c} onClick={() => setCatFilter(c)} className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors capitalize', catFilter === c ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border')}>{c === 'all' ? 'All' : c.replace('-', ' ')}</button>
              ))}
            </div>
          </div>
          <div className="surface-elevated overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Code', 'Ingredient Name', 'Category', 'Default Unit', 'Cost/Unit', 'Allergens', 'Tracked', ''].map(h => (
                    <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Cost/Unit' ? 'text-right' : h === 'Tracked' ? 'text-center' : 'text-left')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ingredients
                  .filter(i => catFilter === 'all' || i.category === catFilter)
                  .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))
                  .map(ing => {
                    const catCfg = INGREDIENT_CATEGORY_CONFIG[ing.category];
                    return (
                      <tr key={ing.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 text-sm font-medium text-primary font-mono">{ing.code}</td>
                        <td className="px-4 py-2.5 text-sm font-medium text-foreground">{ing.name}</td>
                        <td className="px-4 py-2.5"><span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', catCfg?.class)}>{catCfg?.label}</span></td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{ing.defaultUnit}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">${ing.costPerUnit.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{ing.allergens?.join(', ') || '—'}</td>
                        <td className="px-4 py-2.5 text-center">{ing.trackInventory ? <span className="text-success text-xs">●</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1">
                            <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => openIngEdit(ing)}><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button>
                            <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => setIngDeleteId(ing.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {subTab === 'units' && (
        <div className="surface-elevated overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Code', 'Name', 'Type', 'Base Unit', ''].map(h => (
                  <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Base Unit' ? 'text-center' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {units.map(u => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium text-primary font-mono">{u.code}</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{u.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{u.type}</td>
                  <td className="px-4 py-2.5 text-center">{u.baseUnit ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">Base</span> : <span className="text-xs text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2.5">
                    <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => openUnitEdit(u)}><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'conversions' && (
        <div className="surface-elevated overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['From', 'To', 'Factor', ''].map(h => (
                  <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Factor' ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {conversions.map(c => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium font-mono">{c.fromUnit}</td>
                  <td className="px-4 py-2.5 text-sm font-medium font-mono">{c.toUnit}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">{c.factor}</td>
                  <td className="px-4 py-2.5">
                    <button className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center" onClick={() => openConvEdit(c)}><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Ingredient Form Dialog */}
      <Dialog open={ingFormOpen} onOpenChange={setIngFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{ingEditId ? 'Edit Ingredient' : 'New Ingredient'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-xs">Name *</Label><Input value={ingFormData.name || ''} onChange={e => setIngFormData(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm" /></div>
              <div className="space-y-2"><Label className="text-xs">Code *</Label><Input value={ingFormData.code || ''} onChange={e => setIngFormData(p => ({ ...p, code: e.target.value.toUpperCase() }))} className="h-8 text-sm font-mono" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Category</Label>
                <Select value={ingFormData.category || 'produce'} onValueChange={v => setIngFormData(p => ({ ...p, category: v as IngredientCategory }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(INGREDIENT_CATEGORY_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label className="text-xs">Default Unit</Label><Input value={ingFormData.defaultUnit || ''} onChange={e => setIngFormData(p => ({ ...p, defaultUnit: e.target.value }))} className="h-8 text-sm" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-xs">Cost per Unit ($)</Label><Input type="number" step="0.01" value={ingFormData.costPerUnit || ''} onChange={e => setIngFormData(p => ({ ...p, costPerUnit: Number(e.target.value) }))} className="h-8 text-sm" /></div>
              <div className="space-y-2"><Label className="text-xs">Allergens (comma separated)</Label><Input value={ingFormData.allergens?.join(', ') || ''} onChange={e => setIngFormData(p => ({ ...p, allergens: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} className="h-8 text-sm" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIngFormOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleIngSave}>{ingEditId ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unit Form Dialog */}
      <Dialog open={unitFormOpen} onOpenChange={setUnitFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{unitEditId ? 'Edit Unit' : 'New Unit'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-xs">Code *</Label><Input value={unitFormData.code || ''} onChange={e => setUnitFormData(p => ({ ...p, code: e.target.value }))} className="h-8 text-sm font-mono" /></div>
              <div className="space-y-2"><Label className="text-xs">Name *</Label><Input value={unitFormData.name || ''} onChange={e => setUnitFormData(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm" /></div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Type</Label>
              <Select value={unitFormData.type || 'weight'} onValueChange={v => setUnitFormData(p => ({ ...p, type: v as UnitOfMeasure['type'] }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weight">Weight</SelectItem>
                  <SelectItem value="volume">Volume</SelectItem>
                  <SelectItem value="count">Count</SelectItem>
                  <SelectItem value="length">Length</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setUnitFormOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleUnitSave}>{unitEditId ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conversion Form Dialog */}
      <Dialog open={convFormOpen} onOpenChange={setConvFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{convEditId ? 'Edit Conversion' : 'New Conversion'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="text-xs">From Unit *</Label><Input value={convFormData.fromUnit || ''} onChange={e => setConvFormData(p => ({ ...p, fromUnit: e.target.value }))} className="h-8 text-sm font-mono" /></div>
              <div className="space-y-2"><Label className="text-xs">To Unit *</Label><Input value={convFormData.toUnit || ''} onChange={e => setConvFormData(p => ({ ...p, toUnit: e.target.value }))} className="h-8 text-sm font-mono" /></div>
            </div>
            <div className="space-y-2"><Label className="text-xs">Factor *</Label><Input type="number" step="0.001" value={convFormData.factor || ''} onChange={e => setConvFormData(p => ({ ...p, factor: Number(e.target.value) }))} className="h-8 text-sm" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConvFormOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleConvSave}>{convEditId ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Ingredient Confirm */}
      <Dialog open={!!ingDeleteId} onOpenChange={() => setIngDeleteId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Confirm Delete</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure? This ingredient may be used in recipes.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIngDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => ingDeleteId && handleIngDelete(ingDeleteId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
