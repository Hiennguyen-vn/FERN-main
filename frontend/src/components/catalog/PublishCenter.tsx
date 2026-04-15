import { useCallback, useEffect, useState } from 'react';
import {
  Rocket, Plus, Send, CheckCircle2, XCircle, Clock, RotateCcw,
  Trash2, Loader2, RefreshCw, ChevronRight, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  productApi,
  type PublishVersionView, type PublishItemView, type ProductView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { StatusBadge } from '@/components/catalog/StatusBadge';
import { ImpactCard, DiffBlock, ScopePill } from '@/components/catalog/shared';

type SubTab = 'workspace' | 'review' | 'history';

interface PublishCenterProps {
  token: string;
}

export function PublishCenter({ token }: PublishCenterProps) {
  const [subTab, setSubTab] = useState<SubTab>('workspace');
  const [versions, setVersions] = useState<PublishVersionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<PublishVersionView | null>(null);
  const [items, setItems] = useState<PublishItemView[]>([]);

  // Create form
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });

  // Add item form
  const [addingItem, setAddingItem] = useState(false);
  const [itemForm, setItemForm] = useState({ entityType: 'price', entityId: '', changeType: 'update', summary: '', scopeType: '', scopeId: '' });
  const [products, setProducts] = useState<ProductView[]>([]);

  const [busy, setBusy] = useState('');

  const loadVersions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setVersions(await productApi.publishVersions(token, { limit: 100 }));
    } catch (e) { toast.error(getErrorMessage(e, 'Failed to load')); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);

  useEffect(() => {
    if (!selectedId || !token) { setSelectedVersion(null); setItems([]); return; }
    (async () => {
      try {
        const [v, i] = await Promise.all([
          productApi.publishVersion(token, selectedId),
          productApi.publishItems(token, selectedId),
        ]);
        setSelectedVersion(v);
        setItems(i);
      } catch { setSelectedVersion(null); setItems([]); }
    })();
  }, [selectedId, token, versions]);

  const handleCreate = async () => {
    if (!createForm.name.trim()) { toast.error('Name required'); return; }
    setBusy('create');
    try {
      const v = await productApi.createPublishVersion(token, createForm);
      toast.success('Draft created');
      setCreating(false);
      setCreateForm({ name: '', description: '' });
      void loadVersions();
      setSelectedId(String(v.id));
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleAddItem = async () => {
    if (!selectedId || !itemForm.entityId || !itemForm.summary) { toast.error('Fill all fields'); return; }
    setBusy('add-item');
    try {
      await productApi.addPublishItem(token, selectedId, itemForm);
      toast.success('Change added');
      setAddingItem(false);
      setItemForm({ entityType: 'price', entityId: '', changeType: 'update', summary: '' });
      void loadVersions();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleRemoveItem = async (itemId: string) => {
    setBusy(`rm:${itemId}`);
    try { await productApi.removePublishItem(token, itemId); toast.success('Removed'); void loadVersions(); }
    catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleSubmit = async () => {
    if (!selectedId) return;
    setBusy('submit');
    try { await productApi.submitForReview(token, selectedId); toast.success('Submitted for review'); void loadVersions(); }
    catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleReview = async (decision: string) => {
    if (!selectedId) return;
    setBusy('review');
    try { await productApi.reviewDecision(token, selectedId, decision); toast.success(decision === 'approve' ? 'Approved' : 'Rejected'); void loadVersions(); }
    catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handlePublish = async () => {
    if (!selectedId) return;
    setBusy('publish');
    try { await productApi.publishVersion_publish(token, selectedId); toast.success('Published!'); void loadVersions(); }
    catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleRollback = async () => {
    if (!selectedId) return;
    setBusy('rollback');
    try { await productApi.rollbackVersion(token, selectedId, 'Manual rollback'); toast.success('Rolled back'); void loadVersions(); }
    catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const drafts = versions.filter(v => v.status === 'draft');
  const inReview = versions.filter(v => v.status === 'review');
  const history = versions.filter(v => !['draft', 'review'].includes(v.status));

  const displayVersions = subTab === 'workspace' ? drafts : subTab === 'review' ? inReview : history;

  // Impact stats for selected version
  const impactItems = items.length > 0 ? [
    { label: 'Changes', count: items.length },
    { label: 'Products', count: new Set(items.filter(i => i.entityType === 'product').map(i => i.entityId)).size },
    { label: 'Prices', count: items.filter(i => i.entityType === 'price').length },
    { label: 'Other', count: items.filter(i => !['product', 'price'].includes(i.entityType)).length },
  ] : [];

  const SUB_TABS: { key: SubTab; label: string; count: number }[] = [
    { key: 'workspace', label: 'Draft Workspace', count: drafts.length },
    { key: 'review', label: 'Review Queue', count: inReview.length },
    { key: 'history', label: 'History', count: history.length },
  ];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Sub-tab bar */}
      <div className="border-b px-5 flex items-center gap-0 flex-shrink-0">
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => { setSubTab(t.key); setSelectedId(null); }}
            className={cn('px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors',
              subTab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.label}
            {t.count > 0 && <span className="ml-1.5 text-[10px] bg-muted rounded-full px-1.5">{t.count}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => void loadVersions()} disabled={loading} className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </button>
          <button onClick={() => setCreating(true)} className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1">
            <Plus className="h-3 w-3" />New Draft
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: version list */}
        <div className="w-80 border-r flex flex-col flex-shrink-0 overflow-hidden">
          {creating && (
            <div className="px-3 py-3 border-b space-y-2 bg-muted/20">
              <input className="h-7 w-full rounded border border-input bg-background px-2 text-xs" placeholder="Draft name" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
              <input className="h-7 w-full rounded border border-input bg-background px-2 text-xs" placeholder="Description (optional)" value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} />
              <div className="flex gap-1">
                <button onClick={() => void handleCreate()} disabled={!!busy} className="h-6 px-2 rounded bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-60">Create</button>
                <button onClick={() => setCreating(false)} className="h-6 px-2 rounded border text-[10px]">Cancel</button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {loading && displayVersions.length === 0 ? (
              <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : displayVersions.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                {subTab === 'workspace' ? 'No drafts. Create one to start.' : subTab === 'review' ? 'No versions pending review.' : 'No publish history.'}
              </p>
            ) : displayVersions.map(v => (
              <button key={String(v.id)} onClick={() => setSelectedId(String(v.id))}
                className={cn('w-full px-4 py-3 text-left border-b hover:bg-muted/20 transition-colors',
                  selectedId === String(v.id) && 'bg-primary/5 border-l-2 border-l-primary')}>
                <p className="text-xs font-medium truncate">{v.name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <StatusBadge status={v.status} />
                  <span className="text-[10px] text-muted-foreground">{v.itemCount} changes</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-y-auto">
          {!selectedVersion ? (
            <div className="flex-1 flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center"><Rocket className="h-8 w-8 mx-auto mb-2 opacity-20" /><p className="text-xs">Select a version</p></div>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{selectedVersion.name}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={selectedVersion.status} />
                    <span className="text-[10px] text-muted-foreground">{items.length} changes</span>
                    {selectedVersion.publishedAt && <span className="text-[10px] text-muted-foreground">published {new Date(selectedVersion.publishedAt).toLocaleString()}</span>}
                  </div>
                  {selectedVersion.description && <p className="text-xs text-muted-foreground mt-1">{selectedVersion.description}</p>}
                  {selectedVersion.reviewNote && (
                    <p className="text-xs text-muted-foreground mt-1 italic">Review note: {selectedVersion.reviewNote}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {selectedVersion.status === 'draft' && (
                    <button onClick={handleSubmit} disabled={!!busy || items.length === 0} className="h-7 px-2.5 rounded-md bg-blue-600 text-white text-[10px] font-medium inline-flex items-center gap-1 disabled:opacity-60">
                      <Send className="h-3 w-3" />Submit Review
                    </button>
                  )}
                  {selectedVersion.status === 'review' && (
                    <>
                      <button onClick={() => void handleReview('approve')} disabled={!!busy} className="h-7 px-2.5 rounded-md bg-emerald-600 text-white text-[10px] font-medium inline-flex items-center gap-1 disabled:opacity-60">
                        <CheckCircle2 className="h-3 w-3" />Approve
                      </button>
                      <button onClick={() => void handleReview('reject')} disabled={!!busy} className="h-7 px-2.5 rounded-md border text-[10px] inline-flex items-center gap-1 disabled:opacity-60">
                        <XCircle className="h-3 w-3" />Reject
                      </button>
                    </>
                  )}
                  {selectedVersion.status === 'approved' && (
                    <button onClick={handlePublish} disabled={!!busy} className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1 disabled:opacity-60">
                      <Rocket className="h-3 w-3" />Publish Now
                    </button>
                  )}
                  {selectedVersion.status === 'published' && (
                    <button onClick={handleRollback} disabled={!!busy} className="h-7 px-2.5 rounded-md border border-rose-200 text-rose-600 text-[10px] font-medium inline-flex items-center gap-1 disabled:opacity-60">
                      <RotateCcw className="h-3 w-3" />Rollback
                    </button>
                  )}
                </div>
              </div>

              {/* Impact */}
              {impactItems.length > 0 && <ImpactCard items={impactItems} />}

              {/* Changes */}
              <div className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
                  <p className="text-xs font-semibold">Changes ({items.length})</p>
                  {selectedVersion.status === 'draft' && (
                    <button onClick={() => setAddingItem(true)} className="h-6 px-2 rounded border text-[10px] inline-flex items-center gap-1 hover:bg-accent">
                      <Plus className="h-3 w-3" />Add Change
                    </button>
                  )}
                </div>

                {addingItem && (
                  <div className="px-4 py-3 border-b bg-muted/10 space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                      <select className="h-7 rounded border border-input bg-background px-1 text-xs" value={itemForm.entityType} onChange={e => setItemForm(f => ({ ...f, entityType: e.target.value }))}>
                        <option value="product">product</option><option value="recipe">recipe</option>
                        <option value="price">price</option><option value="availability">availability</option>
                        <option value="menu_assignment">menu</option>
                      </select>
                      <input className="h-7 rounded border border-input bg-background px-2 text-xs font-mono" placeholder="Entity ID" value={itemForm.entityId} onChange={e => setItemForm(f => ({ ...f, entityId: e.target.value }))} />
                      <select className="h-7 rounded border border-input bg-background px-1 text-xs" value={itemForm.changeType} onChange={e => setItemForm(f => ({ ...f, changeType: e.target.value }))}>
                        <option value="create">create</option><option value="update">update</option><option value="delete">delete</option>
                      </select>
                      <input className="h-7 rounded border border-input bg-background px-2 text-xs" placeholder="Summary" value={itemForm.summary} onChange={e => setItemForm(f => ({ ...f, summary: e.target.value }))} />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => void handleAddItem()} disabled={!!busy} className="h-6 px-2 rounded bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-60">Add</button>
                      <button onClick={() => setAddingItem(false)} className="h-6 px-2 rounded border text-[10px]">Cancel</button>
                    </div>
                  </div>
                )}

                {items.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">No changes in this version</p>
                ) : (
                  <div className="divide-y">
                    {items.map((item, idx) => (
                      <div key={String(item.id)} className="px-4 py-2.5 flex items-center gap-3 hover:bg-muted/10">
                        <span className="text-[10px] text-muted-foreground w-5 text-right">{idx + 1}</span>
                        <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs">{item.summary}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn('text-[10px] font-mono px-1 rounded',
                              item.changeType === 'create' ? 'bg-emerald-50 text-emerald-700' :
                              item.changeType === 'delete' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'
                            )}>{item.changeType}</span>
                            <span className="text-[10px] text-muted-foreground">{item.entityType}</span>
                            {item.scopeType && <ScopePill level={item.scopeType as 'outlet' | 'region' | 'corporate'} label={`${item.scopeType} ${item.scopeId || ''}`} />}
                          </div>
                        </div>
                        {selectedVersion.status === 'draft' && (
                          <button onClick={() => void handleRemoveItem(String(item.id))} disabled={busy === `rm:${item.id}`}
                            className="h-6 w-6 rounded border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-60">
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Diff preview for items with snapshots */}
              {items.filter(i => i.beforeSnapshot || i.afterSnapshot).length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Diff Preview</p>
                  {items.filter(i => i.beforeSnapshot || i.afterSnapshot).map(item => (
                    <DiffBlock key={String(item.id)} label={item.summary}
                      before={item.beforeSnapshot} after={item.afterSnapshot} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
