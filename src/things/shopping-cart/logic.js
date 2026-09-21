// The cart's price-aware behaviour. addItem/removeItem look a price up in the
// catalog and recompute the total — an array lookup and a sum, which VRE cannot
// express — so they live here, while `checkout` (a cross-Thing effect) is
// generated from the TD's `vre:effects`. A logic.js Thing wires its own reads.

function priceOf(itemId) {
  const product = (state.availableProducts || []).find((p) => p.identifier === itemId);
  return product ? product.price : 0;
}

function recomputeTotal() {
  return (state.items || []).reduce((sum, id) => sum + priceOf(id), 0);
}

thing.setPropertyReadHandler('items', async () => state.items);
thing.setPropertyReadHandler('totalAmount', async () => state.totalAmount);
thing.setPropertyReadHandler('availableProducts', async () => state.availableProducts);

thing.setActionHandler('addItem', async (input) => {
  const { itemId } = await input.value();
  state.items = [...state.items, itemId];
  state.totalAmount = recomputeTotal();
  thing.emitPropertyChange('items');
  thing.emitPropertyChange('totalAmount');
  return { totalAmount: state.totalAmount, itemsCount: state.items.length };
});

thing.setActionHandler('removeItem', async (input) => {
  const { itemId } = await input.value();
  const index = state.items.indexOf(itemId);
  if (index >= 0) {
    state.items = state.items.filter((_, i) => i !== index);
  }
  state.totalAmount = recomputeTotal();
  thing.emitPropertyChange('items');
  thing.emitPropertyChange('totalAmount');
  return { totalAmount: state.totalAmount, itemsCount: state.items.length };
});
