import { apiRequest } from './client';

export type KitchenTicketStatus = 'new' | 'in_progress' | 'ready' | 'served' | 'cancelled';
export type KitchenItemStatus = 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';

export interface KitchenTicketItem {
  id: string;
  productId: string;
  productName: string;
  qty: string | number;
  status: KitchenItemStatus;
  modifiers?: { entries?: { name?: string; value?: string }[] } | null;
  allergens?: string[];
  notes?: string | null;
  startedAt?: string | null;
  readyAt?: string | null;
  servedAt?: string | null;
}

export interface KitchenTicket {
  id: string;
  saleId: string;
  outletId: string;
  orderingTableId?: string | null;
  orderingTableCode?: string | null;
  orderingTableName?: string | null;
  orderType?: string | null;
  status: KitchenTicketStatus;
  prepSlaSeconds: number;
  notes?: string | null;
  slaBreached: boolean;
  createdAt: string;
  startedAt?: string | null;
  readyAt?: string | null;
  servedAt?: string | null;
  items: KitchenTicketItem[];
}

export interface KitchenTicketListResponse {
  outletId: string;
  tickets: KitchenTicket[];
}

export const kitchenApi = {
  listTickets: (token: string, outletId: string) =>
    apiRequest<KitchenTicketListResponse>('/api/v1/sales/kitchen/tickets', {
      token,
      query: { outletId },
    }),
  advanceItemStatus: (
    token: string,
    ticketId: string,
    itemId: string,
    status: KitchenItemStatus,
  ) =>
    apiRequest<KitchenTicket>(
      `/api/v1/sales/kitchen/tickets/${ticketId}/items/${itemId}/status`,
      { method: 'PATCH', token, body: { status } },
    ),
  setTicketStatus: (
    token: string,
    ticketId: string,
    status: KitchenTicketStatus,
  ) =>
    apiRequest<KitchenTicket>(`/api/v1/sales/kitchen/tickets/${ticketId}/status`, {
      method: 'PATCH',
      token,
      body: { status },
    }),
};
