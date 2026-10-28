// E2 integration after #821 and #803. L4 0.22.0 remains a separate L5 input.
export const candidate = {
  snapshotHead: '32dd911be19f0874459a1b4e697d7175bb6b433f',
  qualifiedHead: '32dd911be19f0874459a1b4e697d7175bb6b433f',
  qualifiedTree: '9dcd865487004e28649f3d68c842f328cc4d1952',
  engram: {
    name: '@sentropic/engram', version: '0.21.3',
    sha256: '32d47df1880cf5c43b0f16145f75aebeda5fd341d8b1317f3b89acc428bbd05b',
    integrity: 'sha512-eGoBIutpeISKgN4HOS3NSIj7K6rMtT6Y/FbBvoXMykLu0wbaKEaO1pjCLDxVFfdA6Zlj9zg2v2Ft7DIr5Vf7aw==',
  },
  mesh: {
    name: '@sentropic/cluster-mesh', version: '0.24.0-dev.6',
    sha256: 'ff79088e02574f9e17e16deb52f9380453255ed79f5b69c8b17d156a25233194',
    integrity: 'sha512-A20DTkaNo++aXw/A+K5Hyg9SHRlX6ZefoWhpXGF1BQnXONThsSLT6yKeWq3QwZb/iIAznLqlW0F0zs7/ENbFFg==',
  },
  anchors: {
    'receipt.json': '0883c3516e1517e002d2e9eb7aad8ecf2e6e664f0522ff8d05002579f7816f70',
    'consumer-package.json': 'f31251f0b9dcab86a1933b7d51e11a1fe130e1aee60a2d4661808322d139d970',
    'consumer-lock.json': '07457b5df26cbd8b6ccc7a5251010bc2e0a6aa7674add788cd9fc611f9dda125',
    'campaign.log': '2dad9ecb81818dab6ad25ffb7f4db04493a53d8f18ee59f6274ef087b72a5ea5',
    'campaign.status': 'eb30050778841df44c7a4fe88d59a640dc9620a1429382b8afccda8cb2b493b3',
    'lane-adaptation.json': '1c0eef531c36679ec8a951ec27d8f6dd9fc59a7da6a48fefbdb0ed9bd41a587b',
    'neutral-contract-1.0.0.jcs.json': '55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759',
    'source/tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json': '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730',
  },
};
export const profileNames = ['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1', 'scope-outbox-v1', 'fenced-writers-v1'];
