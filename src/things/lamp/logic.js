thing.setPropertyReadHandler("on", async () => state.on);
thing.setPropertyReadHandler("brightness", async () => state.brightness);

thing.setActionHandler("toggle", async () => {
  state.on = !state.on;
  thing.emitPropertyChange("on");
  return undefined;
});

thing.setActionHandler("setBrightness", async (params) => {
  if (state.on === false) {
    throw new Error("Cannot set brightness when the lamp is off");
  }

  try {
    const newBrightness = await params.value();
    
    if (newBrightness < 0 || newBrightness > 100) {
      throw new Error(`Brightness must be between 0 and 100, got: ${newBrightness}`);
    }
    
    state.brightness = newBrightness;
    thing.emitPropertyChange("brightness");
    
    return undefined;
  } catch (error) {
    console.error("Error in setBrightness action:", error);
    throw error;
  }
});