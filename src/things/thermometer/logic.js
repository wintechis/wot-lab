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
  
  debug(`🌡️ Temperature updated: ${oldTemp} → ${state.temperature} °C (source: ${source})`);
  
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

// Get Thing ID for endpoint registration
const thingId = thing.getThingDescription().id?.replace('urn:wot:', '') || 'thermometer';

// Register HTTP endpoint with simulation API
registerThingEndpoint(thingId, 'PUT', '/thermometer', (req, res) => {
  try {
    const newTemp = req.body.temperature;

    if (newTemp === undefined) {
      return res.status(400).json({
        success: false,
        message: "Missing 'temperature' in request body"
      });
    }

    if (typeof newTemp !== 'number' || newTemp < 0 || newTemp > 40) {
      return res.status(400).json({
        success: false,
        message: "Invalid temperature value. Must be a number between 0 and 40 °C"
      });
    }

    const result = updateTemperature(newTemp, 'http');
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

debug(`🌡️ Thermometer simulation endpoint registered for ${thingId}`);
debug("🌡️ Thermometer simulation initialized.");
