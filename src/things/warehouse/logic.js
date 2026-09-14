// The warehouse wires its own reads. utilizationPercent is derived from the
// current stock and capacity, so it is always consistent after any stock change
// (including a cross-Thing transfer into this warehouse) without a second write.
// orderStock/transferStock come from the TD's `vre:effects`.

thing.setPropertyReadHandler('currentStock', async () => state.currentStock);
thing.setPropertyReadHandler('capacity', async () => state.capacity);
thing.setPropertyReadHandler('orderCounter', async () => state.orderCounter);
thing.setPropertyReadHandler('utilizationPercent', async () =>
  state.capacity ? (state.currentStock / state.capacity) * 100 : 0
);
