type SearchableProduct = {name:string;subtitle:string;origin:string};

const normalize = (value:string) => value.normalize('NFKC').toLowerCase();
const compact = (value:string) => normalize(value).replace(/\s+/gu,'');
function partialNameScore(term:string,name:string):number|undefined {
  if(!/^[\p{Script=Han}]+$/u.test(term))return undefined;
  const characters=[...new Set(Array.from(term))];
  if(characters.length<2)return undefined;
  const coverage=characters.filter(character=>name.includes(character)).length/characters.length;
  // Two-character queries may share one character; longer queries need at least 75%.
  if(coverage<(Array.from(term).length===2?0.5:0.75))return undefined;
  return coverage*40;
}

// One substitution, insertion, deletion or adjacent swap. Short words never use this.
function withinOneEdit(left:string[],right:string[]) {
  let index=0;
  while(index<left.length && index<right.length && left[index]===right[index])index++;
  if(index===left.length || index===right.length)return Math.abs(left.length-right.length)<=1;
  const sameTail=(a:number,b:number)=>left.slice(a).join('')===right.slice(b).join('');
  if(left.length===right.length) {
    return sameTail(index+1,index+1) ||
      (left[index]===right[index+1] && left[index+1]===right[index] && sameTail(index+2,index+2));
  }
  return left.length>right.length?sameTail(index+1,index):sameTail(index,index+1);
}

function fuzzyNameMatch(term:string[],name:string[]) {
  // At least three characters must remain: “草莓酱” cannot collapse to “草莓”.
  for(let size=Math.max(3,term.length-1);size<=Math.min(name.length,term.length+1);size++) {
    for(let start=0;start+size<=name.length;start++) {
      if(withinOneEdit(term,name.slice(start,start+size)))return true;
    }
  }
  return false;
}

export function createProductSearch(query:string) {
  const terms=[...new Set(normalize(query).trim().split(/\s+/u).filter(Boolean))]
    .map(text=>({text,characters:Array.from(text),allowTypo:Array.from(text).length>=3 && /^[\p{L}\p{N}]+$/u.test(text)}));
  if(!terms.length)return undefined;
  return (product:SearchableProduct):number|undefined => {
    const name=compact(product.name),origin=compact(product.origin),subtitle=compact(product.subtitle);
    let score=0,relaxed=false,level=0;
    for(const term of terms) {
      if(name.includes(term.text))score+=100;
      else if(origin.includes(term.text))score+=80;
      else if(subtitle.includes(term.text))score+=60;
      else {
        if(relaxed)return undefined;
        if(term.allowTypo && fuzzyNameMatch(term.characters,Array.from(name)))level=1;
        else {
          const partial=terms.length===1?partialNameScore(term.text,name):undefined;
          if(partial===undefined)return undefined;
          score+=partial;level=2;
        }
        relaxed=true;
      }
    }
    // Every term is required, with at most one relaxed term across the entire query.
    // Exact matches precede typo matches, followed by character overlap matches.
    return 2-level+score/(terms.length*100);
  };
}
