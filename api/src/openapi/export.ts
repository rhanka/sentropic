import { writeFileSync } from 'node:fs';

const openapiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'Top AI Ideas API',
    version: '0.1.0'
  },
  paths: {}
};

writeFileSync('openapi.json', JSON.stringify(openapiDoc, null, 2));
