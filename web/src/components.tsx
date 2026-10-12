import {useEffect,useRef,useState,type ReactNode} from 'react';
import {X,LoaderCircle,ShoppingBasket,AlertCircle,ChevronLeft,ChevronRight} from 'lucide-react';
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  // 用 ref 保存最新的 onClose，让副作用只在挂载/卸载时执行一次。
  // 否则父组件每次重渲染（例如输入框 onChange 更新 state）都会因为 onClose 是新函数而重跑副作用，
  // 重新聚焦弹窗容器并抢走输入框焦点，导致弹窗内无法输入。
  const onCloseRef=useRef(onClose);onCloseRef.current=onClose;
  useEffect(()=>{const before=document.activeElement as HTMLElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onCloseRef.current();if(e.key==='Tab'){const elements=ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,a[href],[tabindex="0"]');if(!elements?.length)return;const first=elements[0],last=elements[elements.length-1];if(e.shiftKey && (document.activeElement===first || document.activeElement===ref.current)){e.preventDefault();last.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}}};
    document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);before?.focus();};
  },[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className={'modal '+(wide?'wide':'')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={22}/></button></div>{children}</div></div>;
}
export function Loading(){return <div className="loading" role="status"><LoaderCircle className="spin" size={28}/>正在加载…</div>;}
export function Empty({title='这里还空着',text,action}:{title?:string;text?:string;action?:ReactNode}){return <div className="empty"><ShoppingBasket size={52} strokeWidth={1.3}/><h3>{title}</h3>{text&&<p>{text}</p>}{action}</div>;}
export function Failure({error,retry}:{error:string;retry:()=>void}){return <div className="empty error"><AlertCircle size={40}/><h3>{error}</h3><button className="button secondary" onClick={retry}>重新加载</button></div>;}
export function Pager({page,total,size,onPage}:{page:number;total:number;size:number;onPage:(page:number)=>void}){const last=Math.max(1,Math.ceil(total/size));if(last===1)return null;return <div className="pager"><button className="icon-button" aria-label="上一页" disabled={page===1} onClick={()=>onPage(page-1)}><ChevronLeft size={20}/></button><span>第 {page} / {last} 页 · 共 {total} 条</span><button className="icon-button" aria-label="下一页" disabled={page>=last} onClick={()=>onPage(page+1)}><ChevronRight size={20}/></button></div>;}
export function Quantity({value,min=1,max=99,onChange,disabled=false}:{value:number;min?:number;max?:number;onChange:(n:number)=>void;disabled?:boolean}){return <div className="quantity"><button aria-label="减少数量" disabled={disabled || value<=min} onClick={()=>onChange(value-1)}>−</button><span>{value}</span><button aria-label="增加数量" disabled={disabled || value>=max} onClick={()=>onChange(value+1)}>+</button></div>;}
export function useLoad<T>(loader:()=>Promise<T>,deps:unknown[]=[]){const[data,setData]=useState<T>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);useEffect(()=>{let live=true;setLoading(true);setError('');loader().then(v=>{if(live)setData(v);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[...deps,version]);return {data,error,loading,reload:()=>setVersion(v=>v+1)};}
