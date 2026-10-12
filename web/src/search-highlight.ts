export function searchHighlightParts(text:string,query:string) {
  const characters=Array.from(text),positions:number[]=[];
  // Keep a map to the displayed glyphs when fullwidth/ligature normalization changes length.
  const normalized=characters.map((character,index)=>{
    const value=character.normalize('NFKC').toLowerCase();
    positions.push(...Array(value.length).fill(index));return value;
  }).join('');
  const terms=query.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]|[^\p{Script=Han}\s]+/gu) || [];
  const matched=characters.map(()=>false);
  for(const term of new Set(terms)) {
    for(let start=normalized.indexOf(term);start!==-1;start=normalized.indexOf(term,start+1)) {
      for(let offset=start;offset<start+term.length;offset++)matched[positions[offset]]=true;
    }
  }
  const parts:{text:string;matched:boolean}[]=[];
  characters.forEach((character,index)=>{
    const last=parts.at(-1);
    if(last && last.matched===matched[index])last.text+=character;
    else parts.push({text:character,matched:matched[index]});
  });
  return parts;
}
