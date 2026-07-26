const { clamp } = require('./helpers');
const config = require('./config.json');

export function bootstrap(value) {
  return clamp(value, config.min, config.max);
}
