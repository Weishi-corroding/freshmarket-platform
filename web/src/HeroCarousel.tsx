import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {ChevronLeft,ChevronRight} from 'lucide-react';

const slides=[
  {id:'fruit',image:'/images/hero.jpg',alt:'新鲜草莓',eyebrow:'FRESH PICKS · 鲜境当季',title:['把自然的新鲜','带到你的餐桌。'],description:['当季鲜果，产地直采','给生活添一份自然的甜。'],action:'挑选当季鲜果',category:'fruit'},
  {id:'vegetable',image:'/images/broccoli.jpg',alt:'新鲜西兰花',eyebrow:'GREEN LIVING · 田园鲜蔬',title:['让日常的三餐','多一份清新。'],description:['时令蔬菜，清爽鲜嫩','把田园好滋味带回家。'],action:'挑选新鲜蔬菜',category:'vegetable'},
  {id:'dairy',image:'/images/croissant.jpg',alt:'新鲜烘焙可颂',eyebrow:'MORNING DELIGHTS · 元气早餐',title:['从一口好早餐','开启新的一天。'],description:['醇香乳品，松软烘焙','为每一个清晨添点幸福。'],action:'逛逛乳品烘焙',category:'dairy'},
  {id:'meat',image:'/images/steak.jpg',alt:'鲜切牛排',eyebrow:'GOOD FOOD · 餐桌好滋味',title:['用心选好食材','好好吃每一餐。'],description:['严选肉禽，鲜美丰富','为家常料理添一道好菜。'],action:'挑选肉禽蛋品',category:'meat'}
];

export function HeroCarousel(){
  const[index,setIndex]=useState(0),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
  const[hidden,setHidden]=useState(()=>document.hidden),[reducedMotion,setReducedMotion]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const stopped=hovered||focused||hidden||reducedMotion;
  const change=(step:number)=>setIndex(current=>(current+step+slides.length)%slides.length);

  useEffect(()=>{
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference=()=>setReducedMotion(preference.matches),onVisibility=()=>setHidden(document.hidden);
    preference.addEventListener('change',onPreference);
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{preference.removeEventListener('change',onPreference);document.removeEventListener('visibilitychange',onVisibility);};
  },[]);
  useEffect(()=>{
    if(stopped)return;
    const timer=window.setTimeout(()=>setIndex(current=>(current+1)%slides.length),5000);
    return()=>window.clearTimeout(timer);
  },[index,stopped]);

  return <section className="hero-primary hero-carousel" aria-label="当季好物推荐" aria-roledescription="轮播图"
    onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
    onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}
    onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();change(event.key==='ArrowLeft'?-1:1);}}}>
    <div className="hero-slides" aria-live={stopped?'polite':'off'} aria-atomic="true">
      {slides.map((slide,i)=><div key={slide.id} id={'hero-slide-'+slide.id} className={'hero-slide hero-slide-'+slide.id+(index===i?' active':'')} role="group" aria-roledescription="幻灯片" aria-label={`${i+1} / ${slides.length}`} aria-hidden={index!==i} inert={index!==i}>
        <img src={slide.image} alt={slide.alt}/>
        <div className="hero-copy"><span className="eyebrow">{slide.eyebrow}</span><h1>{slide.title[0]}<br/>{slide.title[1]}</h1><p>{slide.description[0]}<br/>{slide.description[1]}</p><Link className="button" to={'/?category='+slide.category}>{slide.action}</Link></div>
        <span className="hero-caption">FRESH EVERY DAY</span>
      </div>)}
    </div>
    <button type="button" className="hero-arrow hero-prev" aria-label="上一张" onClick={()=>change(-1)}><ChevronLeft size={25}/></button>
    <button type="button" className="hero-arrow hero-next" aria-label="下一张" onClick={()=>change(1)}><ChevronRight size={25}/></button>
    <div className="hero-controls"><div className="hero-dots" role="group" aria-label="选择轮播图">{slides.map((slide,i)=><button key={slide.id} type="button" className={'hero-dot'+(index===i?' active':'')} aria-label={`第${i+1}张：${slide.action}`} aria-current={index===i?'true':undefined} aria-controls={'hero-slide-'+slide.id} onClick={()=>setIndex(i)}><span/></button>)}</div></div>
  </section>;
}
