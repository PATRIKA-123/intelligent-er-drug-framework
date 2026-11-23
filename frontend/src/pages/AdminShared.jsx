export function PageHeader({eyebrow,title,description,children}){
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div>
    <div className="mb-2 text-xs font-bold uppercase tracking-[.22em] text-muted">{eyebrow || 'Administration'}</div>
    <h1 className="m-0 text-[34px] font-semibold leading-tight tracking-tight md:text-[46px]">{title}</h1>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p></div>{children}</div>;
}
export function Panel({children,className=''}) {return <section className={`rounded-[28px] border border-line bg-surface p-5 shadow-sm md:p-7 ${className}`}>{children}</section>}
export function Pill({children,tone='neutral'}) {const cl=tone==='good'?'bg-emerald-100 text-emerald-800':tone==='warn'?'bg-amber-100 text-amber-800':tone==='bad'?'bg-rose-100 text-rose-800':'bg-soft text-text';return <span className={`inline-flex max-w-full items-center rounded-full px-3 py-1.5 text-xs font-semibold ${cl}`}>{children}</span>}
export function Action({children,onClick,disabled,danger=false}){return <button type="button" disabled={disabled} onClick={onClick} className={`min-h-10 rounded-full border px-4 py-2 text-xs font-semibold transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${danger?'border-rose-200 text-rose-700 hover:bg-rose-50':'border-line bg-surface text-text hover:bg-soft'}`}>{children}</button>}
export function Notice({error,message}) {return error?<p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>:message?<p role="status" className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>:null}
export function Empty({children}){return <div className="rounded-[24px] border border-dashed border-line p-9 text-center text-sm text-muted">{children}</div>}
