(()=>{const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const hero=document.querySelector('[data-hero-object]');let stage=0,timer=null;
const setStage=n=>{if(!hero)return;hero.dataset.stage=String(n)};
if(hero&&!reduced){timer=setInterval(()=>{stage=(stage+1)%3;setStage(stage)},1500)}
const points=[...document.querySelectorAll('.problem-point')];
if('IntersectionObserver'in window&&!reduced){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){points.forEach(x=>x.classList.remove('is-active'));e.target.classList.add('is-active');e.target.classList.add('motion-pop')}}),{threshold:.58,rootMargin:'-12% 0px -18% 0px'});points.forEach(p=>io.observe(p));}
else if(points[0]) points[0].classList.add('is-active');
for(const el of document.querySelectorAll('[data-cta]'))el.addEventListener('click',e=>{const target=document.querySelector('#google-comparison');if(target){e.preventDefault();target.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'})}});
})();