#!/usr/bin/env node
// Globally installed consumer: no own cluster-mesh; resolves the separately installed
// runtime as a sibling in the global prefix.
const { describeRuntime } = await import('fixture-separate-runtime');
console.log(JSON.stringify(await describeRuntime()));
