// The glue station's recipe Actions are generated from the TD's `vre:effects`.
// On top of that, every Action heats the glue gun to a new, random temperature
// between MIN_TEMP and MAX_TEMP. The generated handlers are registered after
// this file runs, so we wrap `setActionHandler` to decorate each of them rather
// than registering (and thereby losing) the recipe handlers ourselves.

const MIN_TEMP = 90;
const MAX_TEMP = 110;

function randomTemperature() {
  return Math.round((MIN_TEMP + Math.random() * (MAX_TEMP - MIN_TEMP)) * 10) / 10;
}

thing.setPropertyReadHandler('xpos', async () => state.xpos);
thing.setPropertyReadHandler('ypos', async () => state.ypos);
thing.setPropertyReadHandler('temperature', async () => state.temperature);
thing.setPropertyReadHandler('service', async () => state.service);

const setActionHandler = thing.setActionHandler.bind(thing);
thing.setActionHandler = (name, handler) =>
  setActionHandler(name, async (input, options) => {
    const result = await handler(input, options);
    state.temperature = randomTemperature();
    thing.emitPropertyChange('temperature');
    return result;
  });
