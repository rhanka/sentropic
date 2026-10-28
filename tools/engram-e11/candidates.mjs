// Observation of #803 on 2026-10-28, never a final acceptance specification.
export const candidate = {
  snapshotHead: 'afd283ec8054abb4bb16dd74428bb51bea136fcc',
  qualifiedHead: 'cf1e537a8810a49d50d442169474f3b893103e6f',
  qualifiedTree: '8b14cca07a28aeaf644bd05b718120a9b29c9321',
  engram: {
    name: '@sentropic/engram', version: '0.22.0',
    sha256: '26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10',
    integrity: 'sha512-/TV03olHbzG+3haTC5j5YJ282egCrXak1yQE0I8DHF1kAQDwsKUe1QlMwibvBCEmPGdWeTgSHT4fF8lZJTH8cw==',
  },
  mesh: {
    name: '@sentropic/cluster-mesh', version: '0.24.0-dev.5',
    sha256: '11a8fe858d1abecde50e003c191a8600db4880f4382c8ce3ffa2bb44c09df8e4',
    integrity: 'sha512-pDYuW62mwMdRpsgDCbS27eKfP+4YV3AgplUgdEboqqlUoLliWpgpgYPnnyW0aaPCZgiuDM/uwGQ2iELeIIFDcw==',
  },
  anchors: {
    'receipt.json': '2304a3e414a3090b968a2ff980ade48a29c1a3f5965dbc14d21d5ee74d0ed3a8',
    'consumer-package.json': '30393c52fcc4d1cd6d2dc881151123ec19997d298c287a726f0dd18d206a870c',
    'consumer-lock.json': '8904d2f36ae92c6e781bdc1f38f2ab41e293ec52ad8f5df13fe70295971fb1c2',
    'campaign.log': '5c9413b41b9f0e515551a9939fbea0a812218652b0278e6ee2ba03376d71106a',
    'campaign.status': 'eb30050778841df44c7a4fe88d59a640dc9620a1429382b8afccda8cb2b493b3',
    'source/tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json': '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730',
  },
};
export const profileNames = ['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1', 'scope-outbox-v1', 'fenced-writers-v1'];
