// Property read handlers
thing.setPropertyReadHandler("temperature", async () => state.temperature);
thing.setPropertyReadHandler("humidity", async () => state.humidity);
thing.setPropertyReadHandler("pressure", async () => state.pressure);
thing.setPropertyReadHandler("acceleration", async () => state.acceleration);
thing.setPropertyReadHandler("batteryInfo", async () => state.batteryInfo);
thing.setPropertyReadHandler("movementCounter", async () => state.movementCounter);
thing.setPropertyReadHandler("sequenceNumber", async () => state.sequenceNumber);
thing.setPropertyReadHandler("lastUpdated", async () => state.lastUpdated);

const { debug } = createLoggers("simulation", "ruuvitag");

// Helper function to simulate environmental data
function generateSensorData(overrides = {}) {
  // Base temperature with small variations (15-25°C)
  const baseTemp = 20 + (Math.random() - 0.5) * 10;
  
  // Humidity correlated with temperature (30-70%)
  const baseHumidity = 50 + (25 - baseTemp) * 2 + (Math.random() - 0.5) * 20;
  
  // Pressure variations (1010-1030 hPa = 101000-103000 Pa)
  const basePressure = 101325 + (Math.random() - 0.5) * 2000;
  
  // Small acceleration variations when stationary
  const acceleration = {
    x: Math.round((Math.random() - 0.5) * 100),
    y: Math.round((Math.random() - 0.5) * 100), 
    z: 1000 + Math.round((Math.random() - 0.5) * 50)
  };

  return {
    temperature: Math.round((overrides.temperature || baseTemp) * 10) / 10,
    humidity: Math.round((overrides.humidity || Math.max(0, Math.min(100, baseHumidity))) * 10) / 10,
    pressure: Math.round(overrides.pressure || basePressure),
    acceleration: overrides.acceleration || acceleration,
    timestamp: new Date().toISOString()
  };
}

// Helper function to update sensor data
function updateSensorData(newData = {}, triggerMovement = false) {
  const sensorData = generateSensorData(newData);
  
  // Update state
  state.temperature = sensorData.temperature;
  state.humidity = sensorData.humidity;
  state.pressure = sensorData.pressure;
  state.acceleration = sensorData.acceleration;
  state.sequenceNumber += 1;
  state.lastUpdated = sensorData.timestamp;
  
  // Handle movement detection
  if (triggerMovement) {
    state.movementCounter += 1;
    
    // Movement affects acceleration
    state.acceleration.x += Math.round((Math.random() - 0.5) * 500);
    state.acceleration.y += Math.round((Math.random() - 0.5) * 500);
    state.acceleration.z += Math.round((Math.random() - 0.5) * 200);
    
    // Emit movement event
    thing.emitEvent("movementDetected", {
      movementCounter: state.movementCounter,
      timestamp: sensorData.timestamp
    });
    
    debug(`RuuviTag movement detected (#${state.movementCounter})`);
  }
  
  // Emit property changes
  thing.emitPropertyChange("temperature");
  thing.emitPropertyChange("humidity");
  thing.emitPropertyChange("pressure");
  thing.emitPropertyChange("acceleration");
  thing.emitPropertyChange("sequenceNumber");
  thing.emitPropertyChange("lastUpdated");
  if (triggerMovement) {
    thing.emitPropertyChange("movementCounter");
  }
  
  // Emit sensor data event
  thing.emitEvent("sensorData", {
    temperature: state.temperature,
    humidity: state.humidity,
    pressure: state.pressure,
    acceleration: state.acceleration,
    timestamp: sensorData.timestamp
  });
  
    
  debug(`RuuviTag data: ${state.temperature}°C, ${state.humidity}%, ${state.pressure}Pa`);
  
  // Emit the sensor data event
  
  return {
    success: true,
    message: "Sensor data updated",
    data: {
      temperature: state.temperature,
      humidity: state.humidity,
      pressure: state.pressure,
      acceleration: state.acceleration,
      sequenceNumber: state.sequenceNumber,
      movementCounter: state.movementCounter,
      timestamp: sensorData.timestamp
    }
  };
}

// Action handler for simulating readings
thing.setActionHandler("simulateReading", async (input) => {
  const params = input || {};
  const triggerMovement = params.movement || false;
  
  const result = updateSensorData({
    temperature: params.temperature,
    humidity: params.humidity
  }, triggerMovement);
  
  return result.data;
});

// Automatic sensor data simulation every 10 seconds
setInterval(() => {
  // 10% chance of movement detection
  const randomMovement = Math.random() < 0.1;
  updateSensorData({}, randomMovement);
}, 10000);

debug("RuuviTag initialized with automatic sensor simulation!");
