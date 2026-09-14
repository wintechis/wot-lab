// The home wires its own reads. isPeakHour is derived from the controllable
// clock (via the injected __clockHour), so a benchmark pins or advances the
// clock to make peak-hour behaviour deterministic. currentPowerUsageW is kept up
// to date by the appliances (cross-Thing effects); setBudget comes from the TD's
// `vre:effects`.

thing.setPropertyReadHandler('currentMonthUsageKWh', async () => state.currentMonthUsageKWh);
thing.setPropertyReadHandler('monthlyBudgetKWh', async () => state.monthlyBudgetKWh);
thing.setPropertyReadHandler('currentPowerUsageW', async () => state.currentPowerUsageW);
thing.setPropertyReadHandler('isPeakHour', async () => {
  const hour = __clockHour();
  return hour >= 17 && hour < 21;
});
