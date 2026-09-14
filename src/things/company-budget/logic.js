// remainingBudget is always monthlyBudget - monthlySpent, so it is computed on
// read rather than stored — a warehouse order updates monthlySpent (a cross-Thing
// effect) and remainingBudget follows with no second write to keep in sync.

thing.setPropertyReadHandler('monthlyBudget', async () => state.monthlyBudget);
thing.setPropertyReadHandler('monthlySpent', async () => state.monthlySpent);
thing.setPropertyReadHandler('remainingBudget', async () => state.monthlyBudget - state.monthlySpent);
