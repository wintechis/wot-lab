const { debug } = createLoggers("simulation", "brightness");

// Property read handlers
thing.setPropertyReadHandler("brightness", async () => state.brightness);
thing.setPropertyReadHandler("lastUpdated", async () => state.lastUpdated);

// Get Thing ID for endpoint registration
const thingId = thing.getThingDescription().id?.replace('urn:wot:', '') || 'brightness';

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
  
  debug(`💡 Brightness updated: ${oldBrightness} → ${state.brightness} lux (source: ${source})`);
  
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

// Register HTTP endpoints with simulation API
registerThingEndpoint(thingId, 'GET', '/brightness', (req, res) => {
  res.json({
    success: true,
    message: "Current brightness reading",
    data: {
      brightness: state.brightness,
      lastUpdated: state.lastUpdated,
      unit: "lux"
    }
  });
});

registerThingEndpoint(thingId, 'PUT', '/brightness', (req, res) => {
  try {
    const newBrightness = req.body.brightness;
    
    if (newBrightness === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing brightness value in request body'
      });
    }
    
    const result = updateBrightness(newBrightness, 'http-put');
    res.json(result);
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

registerThingEndpoint(thingId, 'POST', '/brightness', (req, res) => {
  try {
    const newBrightness = req.body.brightness;
    
    if (newBrightness === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing brightness value in request body'
      });
    }
    
    const result = updateBrightness(newBrightness, 'http-post');
    res.json(result);
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

registerThingEndpoint(thingId, 'GET', '/brightness/:value', (req, res) => {
  try {
    const newBrightness = parseFloat(req.params.value);
    
    if (isNaN(newBrightness)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid brightness value in URL parameter'
      });
    }
    
    const result = updateBrightness(newBrightness, 'http-url-param');
    res.json(result);
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

debug(`💡 Brightness sensor simulation endpoints registered for /api/v1/things/${thingId}`);
