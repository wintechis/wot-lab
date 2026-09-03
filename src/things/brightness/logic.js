const { debug } = createLoggers("simulation", "brightness");

// Property read handlers
thing.setPropertyReadHandler("brightness", async () => state.brightness);
thing.setPropertyReadHandler("lastUpdated", async () => state.lastUpdated);

// Helper function to update brightness
function updateBrightness(newBrightness, source = 'http') {
  // Validate brightness range
  if (typeof newBrightness !== 'number' || newBrightness < 0 || newBrightness > 100000) {
    throw new Error(`Invalid brightness value: ${newBrightness}. Must be a number between 0 and 100000 lux.`);
  }

  const timestamp = new Date().toISOString();
  const oldBrightness = state.brightness;
  
  // Update state
  state.brightness = Math.round(newBrightness * 10) / 10; // Round to 1 decimal place
  state.lastUpdated = timestamp;
  
  // Emit property changes only
  thing.emitPropertyChange("brightness");
  thing.emitPropertyChange("lastUpdated");
  
  debug(`Brightness updated: ${oldBrightness} -> ${state.brightness} lux (source: ${source})`);
  
  return {
    success: true,
    message: "Brightness updated successfully",
    data: {
      brightness: state.brightness,
      timestamp,
      source
    }
  };
}

debug("Brightness sensor initialized.");
