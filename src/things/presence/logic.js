// Track presence session start time for duration calculation
let presenceStartTime = null;

// Property read handlers
thing.setPropertyReadHandler("isPresent", async () => state.isPresent);
thing.setPropertyReadHandler("lastDetection", async () => state.lastDetection);
thing.setPropertyReadHandler("detectionCount", async () => state.detectionCount);

const { debug } = createLoggers("simulation", "presence");

// Helper function to trigger presence
function triggerPresence() {
  const timestamp = new Date().toISOString();
  
  if (!state.isPresent) {
    state.isPresent = true;
    state.lastDetection = timestamp;
    state.detectionCount += 1;
    presenceStartTime = Date.now();
    
    // Emit presence event
    thing.emitEvent("presence", {
      timestamp,
      count: state.detectionCount
    });
    
    // Notify property changes
    thing.emitPropertyChange("isPresent");
    thing.emitPropertyChange("lastDetection");
    thing.emitPropertyChange("detectionCount");
    
    debug(`Presence detected (count: ${state.detectionCount})`);
  }
  
  return {
    success: true,
    message: "Presence detected",
    data: { isPresent: state.isPresent, timestamp, count: state.detectionCount }
  };
}

// Helper function to trigger absence
function triggerAbsence() {
  const timestamp = new Date().toISOString();
  let duration = 0;
  
  if (state.isPresent) {
    state.isPresent = false;
    state.lastDetection = timestamp;
    
    // Calculate presence duration
    if (presenceStartTime) {
      duration = Math.round((Date.now() - presenceStartTime) / 1000);
      presenceStartTime = null;
    }
    
    // Emit absence event
    thing.emitEvent("absence", {
      timestamp,
      duration
    });
    
    // Notify property changes
    thing.emitPropertyChange("isPresent");
    thing.emitPropertyChange("lastDetection");
    
    debug(`Absence detected (was present for ${duration}s)`);
  }
  
  return {
    success: true,
    message: "Absence detected",
    data: { isPresent: state.isPresent, timestamp, duration }
  };
}

debug("Presence sensor initialized.");
