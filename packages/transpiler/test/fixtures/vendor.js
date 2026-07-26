'use strict';

const inner = require('./inner');

function vendorThing(a, b) {
  return inner(a) + inner(b);
}

module.exports = { vendorThing };
