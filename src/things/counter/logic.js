function parseStep(uriVariables, defaultValue = 1) {
  if (!uriVariables || !("step" in uriVariables)) {
    return defaultValue;
  }
  
  const stepValue = Number(uriVariables.step);
  if (!isNaN(stepValue) && isFinite(stepValue)) {
    return stepValue;
  }
  
  console.warn(`Invalid step value: ${uriVariables.step}, using default: ${defaultValue}`);
  return defaultValue;
}

thing.setPropertyReadHandler("count", async () => state.count);
thing.setPropertyReadHandler("lastChange", async () => state.lastChange);

thing.setActionHandler("increment", async (params, options) => {
  const step = parseStep(options?.uriVariables);
  const newValue = state.count + step;
  state.count = newValue;
  state.lastChange = new Date().toISOString();
  thing.emitEvent("change", state.count);
  thing.emitPropertyChange("count");
  return undefined;
});

thing.setActionHandler("decrement", async (params, options) => {
  const step = parseStep(options?.uriVariables);
  const newValue = state.count - step;
  state.count = newValue;
  state.lastChange = new Date().toISOString();
  thing.emitEvent("change", state.count);
  thing.emitPropertyChange("count");
  return undefined;
});

thing.setActionHandler("reset", async () => {
  state.count = 0;
  state.lastChange = new Date().toISOString();
  thing.emitEvent("change", state.count);
  thing.emitPropertyChange("count");
  return undefined;
});