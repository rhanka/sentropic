// A legend is an ordinary foldable zone; its entries are scene content.
export function withLegend(scene) {
  const en = scene.language === 'en';
  return { ...scene, groups:[...scene.groups, {
    id:'legend', title:en ? 'Legend' : 'Légende', kicker:'SENTROPIC',
    subtitle:en ? 'Colours and relations' : 'Couleurs et relations', tone:'neutral',
    position:{x:0,y:Math.max(0,...scene.groups.map(g=>g.position.y+g.height),...scene.nodes.map(n=>n.position.y+n.height))+240},
    legendEntries:[
      {tone:'proposal',label:en ? 'Proposed / qualification' : 'Cible / qualification'},
      {tone:'identity',label:en ? 'Identity and trust' : 'Identité et confiance'},
      {line:true,label:en ? 'Active relation' : 'Relation active'},
      {line:true,dashed:true,label:en ? 'Proposed connection' : 'Raccordement proposé'},
    ],
  }] };
}
