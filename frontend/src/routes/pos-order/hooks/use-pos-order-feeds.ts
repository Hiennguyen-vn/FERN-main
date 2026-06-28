import type { OrderScope } from './use-orders-feed';
import { useOrdersFeed } from './use-orders-feed';

interface UsePosOrderFeedsArgs {
  outletId: string | null;
  posSessionId: string | null;
  drawerScope: OrderScope | null;
  closeShiftOpen?: boolean;
}

/** Pending unpaid orders are only fetched when the drawer or close-shift UI needs them. */
export function shouldFetchPendingFeed(args: {
  sessionReady: boolean;
  drawerScope: OrderScope | null;
  closeShiftOpen: boolean;
}): boolean {
  return args.sessionReady && (args.drawerScope === 'pending' || args.closeShiftOpen);
}

/** Single entry point for session-scoped today/pending feeds and drawer data. */
export function usePosOrderFeeds({
  outletId,
  posSessionId,
  drawerScope,
  closeShiftOpen = false,
}: UsePosOrderFeedsArgs) {
  const sessionReady = !!posSessionId;
  const pendingEnabled = shouldFetchPendingFeed({ sessionReady, drawerScope, closeShiftOpen });
  const todayFeed = useOrdersFeed(outletId, 'today', sessionReady, posSessionId);
  const pendingFeed = useOrdersFeed(outletId, 'pending', pendingEnabled, posSessionId);
  const activeFeed = drawerScope === 'pending' ? pendingFeed : todayFeed;

  return {
    todayCount: todayFeed.data?.length ?? 0,
    pendingCount: pendingFeed.data?.length ?? 0,
    pendingLoading: pendingEnabled && pendingFeed.isLoading,
    drawerOrders: drawerScope ? (activeFeed.data ?? []) : [],
    drawerLoading: drawerScope ? activeFeed.isLoading : false,
    drawerError: activeFeed.error,
    refetchDrawer: () => activeFeed.refetch(),
    refetchAll: () => {
      void todayFeed.refetch();
      if (pendingEnabled) void pendingFeed.refetch();
    },
  };
}
