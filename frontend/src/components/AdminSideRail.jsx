import {NavLink,Link} from 'react-router';
import {useAuth} from '../auth/AuthContext';
import Logo from './Logo';
import Icon from './Icon';
const sections=[
 {to:'/admin',label:'Invite',icon:'user'},
 {to:'/admin/invitations',label:'Invitations',icon:'calendar'},
 {to:'/admin/users',label:'Users',icon:'list'},
 {to:'/admin/operations',label:'Operations',icon:'home'},
];
export default function AdminSideRail(){
 const {user,logout}=useAuth();
 return <aside className="fixed bottom-6 left-4 top-6 z-30 hidden w-[76px] flex-col items-center rounded-[32px] border border-line bg-surface/95 py-3 shadow-sm lg:flex" aria-label="Admin quick navigation">
  <Link to="/admin" className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-mint" aria-label="Admin home"><Logo size={29}/></Link>
  <nav aria-label="Administration sections" className="flex flex-col items-center gap-3">
   {sections.map(s=><NavLink key={s.to} to={s.to} end title={s.label} aria-label={s.label} className={({isActive})=>`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition ${isActive?'bg-ink shadow-lg':'hover:bg-soft'}`}>
    {({isActive})=><><Icon name={s.icon} size={22} color={isActive?'#FFFFFF':undefined}/><span className="pointer-events-none absolute left-[60px] z-40 hidden whitespace-nowrap rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white shadow-lg group-hover:block">{s.label}</span></>}
   </NavLink>)}
  </nav>
  <div className="mt-auto flex flex-col items-center gap-3"><button type="button" title="Sign out" aria-label="Sign out" onClick={logout} className="flex h-11 w-11 items-center justify-center rounded-2xl hover:bg-soft"><Icon name="logout" size={21}/></button><div title={user.username} className="flex h-11 w-11 items-center justify-center rounded-full bg-lavender text-xs font-bold">AD</div></div>
 </aside>;
}
