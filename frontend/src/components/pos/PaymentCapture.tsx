import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CreditCard, Banknote, Smartphone, Building2, Ticket,
  Loader2, AlertTriangle, Plus, X, Percent,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PaymentMethod, OrderLineItem } from '@/types/pos';
import { cn } from '@/lib/utils';
import { formatPosCurrency } from '@/components/pos/sale-order-utils';
import { roundMoney, currencyMinorUnits } from '@/lib/money';
import { t } from '@/lib/i18n';

const METHODS: { key: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { key: 'cash', label: 'Cash', icon: Banknote },
  { key: 'card', label: 'Card', icon: CreditCard },
  { key: 'e-wallet', label: 'E-Wallet', icon: Smartphone },
  { key: 'bank-transfer', label: 'Bank Transfer', icon: Building2 },
  { key: 'voucher', label: 'Voucher', icon: Ticket },
];

interface PaymentSplit {
  id: string;
  method: PaymentMethod;
  amount: number;
}

export interface PaymentCompletionPayload {
  paymentMethod: PaymentMethod;
  splits: { method: PaymentMethod; amount: number }[];
  tipAmount: number;
  serviceChargeAmount: number;
  serviceChargePct: number;
  totalCharged: number;
  note: string;
}

interface Props {
  orderTotal: number;
  currencyCode?: string;
  lineItems: OrderLineItem[];
  promoCode: string | null;
  promoDiscount: number;
  subtotal: number;
  taxAmount: number;
  onBack: () => void;
  onComplete: (payload: PaymentCompletionPayload) => Promise<{ ok: boolean; errorMessage?: string }>;
}

const TIP_PRESETS = [0, 5, 10, 15, 20];
const SERVICE_PRESETS = [0, 5, 10];

function makeSplitId() {
  return `split-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function PaymentCapture({
  orderTotal,
  currencyCode,
  lineItems,
  promoCode,
  promoDiscount,
  subtotal,
  taxAmount,
  onBack,
  onComplete,
}: Props) {
  const [serviceChargePct, setServiceChargePct] = useState(0);
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<string>('');

  const serviceChargeAmount = useMemo(
    () => roundMoney(orderTotal * (serviceChargePct / 100), currencyCode),
    [orderTotal, serviceChargePct, currencyCode],
  );
  const tipAmount = useMemo(() => {
    if (tipCustom.trim()) {
      const v = parseFloat(tipCustom);
      return Number.isFinite(v) && v >= 0 ? roundMoney(v, currencyCode) : 0;
    }
    return roundMoney(orderTotal * (tipPct / 100), currencyCode);
  }, [orderTotal, tipPct, tipCustom, currencyCode]);
  const totalCharged = roundMoney(orderTotal + serviceChargeAmount + tipAmount, currencyCode);

  const [splits, setSplits] = useState<PaymentSplit[]>([{ id: makeSplitId(), method: 'cash', amount: totalCharged }]);
  const lastTotalRef = useRef(totalCharged);

  // Auto-balance ONLY if the user hasn't manually edited the single split since the last total.
  // Detection: if the existing single-split amount still equals the previous totalCharged, it's untouched.
  useEffect(() => {
    setSplits((prev) => {
      if (prev.length !== 1) return prev;
      const untouched = Math.abs(prev[0].amount - lastTotalRef.current) < (currencyMinorUnits(currencyCode) === 0 ? 0.5 : 0.005);
      lastTotalRef.current = totalCharged;
      return untouched ? [{ ...prev[0], amount: totalCharged }] : prev;
    });
  }, [totalCharged, currencyCode]);

  const splitsSum = useMemo(
    () => roundMoney(splits.reduce((s, x) => s + (Number.isFinite(x.amount) ? x.amount : 0), 0), currencyCode),
    [splits, currencyCode],
  );
  const splitsDelta = roundMoney(totalCharged - splitsSum, currencyCode);
  // Tolerance: half a minor unit (0.005 for USD, 0.5 for VND).
  const tolerance = currencyMinorUnits(currencyCode) === 0 ? 0.5 : 0.005;
  const splitsBalanced = Math.abs(splitsDelta) < tolerance;

  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  const updateSplit = (id: string, patch: Partial<PaymentSplit>) => {
    setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const addSplit = () => {
    setSplits((prev) => {
      const remaining = roundMoney(
        totalCharged - prev.reduce((s, x) => s + (Number.isFinite(x.amount) ? x.amount : 0), 0),
        currencyCode,
      );
      return [...prev, { id: makeSplitId(), method: 'card', amount: Math.max(0, remaining) }];
    });
  };
  const removeSplit = (id: string) => {
    setSplits((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  };
  const balanceLastSplit = () => {
    setSplits((prev) => {
      if (prev.length === 0) return prev;
      const sumExceptLast = prev.slice(0, -1).reduce((s, x) => s + (Number.isFinite(x.amount) ? x.amount : 0), 0);
      const last = prev[prev.length - 1];
      return [...prev.slice(0, -1), { ...last, amount: roundMoney(totalCharged - sumExceptLast, currencyCode) }];
    });
  };

  const handleConfirm = async () => {
    setProcessing(true);
    setFailedMessage(null);
    try {
      const primary = splits[0]?.method ?? 'cash';
      const noteParts: string[] = [];
      if (splits.length > 1) noteParts.push('SPLIT: ' + splits.map((s) => `${s.method} ${s.amount.toFixed(2)}`).join(' + '));
      if (tipAmount > 0) noteParts.push(`TIP ${tipAmount.toFixed(2)}`);
      if (serviceChargeAmount > 0) noteParts.push(`SERVICE ${serviceChargeAmount.toFixed(2)} (${serviceChargePct}%)`);
      const result = await onComplete({
        paymentMethod: splits.length > 1 ? primary : primary,
        splits: splits.map((s) => ({ method: s.method, amount: s.amount })),
        tipAmount,
        serviceChargeAmount,
        serviceChargePct,
        totalCharged,
        note: noteParts.join(' | '),
      });
      if (!result.ok) {
        setFailedMessage(result.errorMessage || 'Unable to complete payment.');
        setConfirming(false);
      }
    } catch {
      setFailedMessage('Unable to complete payment.');
      setConfirming(false);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3 w-3" /> {t('common.back')}
      </button>

      <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* LEFT: Payment splits + tip + service charge */}
        <div className="md:col-span-3 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">{t('pos.payment.title')}</h2>

          {/* Service charge */}
          <div className="surface-elevated p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground inline-flex items-center gap-1">
                <Percent className="h-3.5 w-3.5" /> {t('pos.payment.service_charge')}
              </span>
              <span className="text-xs font-mono">{formatPosCurrency(serviceChargeAmount, currencyCode)}</span>
            </div>
            <div className="flex gap-1.5">
              {SERVICE_PRESETS.map((pct) => (
                <button
                  key={pct}
                  onClick={() => setServiceChargePct(pct)}
                  className={cn('flex-1 h-7 rounded-md border text-[11px] font-medium transition-colors',
                    serviceChargePct === pct ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent')}
                >
                  {pct === 0 ? t('pos.payment.service_charge.none') : `${pct}%`}
                </button>
              ))}
            </div>
          </div>

          {/* Tip */}
          <div className="surface-elevated p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{t('pos.payment.tip')}</span>
              <span className="text-xs font-mono">{formatPosCurrency(tipAmount, currencyCode)}</span>
            </div>
            <div className="flex gap-1.5">
              {TIP_PRESETS.map((pct) => (
                <button
                  key={pct}
                  onClick={() => { setTipPct(pct); setTipCustom(''); }}
                  className={cn('flex-1 h-7 rounded-md border text-[11px] font-medium transition-colors',
                    tipPct === pct && !tipCustom ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent')}
                >
                  {pct === 0 ? t('pos.payment.tip.none') : `${pct}%`}
                </button>
              ))}
            </div>
            <Input
              type="number"
              min="0"
              step="0.01"
              max={orderTotal * 2}
              placeholder={t('pos.payment.tip.custom')}
              value={tipCustom}
              onChange={(e) => { setTipCustom(e.target.value); setTipPct(0); }}
              className="h-7 text-xs"
              aria-describedby="tip-help"
            />
            {tipCustom && Number(tipCustom) > orderTotal && (
              <p id="tip-help" className="text-[10px] text-warning">
                Tip vượt quá tổng đơn — kiểm tra lại
              </p>
            )}
          </div>

          {/* Splits */}
          <div className="surface-elevated p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{t('pos.payment.split.title')}</span>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={addSplit} disabled={splits.length >= 5}>
                <Plus className="h-3 w-3" /> {t('pos.payment.split.add')}
              </Button>
            </div>
            <div className="space-y-2">
              {splits.map((split, idx) => (
                <div key={split.id} className="flex gap-1.5 items-center">
                  <select
                    value={split.method}
                    onChange={(e) => updateSplit(split.id, { method: e.target.value as PaymentMethod })}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs flex-1"
                  >
                    {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                  <Input
                    type="number"
                    min="0"
                    step={currencyMinorUnits(currencyCode) === 0 ? 1 : 0.01}
                    value={Number.isFinite(split.amount) ? split.amount : 0}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value);
                      const safe = Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed, currencyCode) : 0;
                      updateSplit(split.id, { amount: safe });
                    }}
                    aria-invalid={split.amount > totalCharged}
                    className={cn('h-8 text-xs font-mono w-32 text-right', split.amount > totalCharged && 'border-destructive ring-1 ring-destructive')}
                  />
                  {splits.length > 1 && (
                    <button
                      onClick={() => removeSplit(split.id)}
                      aria-label={`Remove split ${idx + 1}`}
                      className="h-8 w-8 rounded-md border flex items-center justify-center text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className={cn('flex justify-between items-center text-[11px] px-1', !splitsBalanced && 'text-destructive font-medium')}>
              <span>
                Sum: {formatPosCurrency(splitsSum, currencyCode)} / {formatPosCurrency(totalCharged, currencyCode)}
              </span>
              {!splitsBalanced && (
                <button onClick={balanceLastSplit} className="underline text-primary">
                  {t('pos.payment.split.balance')} ({splitsDelta > 0 ? '+' : ''}{splitsDelta.toFixed(2)})
                </button>
              )}
            </div>
          </div>

          {failedMessage && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">{t('pos.payment.failed')}</p>
                <p className="text-xs text-destructive break-words">{failedMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Order summary */}
        <div className="md:col-span-2">
          <div className="surface-elevated p-4 md:sticky md:top-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">{t('pos.payment.summary')}</h3>
            <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
              {lineItems.map((item) => (
                <div key={item.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground truncate flex-1">{item.quantity}× {item.productName}</span>
                  <span className="text-foreground tabular-nums">{formatPosCurrency(item.lineTotal, currencyCode)}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-2 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{t('pos.cart.subtotal')}</span>
                <span className="text-foreground tabular-nums">{formatPosCurrency(subtotal, currencyCode)}</span>
              </div>
              {promoCode && (
                <div className="flex justify-between text-xs text-success">
                  <span>{t('pos.cart.discount')} ({promoCode})</span>
                  <span className="tabular-nums">−{formatPosCurrency(promoDiscount, currencyCode)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{t('pos.cart.tax')}</span>
                <span className="text-foreground tabular-nums">{formatPosCurrency(taxAmount, currencyCode)}</span>
              </div>
              {serviceChargeAmount > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t('pos.payment.service_charge')} ({serviceChargePct}%)</span>
                  <span className="text-foreground tabular-nums">{formatPosCurrency(serviceChargeAmount, currencyCode)}</span>
                </div>
              )}
              {tipAmount > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t('pos.payment.tip')}</span>
                  <span className="text-foreground tabular-nums">{formatPosCurrency(tipAmount, currencyCode)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t">
                <span>{t('pos.cart.total')}</span>
                <span className="tabular-nums">{formatPosCurrency(totalCharged, currencyCode)}</span>
              </div>
            </div>

            {!confirming ? (
              <>
                <Button
                  className="w-full h-9 text-xs mt-3"
                  disabled={!splitsBalanced || splits.some((s) => s.amount < 0) || splits.every((s) => s.amount === 0)}
                  aria-describedby={!splitsBalanced ? 'splits-balance-warn' : undefined}
                  onClick={() => setConfirming(true)}
                >
                  {t('pos.payment.complete')}
                </Button>
                {!splitsBalanced && (
                  <p id="splits-balance-warn" className="mt-1.5 text-xs text-destructive text-center font-medium">
                    Tổng chia chưa khớp — bấm "{t('pos.payment.split.balance')}" để cân đối
                  </p>
                )}
              </>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="p-2.5 rounded-md bg-warning/10 border border-warning/30">
                  <p className="text-[11px] font-medium text-foreground">
                    {t('pos.payment.confirm.title')} {splits.length > 1 ? `(${splits.length} chia)` : ''} {formatPosCurrency(totalCharged, currencyCode)}?
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t('pos.payment.confirm.note')}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
                  <Button size="sm" className="flex-1 h-8 text-xs" disabled={processing} onClick={() => void handleConfirm()}>
                    {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('common.confirm')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
