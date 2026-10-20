import {useEffect,useRef,useState} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Search,Flame} from 'lucide-react';
import {api,money} from './api';
import {SearchHighlight} from './SearchHighlight';

type Suggestion={id:string;name:string;image:string;price:number;unit:string};
// 顶部搜索框：聚焦且未输入时展示热搜词，输入时 200ms 防抖请求联想商品
export function SearchBox(){
  const[params]=useSearchParams(),navigate=useNavigate(),ref=useRef<HTMLFormElement>(null);
  const[value,setValue]=useState(params.get('q') || ''),[open,setOpen]=useState(false),[hot,setHot]=useState<string[]>(),[items,setItems]=useState<Suggestion[]>([]);
  useEffect(()=>{setValue(params.get('q') || '');},[params.get('q')]);
  useEffect(()=>{if(open&&!hot)api<string[]>('/search/hot').then(setHot).catch(()=>setHot([]));},[open]);
  useEffect(()=>{const q=value.trim();if(!open||!q){setItems([]);return;}let live=true;const t=setTimeout(()=>api<Suggestion[]>('/search/suggest?q='+encodeURIComponent(q.slice(0,40))).then(v=>{if(live)setItems(v);}).catch(()=>{}),200);return()=>{live=false;clearTimeout(t);};},[value,open]);
  useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[open]);
  const go=(q:string)=>{setOpen(false);setValue(q);navigate('/?q='+encodeURIComponent(q));};
  return <form className="search-box" ref={ref} role="search" onSubmit={e=>{e.preventDefault();go(value);}}><Search size={19}/><input value={value} onChange={e=>{setValue(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}} aria-label="搜索商品" autoComplete="off" placeholder="搜索新鲜好物，今天想吃点什么？"/><button type="submit">搜索</button>
    {open&&(value.trim()?items.length>0:!!hot?.length)&&<div className="search-suggest" id="search-suggest">{value.trim()?items.map(item=><button type="button" key={item.id} className="suggest-item" onClick={()=>{setOpen(false);navigate('/products/'+item.id);}}><img src={item.image} alt=""/><span><em><SearchHighlight text={item.name} query={value}/></em><small>{item.unit}</small></span><b>{money(item.price)}</b></button>):<><p className="suggest-title"><Flame size={15}/>大家都在搜</p><div className="hot-words">{hot!.map((word,i)=><button type="button" key={word} className={i<3?'top':''} onClick={()=>go(word)}>{word}</button>)}</div></>}</div>}
  </form>;
}
