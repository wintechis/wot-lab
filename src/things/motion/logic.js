// @WoTStates initial ¬m
const { debug } = createLoggers("simulation", "motion");

// Property read handlers
thing.setPropertyReadHandler("motionDetected", async () => state.motionDetected);
thing.setPropertyReadHandler("lastMotion", async () => state.lastMotion);
thing.setPropertyReadHandler("activityLevel", async () => state.activityLevel);

// Helper function to trigger motion
function triggerMotion() {
  const timestamp = new Date().toISOString();
  
  if (!state.motionDetected) {
    state.motionDetected = true;
    state.lastMotion = timestamp;
    state.activityLevel += 1;
    
    // Emit motion event
    thing.emitEvent("motion", {
      timestamp,
      level: state.activityLevel
    });
    
    // Notify property changes
    thing.emitPropertyChange("motionDetected");
    thing.emitPropertyChange("lastMotion");
    thing.emitPropertyChange("activityLevel");
    
    debug(`🏃 Motion detected (level: ${state.activityLevel})`);
  }
  
  return {
    success: true,
    message: "Motion detected",
    data: { motionDetected: state.motionDetected, timestamp, level: state.activityLevel }
  };
}

// Helper function to reset motion state
function resetMotion() {
  const timestamp = new Date().toISOString();
  
  if (state.motionDetected) {
    state.motionDetected = false;
    
    // Emit noMotion event
    thing.emitEvent("noMotion", {
      timestamp
    });
    
    // Notify property change
    thing.emitPropertyChange("motionDetected");
    
    debug(`🛑 Motion reset`);
  }
  
  return {
    success: true,
    message: "Motion reset",
    data: { motionDetected: state.motionDetected, timestamp }
  };
}

debug("🏃 Motion sensor initialized.");