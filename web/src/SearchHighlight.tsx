import {searchHighlightParts} from './search-highlight';

export function SearchHighlight({text,query}:{text:string;query:string}) {
  if(!query.trim())return <>{text}</>;
  return <>{searchHighlightParts(text,query).map((part,index)=>part.matched?
    <mark className="search-highlight" key={index}>{part.text}</mark>:part.text)}</>;
}
