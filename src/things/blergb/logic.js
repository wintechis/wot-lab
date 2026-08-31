const { debug } = createLoggers("simulation", "blergb");

// Property read handlers
thing.setPropertyReadHandler("currentColor", async () => state.currentColor);
thing.setPropertyReadHandler("power", async () => state.power);
thing.setPropertyReadHandler("currentEffect", async () => state.currentEffect);
thing.setPropertyReadHandler("brightness", async () => state.brightness);
thing.setPropertyReadHandler("lastUpdated", async () => state.lastUpdated);

// Helper function to validate RGB values
function validateRGB(r, g, b) {
  const isValid = (val) => Number.isInteger(val) && val >= 0 && val <= 255;
  return isValid(r) && isValid(g) && isValid(b);
}

// Helper function to validate effect value
function validateEffect(effect) {
  return Number.isInteger(effect) && effect >= 128 && effect <= 156;
}

// Helper function to validate brightness
function validateBrightness(brightness) {
  return Number.isInteger(brightness) && brightness >= 0 && brightness <= 100;
}

// Helper function to apply brightness to RGB values
function applyBrightness(r, g, b, brightness) {
  const factor = brightness / 100;
  return {
    R: Math.round(r * factor),
    G: Math.round(g * factor),
    B: Math.round(b * factor)
  };
}

// Helper function to generate BLE command bytes (simulated)
function generateColorCommand(r, g, b) {
  return [126, 7, 5, 3, r, g, b, 0, 239]; // Command structure from TD
}

function generatePowerCommand(isOn) {
  return [126, 4, 4, isOn ? 1 : 0, 0, 0, 0, 0, 239];
}

function generateEffectCommand(effect) {
  return [126, 3, 3, effect, 3, 0, 0, 0, 239];
}

// Action handlers
thing.setActionHandler("setColor", async (input) => {
  const { R, G, B } = input;
  
  if (!validateRGB(R, G, B)) {
    throw new Error(`Invalid RGB values: R=${R}, G=${G}, B=${B}. Values must be integers 0-255.`);
  }
  
  const timestamp = new Date().toISOString();
  const oldColor = { ...state.currentColor };
  
  // Update state
  state.currentColor = { R, G, B };
  state.lastUpdated = timestamp;
  
  // Generate BLE command (simulated)
  const command = generateColorCommand(R, G, B);
  debug(`🎨 RGB Command sent: [${command.join(', ')}]`);
  
  // Emit property changes and event
  thing.emitPropertyChange("currentColor");
  thing.emitPropertyChange("lastUpdated");
  thing.emitEvent("colorChanged", {
    R, G, B,
    timestamp
  });
  
  debug(`🌈 Color changed: RGB(${oldColor.R},${oldColor.G},${oldColor.B}) → RGB(${R},${G},${B})`);
  
  return {
    success: true,
    message: "Color updated",
    color: { R, G, B },
    command: command,
    timestamp
  };
});

thing.setActionHandler("setPower", async (input) => {
  const { state: powerState } = input;
  
  if (typeof powerState !== 'boolean') {
    throw new Error(`Invalid power state: ${powerState}. Must be boolean.`);
  }
  
  const timestamp = new Date().toISOString();
  const oldPower = state.power;
  
  // Update state
  state.power = powerState;
  state.lastUpdated = timestamp;
  
  // Generate BLE command (simulated)
  const command = generatePowerCommand(powerState);
  debug(`🔌 Power Command sent: [${command.join(', ')}]`);
  
  // Emit property changes and event
  thing.emitPropertyChange("power");
  thing.emitPropertyChange("lastUpdated");
  thing.emitEvent("powerChanged", {
    power: powerState,
    timestamp
  });
  
  debug(`⚡ Power ${oldPower ? 'ON' : 'OFF'} → ${powerState ? 'ON' : 'OFF'}`);
  
  return {
    success: true,
    message: `Power ${powerState ? 'enabled' : 'disabled'}`,
    power: powerState,
    command: command,
    timestamp
  };
});

thing.setActionHandler("setEffect", async (input) => {
  const { effect } = input;
  
  if (!validateEffect(effect)) {
    throw new Error(`Invalid effect: ${effect}. Must be integer 128-156.`);
  }
  
  const timestamp = new Date().toISOString();
  const oldEffect = state.currentEffect;
  
  // Update state
  state.currentEffect = effect;
  state.lastUpdated = timestamp;
  
  // Generate BLE command (simulated)
  const command = generateEffectCommand(effect);
  debug(`✨ Effect Command sent: [${command.join(', ')}]`);
  
  // Emit property changes and event
  thing.emitPropertyChange("currentEffect");
  thing.emitPropertyChange("lastUpdated");
  thing.emitEvent("effectChanged", {
    effect,
    timestamp
  });
  
  debug(`✨ Effect changed: ${oldEffect} → ${effect}`);
  
  return {
    success: true,
    message: "Effect updated",
    effect: effect,
    command: command,
    timestamp
  };
});

thing.setActionHandler("setBrightness", async (input) => {
  const { brightness } = input;
  
  if (!validateBrightness(brightness)) {
    throw new Error(`Invalid brightness: ${brightness}. Must be integer 0-100.`);
  }
  
  const timestamp = new Date().toISOString();
  const oldBrightness = state.brightness;
  
  // Update state
  state.brightness = brightness;
  state.lastUpdated = timestamp;
  
  // Apply brightness to current color and send command
  const adjustedColor = applyBrightness(
    state.currentColor.R,
    state.currentColor.G, 
    state.currentColor.B,
    brightness
  );
  
  const command = generateColorCommand(adjustedColor.R, adjustedColor.G, adjustedColor.B);
  debug(`💡 Brightness Command sent: [${command.join(', ')}]`);
  
  // Emit property changes
  thing.emitPropertyChange("brightness");
  thing.emitPropertyChange("lastUpdated");
  
  debug(`💡 Brightness changed: ${oldBrightness}% → ${brightness}%`);
  
  return {
    success: true,
    message: "Brightness updated",
    brightness: brightness,
    adjustedColor: adjustedColor,
    command: command,
    timestamp
  };
});

debug("🎨 BLE RGB Controller initialized with full color control!");
