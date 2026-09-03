// @WoTStates initial ¬(t_high & t_low)
const { debug } = createLoggers("simulation", "thermostat");

// Property read handlers
thing.setPropertyReadHandler("temperature", async () => { return state.temperature; });
thing.setPropertyReadHandler("lastUpdated", async () => state.lastUpdated);

// Simulate temperature changes over time
setInterval(() => {
  // Random walk temperature simulation
  const change = (Math.random() * 0.4) - 0.2; // Change between -0.2 and +0.2
  let newTemp = Math.round((state.temperature + change) * 10) / 10; // Round to 1 decimal place
  
  updateTemperature(newTemp, 'simulation');

}, 10000); // Update every 10 seconds

function updateTemperature(newTemp, source = 'http') {
  // Validate temperature range
  if (typeof newTemp !== 'number' || newTemp < 0 || newTemp > 40) {
    throw new Error(`Invalid temperature value: ${newTemp}. Must be a number between 0 and 40 °C.`);
  }

  const timestamp = new Date().toISOString();
  const oldTemp = state.temperature;
  
  // Update state
  state.temperature = Math.round(newTemp * 10) / 10; // Round to 1 decimal place
  state.lastUpdated = timestamp;
  
  // Emit property changes only
  thing.emitPropertyChange("temperature");
  thing.emitPropertyChange("lastUpdated");
  
  debug(`Temperature updated: ${oldTemp} -> ${state.temperature} °C (source: ${source})`);
  
  return {
    success: true,
    message: "Temperature updated successfully",
    data: {
      temperature: state.temperature,
      timestamp,
      source
    }
  };
}

debug("Thermometer simulation initialized.");
