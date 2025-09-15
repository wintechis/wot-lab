// @WoTStates initial d
const { debug } = createLoggers("simulation", "door");

// Property read handlers
thing.setPropertyReadHandler("locked", async () => state.locked);
thing.setPropertyReadHandler("lockState", async () => state.lockState);
thing.setPropertyReadHandler("batteryLevel", async () => state.batteryLevel);
thing.setPropertyReadHandler("lastAction", async () => state.lastAction);

// Default security PIN - in a real implementation this would be properly secured
const DEFAULT_PIN = "1234";

// Action handlers
thing.setActionHandler("lock", async (params = {}) => {
  if (state.lockState === "jammed") {
    throw new Error("Door lock is jammed and cannot be operated");
  }
  
  if (state.locked) {
    return { locked: true, lockState: state.lockState };
  }
  
  // Get the method of locking
  const method = params.method || "app";
  
  // Set temporary state while locking
  state.lockState = "locking";
  thing.emitPropertyChange("lockState");
  
  // Simulate lock operation (takes 2 seconds)
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // @WoTStates ¬d -> d
  state.locked = true;
  state.lockState = "locked";
  
  // Update last action
  const timestamp = new Date().toISOString();
  state.lastAction = {
    action: "lock",
    timestamp: timestamp,
    method: method
  };
  
  // Emit property changes
  thing.emitPropertyChange("locked");
  thing.emitPropertyChange("lockState");
  thing.emitPropertyChange("lastAction");
  
  // Emit lockStateChanged event
  thing.emitEvent("lockStateChanged", {
    from: "unlocked",
    to: "locked",
    method: method,
    timestamp: timestamp
  });
  
  debug(`Door locked via ${method}`);
  
  return { 
    locked: state.locked,
    lockState: state.lockState
  };
});

thing.setActionHandler("unlock", async (params = {}) => {
  if (state.lockState === "jammed") {
    throw new Error("Door lock is jammed and cannot be operated");
  }
  
  if (!state.locked) {
    return { locked: false, lockState: state.lockState };
  }
  
  // Get the method of unlocking
  const method = params.method || "app";
  
  // Check PIN if method is remote
  if (method === "remote" && params.pin !== DEFAULT_PIN) {
    // Emit unauthorized access event
    thing.emitEvent("unauthorizedAccess", {
      method: method,
      timestamp: new Date().toISOString()
    });
    
    debug(`Unauthorized unlock attempt via ${method}`);
    throw new Error("Unauthorized access: Invalid PIN");
  }
  
  // Set temporary state while unlocking
  state.lockState = "unlocking";
  thing.emitPropertyChange("lockState");
  
  // Simulate unlock operation (takes 2 seconds)
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // @WoTStates d -> ¬d
  state.locked = false;
  state.lockState = "unlocked";
  
  // Update last action
  const timestamp = new Date().toISOString();
  state.lastAction = {
    action: "unlock",
    timestamp: timestamp,
    method: method
  };
  
  // Emit property changes
  thing.emitPropertyChange("locked");
  thing.emitPropertyChange("lockState");
  thing.emitPropertyChange("lastAction");
  
  // Emit lockStateChanged event
  thing.emitEvent("lockStateChanged", {
    from: "locked",
    to: "unlocked",
    method: method,
    timestamp: timestamp
  });
  
  debug(`Door unlocked via ${method}`);
  
  return { 
    locked: state.locked,
    lockState: state.lockState
  };
});

// Simulate battery drain (decrease by 1% every 24 hours)
let batteryInterval = setInterval(() => {
  if (state.batteryLevel > 0) {
    state.batteryLevel -= 1;
    thing.emitPropertyChange("batteryLevel");
    
    // Alert when battery is low
    if (state.batteryLevel === 20 || state.batteryLevel === 10 || state.batteryLevel === 5) {
      debug(`Warning: Door lock battery low (${state.batteryLevel}%)`);
    }
  }
}, 24 * 60 * 60 * 1000);

// Auto-lock feature (if configured)
const ENABLE_AUTO_LOCK = true;
const AUTO_LOCK_DELAY = 30000; // 30 seconds

let autoLockTimeout = null;

thing.addListener("lockStateChanged", async (event) => {
  // If door is unlocked and auto-lock is enabled, schedule lock
  if (event.to === "unlocked" && ENABLE_AUTO_LOCK) {
    // Clear any existing timeout
    if (autoLockTimeout) {
      clearTimeout(autoLockTimeout);
    }
    
    // Set new timeout
    autoLockTimeout = setTimeout(async () => {
      try {
        if (state.lockState === "unlocked") {
          await thing.invokeAction("lock", { method: "auto" });
        }
      } catch (err) {
        debug(`Auto-lock error: ${err.message}`);
      }
    }, AUTO_LOCK_DELAY);
    
    debug(`Auto-lock scheduled in ${AUTO_LOCK_DELAY/1000} seconds`);
  }
});

// Clean up intervals on shutdown
servient.addShutdownHandler(() => {
  clearInterval(batteryInterval);
  if (autoLockTimeout) {
    clearTimeout(autoLockTimeout);
  }
});
