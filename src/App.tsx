import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, ArrowLeft, Bell, BriefcaseBusiness, Building2, Check, ChevronRight, CircleHelp, ClipboardList, Clock3, FileCheck2, FileText, GitPullRequest, Image, LayoutDashboard, ListTodo, LogOut, Menu, MessageSquare, Pencil, Plus, Search, Settings, Upload, UserPlus, UserRound, Users, X } from "lucide-react";
import { Audit, departments, seedProjects, seedTasks, seedAudit, seedNotices, seedWeeklyObjectives, seedStaffStatuses, Project, ProjectResource, Task, User, users, Notice, AccessRole, EmploymentType, AccountStatus, WeeklyObjective, WeeklyObjectiveResource, ObjectiveStatus, StaffStatus, Availability } from "./data";
import { OFFICIAL_DEPARTMENTS, UNASSIGNED_DEPARTMENT } from "../shared/departments.mjs";
import "./person-modal.css";
import "./task-detail.css";
import "./intern-project-finder.css";
import "./task-create.css";

type View="Overview"|"Tasks"|"Projects"|"People"|"Blockers"|"Weekly Review"|"Departments"|"Integrations"|"Audit Log"|"Settings"|"Notifications"|"Home"|"My Tasks"|"Feedback";
type DatabasePerson=User&{source:"Supabase";employmentStatus?:string;supervisorName?:string};
 const navGroups:{label:string;items:{name:View;icon:any}[]}[]=[
  {label:"Work",items:[{name:"Overview",icon:LayoutDashboard},{name:"Tasks",icon:ClipboardList},{name:"Projects",icon:BriefcaseBusiness}]},
  {label:"Team",items:[{name:"People",icon:Users},{name:"Departments",icon:Building2},{name:"Blockers",icon:AlertTriangle}]}];
const initials=(n:string)=>n.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();
const accessOf=(person:User):AccessRole=>person.opsRole||person.accessRole||(person.role==="Super Admin"?"Superadmin":person.role==="Manager"?"Manager":"Member");
const employmentOf=(person:User):EmploymentType=>person.employmentType||(person.role==="Intern"?"Intern":"Employee");
const isCurrentTeamMember=(person:User)=>employmentOf(person)!=="Intern"||!["alisha fatima","mosa maseko","neo letswalo"].includes(person.name.trim().toLowerCase());
const accountOf=(person:User):AccountStatus=>person.accountStatus||(person.active===false?"Suspended":"Active");
const isAdmin=(person:User)=>["Superadmin","Admin"].includes(accessOf(person));
const isManager=(person:User)=>accessOf(person)==="Manager";
const emptyUser:User={id:"",name:"",email:"",employmentType:"Employee",accessRole:"Member",accountStatus:"Pending",department:"",active:false};
const currentDate=()=>new Date().toISOString().slice(0,10);
const taskDepartments=(task:Task)=>task.departmentIds?.length?task.departmentIds:(task.department?[task.department]:[]);
const taskAssignees=(task:Task)=>task.assigneeIds?.length?task.assigneeIds:(task.assignee?[task.assignee]:[]);
const taskDepartmentLabel=(task:Task)=>{const names=taskDepartments(task);return names.length>2?`${names.slice(0,2).join(" · ")} · +${names.length-2}`:names.join(" · ")||"Unassigned"};
const objectivePriorityRank:Record<WeeklyObjective["priority"],number>={Critical:0,High:1,Medium:2,Low:3};
const objectivesForUser=(objectives:WeeklyObjective[],user:User,team:User[])=>{
  if(accessOf(user)==="Superadmin")return objectives;
  return objectives.filter(objective=>{
    if(objective.managerId===user.id)return true;
    const owner=team.find(person=>person.id===objective.managerId);
    return Boolean(user.department&&owner?.department===user.department);
  });
};
type DepartmentHealthPoint={label:string;score:number;event:string;direction:"up"|"down"|"steady";future?:boolean};
const departmentHealthCurveFor=(tasks:Task[],now:number,maxPoints?:number):DepartmentHealthPoint[]=>{
  const hour=60*60*1000;
  const current=new Date(now);
  const dayStart=new Date(current.getFullYear(),current.getMonth(),current.getDate()).getTime();
  const daysSinceMonday=(current.getDay()+6)%7;
  const weekStart=dayStart-daysSinceMonday*24*hour;
  const time=(value?:string)=>value?new Date(value.length===10?`${value}T12:00:00`:value).getTime():NaN;
  const createdAt=(task:Task)=>time(task.createdDate||task.startDate);
  const hasWeeklyWork=tasks.length>0;
  let score=hasWeeklyWork?58:52;
  const weekStartPoint:DepartmentHealthPoint={label:"",score,event:"Week starting point",direction:"steady"};
  const dailyPoints=Array.from({length:7},(_,index)=>{
    const start=weekStart+index*24*hour;
    const future=start>now;
    const cutoff=future?start:Math.min(start+24*hour-1,now);
    if(!hasWeeklyWork){
      score=Math.max(10,score-6);
      return{label:new Date(start).toLocaleDateString([],{weekday:"short"}),score,event:future?"No tasks planned — projected risk":"No department tasks created",direction:"down" as const,future};
    }
    if(future)return{label:new Date(start).toLocaleDateString([],{weekday:"short"}),score,event:"Upcoming day",direction:"steady" as const,future:true};
    const added=tasks.filter(task=>{const value=createdAt(task);return Number.isFinite(value)&&value>=start&&value<=cutoff}).length;
    const completed=tasks.filter(task=>{const value=time(task.completedAt);return Number.isFinite(value)&&value>=start&&value<=cutoff}).length;
    const submitted=tasks.filter(task=>{const value=time(task.submittedAt);return Number.isFinite(value)&&value>=start&&value<=cutoff}).length;
    const updated=tasks.reduce((count,task)=>count+(task.updates||[]).filter(update=>{const value=time(update.createdAt);return Number.isFinite(value)&&value>=start&&value<=cutoff}).length,0);
     const activityInDay=tasks.flatMap(task=>(task.activityLog||[]).filter(activity=>{const value=time(activity.createdAt);return Number.isFinite(value)&&value>=start&&value<=cutoff}));
     const blocked=activityInDay.filter(activity=>activity.action==="Status changed to Blocked").length;
     const changesRequested=activityInDay.filter(activity=>activity.action==="Status changed to Changes Requested").length;
     const reopened=activityInDay.filter(activity=>activity.action==="Checklist item reopened").length;
     const otherActivity=activityInDay.filter(activity=>!["Task created","Status changed to Blocked","Status changed to Changes Requested","Checklist item reopened"].includes(activity.action)).length;
     const overdue=tasks.filter(task=>{
       if(["Completed","Cancelled"].includes(task.status))return false;
       const dueAt=new Date(`${task.due}T00:00:00`).getTime()+24*hour;
       return dueAt>=start&&dueAt<=cutoff;
     }).length;
     const positive=added*7+submitted*5+completed*9+updated*3+otherActivity*2;
      const inactivity=positive===0&&blocked===0&&changesRequested===0&&reopened===0&&overdue===0?4:0;
      const negative=blocked*7+changesRequested*5+reopened*2+overdue*4+inactivity;
    const change=positive-negative;
    score=Math.max(10,Math.min(96,score+change));
    const direction:DepartmentHealthPoint["direction"]=change>0?"up":change<0?"down":"steady";
      const event=completed?`${completed} ${completed===1?"task":"tasks"} completed`:submitted?`${submitted} sent for review`:added?`${added} ${added===1?"task":"tasks"} created`:updated?`${updated} task ${updated===1?"update":"updates"}`:otherActivity?`${otherActivity} delivery ${otherActivity===1?"activity":"activities"}`:blocked?`${blocked} ${blocked===1?"task":"tasks"} blocked`:changesRequested?`${changesRequested} sent back for changes`:reopened?`${reopened} checklist ${reopened===1?"item":"items"} reopened`:overdue?`${overdue} ${overdue===1?"task became":"tasks became"} overdue`:"No department activity";
     return{label:new Date(start).toLocaleDateString([],{weekday:"short"}),score,event,direction};
  });
   const points=[weekStartPoint,...dailyPoints];
  return maxPoints?points.slice(-maxPoints):points;
};
const dayGreeting=()=>{const hour=new Date().getHours();return hour<12?"Good morning":hour<18?"Good afternoon":"Good evening"};
function Avatar({person,size=30}:{person?:User;size?:number}){const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[person?.avatarUrl]);return person?.avatarUrl&&!failed?<img className="avatar avatar-image" src={person.avatarUrl} alt={`${person.name}'s profile`} style={{width:size,height:size}} onError={()=>setFailed(true)}/>:<div className="avatar avatar-placeholder" style={{width:size,height:size}} aria-label={`${person?.name||"Team member"} profile placeholder`}><UserRound size={Math.max(14,Math.round(size*.48))} strokeWidth={1.7}/></div>}
function BackButton({onClick,label,className=""}:{onClick:()=>void;label:string;className?:string}){return <button type="button" className={`back-button ${className}`.trim()} onClick={onClick} aria-label={label} title={label}><ArrowLeft size={17} strokeWidth={2.1} aria-hidden="true"/></button>}
function ProjectLogo({project,size=44}:{project:Project;size?:number}){return project.logoUrl?<img className="project-logo" src={project.logoUrl} alt={`${project.name} logo`} style={{width:size,height:size}}/>:<div className="project-logo project-logo-fallback" style={{width:size,height:size}} aria-label={`${project.name} logo fallback`}>{initials(project.name)}</div>}
function AvatarStack({people}:{people:User[]}){return <div className="avatar-stack" aria-label={`${people.length} assigned people`}>{people.slice(0,4).map((person,index)=><span key={person.id} style={{zIndex:4-index}}><Avatar person={person} size={25}/></span>)}{people.length>4&&<span className="avatar-more">+{people.length-4}</span>}</div>}
function useStore<T>(key:string, initial:T){
  const [value,setValue]=useState<T>(initial); const [hydrated,setHydrated]=useState(false);
  const skipInitialPersist=useRef(true);
  useEffect(()=>{const controller=new AbortController();fetch(`/api/state/${key}`,{signal:controller.signal}).then(async response=>{if(response.status===404){await fetch(`/api/state/${key}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:initial}),signal:controller.signal});return initial}if(!response.ok)throw new Error("Could not load workspace data");return (await response.json()).value as T}).then(next=>{setValue(next);setHydrated(true)}).catch(error=>{if(error?.name!=="AbortError")console.error(error)});return()=>controller.abort()},[key]);
  useEffect(()=>{if(!hydrated)return;if(skipInitialPersist.current){skipInitialPersist.current=false;return}const timer=window.setTimeout(()=>fetch(`/api/state/${key}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value})}).catch(console.error),250);return()=>window.clearTimeout(timer)},[key,value,hydrated]);
  return [value,setValue] as const
}

async function uploadAsset(file:File,kind:"profile"|"project_logo"|"document"|"image"){
  const form=new FormData();form.append("file",file);form.append("kind",kind);
  const response=await fetch("/api/assets",{method:"POST",body:form});
  if(!response.ok)throw new Error((await response.json()).error||"Upload failed");
  return (await response.json()).url as string;
}

export default function App(){
  if(window.location.pathname==="/setup-account")return <SetupAccount/>;
  return <WorkspaceApp/>;
}

function SetupAccount(){
  const token=new URLSearchParams(window.location.search).get("token")||"";
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [message,setMessage]=useState("");
  const [saving,setSaving]=useState(false);
  const submit=async()=>{
    if(password.length<12){setMessage("Use at least 12 characters.");return}
    if(password!==confirm){setMessage("Passwords do not match.");return}
    setSaving(true);
    const response=await fetch("/api/auth/setup-account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,password})});
    const result=await response.json();
    setSaving(false);
    if(!response.ok){setMessage(result.error||"Could not set up your account.");return}
    setMessage("Your account is ready. You can now sign in.");
  };
  return <div className="login"><div className="login-orb login-orb-one" aria-hidden="true"/><div className="login-orb login-orb-two" aria-hidden="true"/><form className="login-card" onSubmit={event=>{event.preventDefault();submit()}}><input className="sr-only" type="email" autoComplete="username" tabIndex={-1} aria-hidden="true" readOnly/><div className="login-brand"><img src="/olyxee-logo.png" alt="Olyxee"/><span>Olyxee <em>Ops</em></span></div><div className="login-rule"><span/></div><span className="workspace-access-label">Secure account setup</span><h1>Create your password</h1><p>Choose a password with at least 12 characters. This invitation link can only be used once.</p><div className="form-grid"><label className="form-label">Password<input className="input" type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} required/></label><label className="form-label">Confirm password<input className="input" type="password" autoComplete="new-password" value={confirm} onChange={event=>setConfirm(event.target.value)} required/></label>{message&&<div className="notice">{message}</div>}<button className="btn primary" type="submit" disabled={saving||!token}>{saving?"Saving…":"Set up account"}</button>{message.startsWith("Your account")&&<a className="btn" href="/">Go to sign in</a>}</div></form></div>;
}

function WorkspaceApp(){
  const linkedTaskId=new URLSearchParams(window.location.search).get("task");
  const signOut=async()=>{await fetch("/api/auth/logout",{method:"POST"});window.location.assign("/")};
   const [user,setUser]=useState<User|null>(null); const [view,setView]=useState<View>(linkedTaskId?"Tasks":"Overview"); const [taskId,setTaskId]=useState<string|null>(linkedTaskId); const [projectId,setProjectId]=useState<string|null>(null); const [objectiveId,setObjectiveId]=useState<string|null>(null); const [searchQuery,setSearchQuery]=useState("");
  const [loading,setLoading]=useState(false);
   const [accountError,setAccountError]=useState("");
   const [onlineUserIds,setOnlineUserIds]=useState<string[]>([]);
  const [databasePeople,setDatabasePeople]=useState<DatabasePerson[]|null>(null); const [databasePeopleError,setDatabasePeopleError]=useState("");
   const [tasks,setTasks]=useState<Task[]>(seedTasks); const [projectsData,setProjectsData]=useStore<Project[]>("projects",seedProjects); const [audit,setAudit]=useStore<Audit[]>("audit",seedAudit); const [notices,setNotices]=useStore<Notice[]>("notices",seedNotices); const [objectives,setObjectives]=useStore<WeeklyObjective[]>("objectives",seedWeeklyObjectives); const [staffStatuses,setStaffStatuses]=useStore<StaffStatus[]>("staff-statuses",seedStaffStatuses); const [departmentsData,setDepartmentsData]=useStore<[string,string,string][]>("departments",departments); const [team,setTeam]=useState<User[]>([]);
   const [notice,setNotice]=useState(""); const [modal,setModal]=useState<"task"|"person"|"blocker"|"project"|"objective"|"department"|null>(null); const [editingPerson,setEditingPerson]=useState<User|undefined>(); const [editingObjective,setEditingObjective]=useState<WeeklyObjective|undefined>(); const [profileOpen,setProfileOpen]=useState(false); const [notificationsOpen,setNotificationsOpen]=useState(false); const [seenLiveNotices,setSeenLiveNotices]=useState<string[]>([]); const [settingsOpen,setSettingsOpen]=useState(false); const [departmentId,setDepartmentId]=useState<string|null>(null);
    const active=team.find(person=>person.id===user?.id)||user||emptyUser;
    const displayedStaffStatuses=useMemo<StaffStatus[]>(()=>team.map(person=>{const saved=staffStatuses.find(status=>status.userId===person.id);const online=onlineUserIds.includes(person.id);return{userId:person.id,availability:online?(saved?.availability==="Busy"?"Busy":"Available"):"Offline",start:saved?.start||"09:00",end:saved?.end||"17:30",note:saved?.note||"",updatedAt:saved?.updatedAt||""}}),[team,staffStatuses,onlineUserIds]);
    const activeStatus=displayedStaffStatuses.find(status=>status.userId===active.id); const can=(action:string)=>isAdmin(active)||(isManager(active)&&["task","review","person"].includes(action));
   const managerHealthNotice=useMemo<Notice|null>(()=>{
     if(!isManager(active)||!active.department||active.department===UNASSIGNED_DEPARTMENT)return null;
     const departmentWork=tasks.filter(task=>taskDepartments(task).includes(active.department)&&task.status!=="Cancelled");
     const reviewTask=departmentWork.find(task=>task.status==="Submitted for Review");
     const blockedTask=departmentWork.find(task=>task.status==="Blocked");
     if(reviewTask){const id=`health-review-${reviewTask.id}`;return{id,userId:active.id,title:`${active.department} needs your review`,body:`Review “${reviewTask.title}” and leave feedback to keep delivery moving.`,read:seenLiveNotices.includes(id),time:"Live"}}
     if(blockedTask){const id=`health-blocked-${blockedTask.id}`;return{id,userId:active.id,title:`${active.department} needs support`,body:`Help resolve the blocker on “${blockedTask.title}” before delivery drops further.`,read:seenLiveNotices.includes(id),time:"Live"}}
     const recentCompletion=departmentWork.some(task=>task.completedAt&&Date.now()-new Date(task.completedAt).getTime()<8*60*60*1000);
     if(departmentWork.length&&!recentCompletion){const id=`health-momentum-${active.department}`;return{id,userId:active.id,title:`Build momentum in ${active.department}`,body:`No work has been completed in the last 8 hours. Review active work or create the next priority task.`,read:seenLiveNotices.includes(id),time:"Live"}}
     return null;
   },[active.id,active.department,active.role,tasks,seenLiveNotices]);
   const activeNotices=[...(managerHealthNotice?[managerHealthNotice]:[]),...notices.filter(item=>item.userId===active.id&&item.id!==managerHealthNotice?.id)];
  const availableDepartments=useMemo(()=>{
    const merged=new Map<string,[string,string,string]>();
    departments.forEach(department=>merged.set(department[0],department));
    departmentsData.filter(department=>OFFICIAL_DEPARTMENTS.includes(department[0])).forEach(department=>merged.set(department[0],department));
    return OFFICIAL_DEPARTMENTS.map(name=>{
      const department=merged.get(name);
      if(!department)return undefined;
      const manager=team.find(person=>isCurrentTeamMember(person)&&isManager(person)&&accountOf(person)==="Active"&&person.department===name);
      return manager?[department[0],manager.name,department[2]] as [string,string,string]:department;
    }).filter(Boolean) as [string,string,string][];
  },[departmentsData,team]);
  const intern=employmentOf(active)==="Intern";
   const allowed:View[]=intern?["Home","My Tasks","Projects","Feedback"]:isManager(active)?["Overview","Tasks","Projects","People","Blockers","Weekly Review","Departments","Notifications","Settings"]:["Overview","Tasks","Projects","People","Departments","Blockers","Weekly Review","Notifications","Settings"];
  const visibleView=allowed.includes(view)?view:(intern?"Home":"Overview");
     const visibleTasks=accessOf(active)==="Superadmin"
      ? tasks.filter(task=>taskAssignees(task).some(id=>team.some(person=>person.id===id&&isManager(person))))
      : employmentOf(active)==="Intern"?tasks.filter(task=>taskAssignees(task).includes(active.id)):tasks;
  const searchResults=useMemo(()=>{
    const query=searchQuery.trim().toLowerCase(); if(!query)return [];
    const words=query.split(/\s+/); const matches=(text:string)=>words.every(word=>text.toLowerCase().includes(word));
    const scopedPeople=team.filter(person=>isCurrentTeamMember(person)&&(isAdmin(active)||isManager(active)||person.id===active.id||person.reportsTo===active.id));
    const scopedProjects=projectsData.filter(project=>isAdmin(active)||isManager(active)||project.assigneeIds.includes(active.id)||tasks.some(task=>task.project===project.name));
     const results:{id:string;label:string;meta:string;kind:"view"|"task"|"project"|"objective";target:string}[]=[];
    allowed.forEach(item=>{if(matches(`${item} page navigation`))results.push({id:`view-${item}`,label:item,meta:"Navigation",kind:"view",target:item})});
    visibleTasks.forEach(task=>{if(matches(`${task.id} ${task.title} ${task.project} ${task.status} ${task.priority} ${task.description}`))results.push({id:`task-${task.id}`,label:task.title,meta:`${task.id} · ${task.project} · ${task.status}`,kind:"task",target:task.id})});
    scopedProjects.forEach(project=>{if(matches(`${project.name} ${project.description} ${project.status}`))results.push({id:`project-${project.id}`,label:project.name,meta:"Project",kind:"project",target:project.id})});
    scopedPeople.forEach(person=>{if(matches(`${person.name} ${person.email} ${person.department} ${employmentOf(person)} ${accessOf(person)} ${accountOf(person)}`))results.push({id:`person-${person.id}`,label:person.name,meta:`${employmentOf(person)} · ${accessOf(person)} · ${person.department}`,kind:"view",target:"People"})});
    availableDepartments.filter(department=>isAdmin(active)||department[0]===active.department).forEach(department=>{if(matches(department.join(" ")))results.push({id:`department-${department[0]}`,label:department[0],meta:`Department · ${department[1]}`,kind:"view",target:"Departments"})});
      objectivesForUser(objectives,active,team).forEach(objective=>{if(matches(`${objective.title} ${objective.description} ${objective.priority} ${objective.status}`))results.push({id:`objective-${objective.id}`,label:objective.title,meta:`Weekly objective · ${objective.status}`,kind:"objective",target:objective.id})});
    return results.slice(0,8);
  },[searchQuery,allowed,visibleTasks,team,projectsData,objectives,availableDepartments,active]);
 const log=(action:string)=>setAudit(a=>[{id:crypto.randomUUID(),actor:active.name,action,time:"Just now"},...a]);
 const notify=(userId:string,title:string,body:string)=>setNotices(n=>[{id:crypto.randomUUID(),userId,title,body,read:false,time:"Just now"},...n]);
 const flash=(s:string)=>{setNotice(s);setTimeout(()=>setNotice(""),2600)};
  const loadTasks=async()=>{const response=await fetch("/api/tasks");const result=await response.json();if(!response.ok)throw new Error(result.error||"Unable to load tasks.");setTasks(result.tasks)};
   const deleteTask=async(task:Task)=>{
     const confirmed=window.confirm(`Permanently delete “${task.title}” and remove its progress history? This cannot be undone.`);
     if(!confirmed)return;
     try{
       const response=await fetch(`/api/tasks/${encodeURIComponent(task.id)}`,{method:"DELETE"});
       const result=await response.json();
       if(!response.ok)throw new Error(result.error||"Unable to delete task.");
       setTasks(current=>current.filter(item=>item.id!==task.id));
       setTaskId(null);
       flash("Task deleted and progress charts updated.");
     }catch(error){flash(error instanceof Error?error.message:"Unable to delete task.");}
   };
   const updateTask=async(id:string,patch:Partial<Task>)=>{let feedback=typeof (patch as Task&{feedback?:string}).feedback==="string"?(patch as Task&{feedback?:string}).feedback:"";if(["Changes Requested","Completed"].includes(patch.status||"")&&!feedback){feedback=window.prompt(patch.status==="Completed"?"Add your review before approving this work:":"Explain what needs to change:","")?.trim()||"";if(!feedback){flash("Written review feedback is required.");return}}const response=await fetch(`/api/tasks/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:patch.status,feedback,blockerReason:patch.blockerReason||patch.blocker?.reason})});const result=await response.json();if(!response.ok){flash(result.error||"Unable to update task.");return}await loadTasks();flash(patch.status==="Completed"?"Review saved and work approved.":"Task status updated.");};
    const selectView=(v:View)=>{setView(v);setTaskId(null);setProjectId(null);setObjectiveId(null);setDepartmentId(null);setProfileOpen(false);setNotificationsOpen(false);setSearchQuery("");window.scrollTo({top:0,behavior:"smooth"})};
   const openObjective=(id:string)=>{setView("Weekly Review");setTaskId(null);setProjectId(null);setObjectiveId(id);setDepartmentId(null);setProfileOpen(false);setNotificationsOpen(false);setSearchQuery("");window.scrollTo({top:0,behavior:"smooth"})};
  const openDepartment=(department:string)=>{setView("Departments");setTaskId(null);setProjectId(null);setDepartmentId(department);setProfileOpen(false);setNotificationsOpen(false);setSearchQuery("");window.scrollTo({top:0,behavior:"smooth"})};
   const openSearchResult=(result:(typeof searchResults)[number])=>{setSearchQuery("");if(result.kind==="task"){setView("Tasks");setProjectId(null);setTaskId(result.target)}else if(result.kind==="project"){setView("Projects");setTaskId(null);setProjectId(result.target)}else if(result.kind==="objective"){openObjective(result.target)}else selectView(result.target as View)};
  useEffect(()=>{const controller=new AbortController();fetch("/api/me",{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error((await response.json()).error||"Your account could not be loaded.");return response.json() as Promise<User>}).then(person=>{setUser(person);setTeam([person]);setView(linkedTaskId?"Tasks":"Overview")}).catch(error=>{if(error?.name!=="AbortError")setAccountError(error.message)});return()=>controller.abort()},[]);
  useEffect(()=>{if(!user)return;setLoading(true);const timer=window.setTimeout(()=>setLoading(false),260);return()=>window.clearTimeout(timer)},[user?.id,view,taskId]);
  useEffect(()=>{if(!user)return;const controller=new AbortController();setDatabasePeopleError("");fetch("/api/people",{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("Live people records are unavailable");return response.json() as Promise<{people:DatabasePerson[]}>}).then(result=>{setDatabasePeople(result.people);setTeam(()=>{const merged:User[]=[...result.people];if(!merged.some(person=>person.id===user.id))merged.unshift(user);return merged})}).catch(error=>{if(error?.name!=="AbortError")setDatabasePeopleError("Could not load people from Supabase.")});return()=>controller.abort()},[user?.id]);
  useEffect(()=>{if(!user)return;loadTasks().catch(error=>flash(error instanceof Error?error.message:"Unable to load tasks."))},[user?.id]);
   useEffect(()=>{if(!user)return;let cancelled=false;const heartbeat=()=>fetch("/api/presence/heartbeat",{method:"POST"}).then(response=>{if(response.ok&&!cancelled)setOnlineUserIds(current=>current.includes(user.id)?current:[...current,user.id])}).catch(()=>{});heartbeat();const timer=window.setInterval(heartbeat,30_000);return()=>{cancelled=true;window.clearInterval(timer)}},[user?.id]);
   useEffect(()=>{if(!user||(!isAdmin(active)&&!isManager(active)))return;let cancelled=false;const refreshPresence=()=>fetch("/api/presence").then(async response=>{if(!response.ok)throw new Error("Presence unavailable");return response.json() as Promise<{onlineUserIds:string[]}>}).then(result=>{if(!cancelled)setOnlineUserIds(result.onlineUserIds)}).catch(()=>{});refreshPresence();const timer=window.setInterval(refreshPresence,30_000);return()=>{cancelled=true;window.clearInterval(timer)}},[user?.id,active.role,active.opsRole,active.accessRole]);
    if(accountError)return <div className="login"><div className="login-card workspace-access-state"><div className="login-brand"><img src="/olyxee-logo.png" alt="Olyxee"/><span>Olyxee <em>Ops</em></span></div><div className="login-rule" aria-hidden="true"><span/></div><span className="workspace-access-label">Workspace unavailable</span><h1>We couldn’t open your workspace.</h1><p>Your sign-in was accepted, but your account data could not be loaded. Try signing in again. If it continues, ask your administrator to check your account.</p><button className="btn workspace-access-action" onClick={signOut}>Back to sign in</button></div></div>;
   if(!user)return <div className="login"><div className="login-card"><div className="loading-bar loading-profile-name"/><div className="loading-bar loading-profile-meta"/></div></div>;
  if(loading)return <LoadingShell user={active}/>;
   const selected=visibleTasks.find(t=>t.id===taskId);
    const selectedProject=projectId?projectsData.find(project=>project.id===projectId&&(!intern||project.assigneeIds.includes(active.id))):undefined;
    return <div className={`app workspace-shell ${intern?"intern-shell":""}`}>
     <main className="main"><header className="topbar workspace-topbar"><button className="workspace-brand" onClick={()=>selectView("Overview")} aria-label="Open Olyxee Ops overview"><img src="/olyxee-logo.png" alt=""/><b className="workspace-wordmark"><span className="workspace-wordmark-name">Olyxee</span><span className="workspace-wordmark-ops">Ops</span></b></button><div className="global-search"><Search size={15}/><input value={searchQuery} onChange={event=>setSearchQuery(event.target.value)} placeholder="Search the entire workspace…"/>{searchQuery&&<button onClick={()=>setSearchQuery("")}><X size={14}/></button>}{searchQuery&&<div className="search-results">{searchResults.map(result=><button key={result.id} onClick={()=>openSearchResult(result)}><span><b>{result.label}</b><small>{result.meta}</small></span><ChevronRight size={14}/></button>)}{!searchResults.length&&<div className="search-empty">No matching workspace items.</div>}</div>}</div><div className="top-actions"><NotificationPopover notices={activeNotices} open={notificationsOpen} onToggle={()=>{const opening=!notificationsOpen;if(opening){const viewedIds=activeNotices.map(item=>item.id);setNotices(current=>current.map(item=>item.userId===active.id?{...item,read:true}:item));setSeenLiveNotices(current=>[...new Set([...current,...viewedIds])])}setNotificationsOpen(opening);setProfileOpen(false)}}/><ProfilePopover person={active} status={activeStatus} open={profileOpen} onToggle={()=>{setProfileOpen(open=>!open);setNotificationsOpen(false)}} onSettings={()=>{setProfileOpen(false);setSettingsOpen(true)}} onSwitch={()=>{setProfileOpen(false);signOut()}}/></div></header>
       <div className="content workspace-content">{intern&&<InternNav active={visibleView} onSelect={selectView}/>} {notice&&<div className="notice" style={{marginBottom:17}}>{notice}</div>}{selected?<div className="workspace-section"><TaskDetail key={selected.id} task={selected} user={active} team={team} projectsData={projectsData} can={can} update={updateTask} refresh={loadTasks} flash={flash} deleteTask={deleteTask} onBack={()=>setTaskId(null)}/></div>:selectedProject?<div className="workspace-section"><ProjectDetail user={active} project={selectedProject} tasks={intern?visibleTasks:tasks} objectives={objectives} team={team} onBack={()=>setProjectId(null)} onOpen={setTaskId} onProjectUpdated={updated=>setProjectsData(current=>current.map(project=>project.id===updated.id?updated:project))} onResourceAdded={resource=>setProjectsData(current=>current.map(project=>project.id===projectId?{...project,resources:[...project.resources,resource]}:project))} flash={flash}/></div>:projectId?<div className="workspace-section"><BackButton className="workspace-back" onClick={()=>setProjectId(null)} label="Back to projects"/><div className="empty">This project is not available in your assigned work.</div></div>:visibleView==="Overview"||visibleView==="Home"?<UnifiedWorkspace user={active} team={team} statuses={displayedStaffStatuses} tasks={visibleTasks} allTasks={visibleTasks} projectsData={projectsData} departmentsData={availableDepartments} objectives={objectives} can={can} onOpen={setTaskId} onProject={setProjectId} onDepartment={openDepartment} onModal={setModal} onEditObjective={objective=>{setEditingObjective(objective);setModal("objective")}} onManage={person=>{setEditingPerson(person);setModal("person")}} onView={selectView} onObjective={openObjective}/>:<div className="workspace-section">{!(visibleView==="Weekly Review"&&objectiveId)&&<BackButton className="workspace-back" onClick={()=>selectView(intern?"Home":"Overview")} label={`Back to ${intern?"Home":"Overview"}`}/>}<ViewContent view={visibleView} user={active} team={team} databasePeople={databasePeople} databasePeopleError={databasePeopleError} statuses={displayedStaffStatuses} tasks={visibleTasks} allTasks={visibleTasks} projectsData={projectsData} departmentsData={availableDepartments} initialDepartment={departmentId} audit={audit} notices={notices.filter(n=>n.userId===active.id)} objectives={objectives} objectiveId={objectiveId} can={can} onOpen={setTaskId} onProject={setProjectId} onView={selectView} onObjective={openObjective} onEditObjective={objective=>{setEditingObjective(objective);setModal("objective")}} onModal={setModal} onManage={person=>{setEditingPerson(person);setModal("person")}} update={updateTask} setTasks={setTasks} setObjectives={setObjectives} setDepartmentsData={setDepartmentsData} log={log} flash={flash} onSettings={()=>setSettingsOpen(true)}/></div>}</div></main>
   {modal==="task"&&<TaskModal user={active} team={team} projects={projectsData} onClose={()=>setModal(null)} onSave={async t=>{const response=await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)});const result=await response.json();if(!response.ok)throw new Error(result.error||"Unable to assign task. Please try again.");await loadTasks();flash("Task created successfully.");setModal(null)}}/>}
     {modal==="person"&&<PersonModal user={active} team={team} tasks={tasks} person={editingPerson} onOpenTask={id=>{setModal(null);setEditingPerson(undefined);setTaskId(id)}} onClose={()=>{setModal(null);setEditingPerson(undefined)}} onSave={async person=>{const editingLive="source" in person&&person.source==="Supabase";const response=await fetch(editingLive?`/api/people/${person.id}`:"/api/people",{method:editingLive?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(person)});const result=await response.json();if(!response.ok){flash(result.error||`Could not ${editingLive?"update":"add"} this person`);return}const peopleResponse=await fetch("/api/people");const peopleResult=await peopleResponse.json() as {people:DatabasePerson[]};setDatabasePeople(peopleResult.people);setTeam(()=>{const merged:User[]=[...peopleResult.people];if(user&&!merged.some(member=>member.id===user.id))merged.unshift(user);return merged});log(`${editingLive?"Updated":"Added"} ${person.name}`);flash(`${person.name} ${editingLive?"updated":"added to People"}`);setModal(null);setEditingPerson(undefined)}}/>}
      {modal==="project"&&<ProjectModal user={active} team={team} onClose={()=>setModal(null)} onSave={async project=>{const response=await fetch("/api/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(project)});const result=await response.json();if(!response.ok){flash(result.error||"Could not create project");return}setProjectsData(current=>current.some(item=>item.id===result.project.id)?current:[...current,result.project]);log(`Created project ${result.project.name}`);result.project.assigneeIds.forEach((id:string)=>notify(id,"Project assigned",`${result.project.name} is now available in Projects.`));flash("Project created");setModal(null)}}/>}
    {modal==="objective"&&<ObjectiveModal objective={editingObjective} managers={isManager(active)?[active]:team.filter(person=>isManager(person)&&isCurrentTeamMember(person))} onClose={()=>{setModal(null);setEditingObjective(undefined)}} onSave={objective=>{if(editingObjective){setObjectives(current=>current.map(item=>item.id===editingObjective.id?{...item,...objective}:item));log(`Updated weekly objective ${objective.title}`);flash("Weekly objective updated")}else{setObjectives(current=>[...current,{...objective,id:`WO-${String(current.length+1).padStart(2,"0")}`,createdBy:active.id,createdDate:currentDate()}]);log(`Created weekly objective ${objective.title}`);flash("Weekly objective created")}setModal(null);setEditingObjective(undefined)}}/>}
  {settingsOpen&&<SettingsModal user={active} team={team} setTeam={setTeam} statuses={staffStatuses} setStatuses={setStaffStatuses} tasks={tasks} flash={flash} onClose={()=>setSettingsOpen(false)}/>}
 </div>
}
function LoadingShell({user}:{user:User}){return <div className="app workspace-shell loading-shell"><main className="main"><header className="topbar workspace-topbar loading-topbar"><div className="workspace-brand"><img src="/olyxee-logo.png" alt=""/><span className="loading-bar loading-brand-name"/></div><span className="loading-bar loading-search"/><div className="loading-actions"><span className="loading-bar loading-action"/><span className="loading-bar loading-avatar"/></div></header><div className="content workspace-content"><div className="loading-board"><LoadingWidget area="profile" profile/><LoadingWidget area="tasks" rows={4}/><LoadingWidget area="projects" rows={3}/><LoadingWidget area="departments" rows={3}/><LoadingWidget area="people" rows={3}/><LoadingWidget area="review" rows={3}/></div><span className="sr-only">Loading {user.name}'s workspace</span></div></main></div>}
function LoadingWidget({area,rows=3,profile=false}:{area:string;rows?:number;profile?:boolean}){return <section className={`loading-widget loading-${area}`}>{profile?<div className="loading-profile-body"><span className="loading-bar loading-profile-avatar"/><span className="loading-bar loading-profile-name"/><span className="loading-bar loading-profile-email"/><span className="loading-bar loading-profile-meta"/></div>:<><div className="loading-widget-head"><span className="loading-bar loading-widget-icon"/><span className="loading-bar loading-widget-title"/></div><div className="loading-widget-rows">{Array.from({length:rows},(_,index)=><div className="loading-widget-row" key={index}><span><i className="loading-bar loading-row-title"/><i className="loading-bar loading-row-meta"/></span><i className="loading-bar loading-row-badge"/></div>)}</div></>}</section>}
function InternNav({active,onSelect}:{active:View;onSelect:(view:View)=>void}){
  const items:[View,string,any][]=[["Home","Home",LayoutDashboard],["My Tasks","My Tasks",ListTodo],["Projects","Projects",BriefcaseBusiness],["Feedback","Feedback",MessageSquare]];
  return <nav className="intern-nav" aria-label="Intern workspace navigation">{items.map(([view,label,Icon])=><button key={view} className={active===view?"active":""} onClick={()=>onSelect(view)}><Icon size={16}/><span>{label}</span></button>)}</nav>;
}
function Header({eyebrow,title,subtitle,action}:{eyebrow:string;title:string;subtitle?:string;action?:React.ReactNode}){return <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1 className="title">{title}</h1>{subtitle&&<p className="subtitle">{subtitle}</p>}</div>{action}</div>}
function Status({s}:{s:string}){let c=["Completed","Approved","Complete"].includes(s)?"green":["Blocked","Rejected","At risk","Changes Requested"].includes(s)?"red":["Submitted for Review","Pending","In progress"].includes(s)?"amber":"gray";return <span className={`badge ${c}`}>{s}</span>}
function ObjectiveStatusIcon({status,size=18}:{status:ObjectiveStatus;size?:number}){return status==="Complete"?<Check size={size}/>:status==="At risk"?<AlertTriangle size={size}/>:status==="In progress"?<Clock3 size={size}/>:status==="Not started"?<ClipboardList size={size}/>:<FileCheck2 size={size}/>}
function StatusPill({status}:{status?:StaffStatus}){const value=status?.availability||"Offline";return <span className={`availability ${value.toLowerCase()}`}><i/>{value}</span>}
function NotificationPopover({notices,open,onToggle}:{notices:Notice[];open:boolean;onToggle:()=>void}){const unread=notices.filter(item=>!item.read).length;return <div className="notification-wrap"><button className="notification-trigger" title={unread?`${unread} unread notifications`:"Notifications"} aria-label={unread?`${unread} unread notifications`:"Notifications"} aria-expanded={open} aria-haspopup="dialog" onClick={onToggle}><Bell size={19}/>{unread>0&&<span className="notification-count">{unread>99?"99+":unread}</span>}</button>{open&&<div className="notification-popover" role="dialog" aria-label="Notifications"><div className="notification-head"><div><b>Notifications</b><span>{notices.length} updates</span></div><button className="close" onClick={onToggle}><X size={16}/></button></div><div className="notification-list">{notices.slice(0,5).map(item=><div className="notification-item" key={item.id}><div className={`notification-mark ${item.read?"read":""}`}/><div><b>{item.title}</b><p>{item.body}</p><span>{item.time}</span></div></div>)}{!notices.length&&<div className="empty"><strong>All clear</strong>No notifications need your attention.</div>}</div></div>}</div>}
function ProfilePopover({person,status,open,onToggle,onSettings,onSwitch}:{person:User;status?:StaffStatus;open:boolean;onToggle:()=>void;onSettings:()=>void;onSwitch:()=>void}){const availability=status?.availability||"Offline";return <div className="profile-wrap"><button className="top-profile" aria-expanded={open} aria-haspopup="menu" onClick={onToggle}><Avatar person={person}/><span className="profile-copy"><b>{person.name}</b><small>{accessOf(person)} · {availability}</small></span><ChevronRight className={`profile-chevron ${open?"open":""}`} size={14}/></button>{open&&<div className="profile-menu profile-menu-rich profile-menu-ios" role="menu"><div className="profile-ios-account"><Avatar person={person} size={62}/><b>{person.name}</b><span>{person.email}</span><small><i className={`availability-dot ${availability.toLowerCase()}`}/>{availability} · {person.department}</small></div><div className="profile-ios-actions"><button role="menuitem" onClick={onSettings}><span className="profile-action-icon"><Settings size={18}/></span><b>Settings</b><ChevronRight size={15}/></button><button role="menuitem" onClick={onSwitch}><span className="profile-action-icon neutral"><LogOut size={18}/></span><b>Switch account</b><ChevronRight size={15}/></button></div></div>}</div>}
function UnifiedWorkspace({user,team,statuses,tasks,allTasks,projectsData,departmentsData,objectives,can,onOpen,onProject,onDepartment,onModal,onEditObjective,onManage,onView,onObjective}:{user:User;team:User[];statuses:StaffStatus[];tasks:Task[];allTasks:Task[];projectsData:Project[];departmentsData:[string,string,string][];objectives:WeeklyObjective[];can:(x:string)=>boolean;onOpen:(id:string)=>void;onProject:(id:string)=>void;onDepartment:(department:string)=>void;onModal:(x:"task"|"person"|"blocker"|"project"|"objective"|"department"|null)=>void;onEditObjective:(objective:WeeklyObjective)=>void;onManage:(user:User)=>void;onView:(view:View)=>void;onObjective:(id:string)=>void}){
   const [healthNow,setHealthNow]=useState(()=>Date.now());
   useEffect(()=>{const timer=window.setInterval(()=>setHealthNow(Date.now()),60_000);return()=>window.clearInterval(timer)},[]);
  const blocked=tasks.filter(task=>task.status==="Blocked"); const review=tasks.filter(task=>task.status==="Submitted for Review");
  const scopedProjects=projectsData.filter(project=>isAdmin(user)||isManager(user)||project.assigneeIds.includes(user.id)||tasks.some(task=>task.project===project.name));
   const scopedPeople=team.filter(person=>isCurrentTeamMember(person)&&(isAdmin(user)||(isManager(user)?person.department===user.department:person.id===user.id||person.reportsTo===user.id)));
   const homePeople=(isManager(user)?scopedPeople.filter(person=>person.id!==user.id):scopedPeople.filter(person=>person.id!==user.id&&isManager(person))).slice(0,4);
   const scopedObjectives=objectivesForUser(objectives,user,team).slice().sort((a,b)=>objectivePriorityRank[a.priority]-objectivePriorityRank[b.priority]||a.dueDate.localeCompare(b.dueDate));
  const objectivePeople=(objective:WeeklyObjective)=>team.filter((person,index,people)=>[objective.managerId,objective.createdBy].includes(person.id)&&people.findIndex(candidate=>candidate.id===person.id)===index);
  const visibleDepartments=departmentsData.filter(department=>isAdmin(user)||department[0]===user.department);
   const managerFeedback=tasks.flatMap(task=>(task.updates||[]).filter(update=>["Manager","Admin","Superadmin"].includes(update.authorRole)||["Review feedback","Changes Requested"].includes(update.type)).map(update=>({task,update}))).sort((a,b)=>new Date(b.update.createdAt).getTime()-new Date(a.update.createdAt).getTime());
  const departmentHead=isManager(user)&&user.department&&user.department!==UNASSIGNED_DEPARTMENT;
   const departmentTasks=allTasks.filter(task=>taskDepartments(task).includes(user.department)&&task.status!=="Cancelled");
   const weeklyDepartmentTasks=departmentTasks.filter(task=>task.weeklyCommitment);
    const departmentGoalTasks=weeklyDepartmentTasks;
   const departmentBlocked=departmentGoalTasks.filter(task=>task.status==="Blocked").length;
   const departmentOpen=departmentGoalTasks.filter(task=>task.status!=="Completed").length;
    const departmentReview=departmentGoalTasks.filter(task=>task.status==="Submitted for Review");
    const departmentHealthCurve=useMemo(()=>departmentHealthCurveFor(departmentGoalTasks,healthNow,8),[departmentGoalTasks,healthNow]);
     const currentWeekDay=(new Date(healthNow).getDay()+6)%7;
    const departmentHealth=departmentHealthCurve[departmentHealthCurve.length-1]?.score||50;
    const departmentHealthState=departmentHealth>=68?"On track":departmentHealth>=44?"Needs attention":"At risk";
    const departmentAction=departmentReview[0]?`Review “${departmentReview[0].title}” and leave feedback now.`:departmentGoalTasks.find(task=>task.status==="Blocked")?`Resolve the blocker on “${departmentGoalTasks.find(task=>task.status==="Blocked")?.title}”.`:departmentOpen===0?`Create the next priority task for ${user.department}.`:`Review active work or create a focused task to lift ${user.department} delivery.`;
  const jobTitle=user.position||(departmentHead?`${user.department} Head`:isManager(user)?"Team Manager":accessOf(user)==="Superadmin"?"Operations Lead":accessOf(user)==="Admin"?"Operations Administrator":`${employmentOf(user)} team member`);
  const welcomeTitle=departmentHead?`${dayGreeting()}, ${user.department} Head.`:`${dayGreeting()}, ${user.name.split(" ")[0]}.`;
  const intern=employmentOf(user)==="Intern";
  return <div className={`workspace-board ${intern?"workspace-board-member":""}`}>
    <div className="workspace-stack workspace-stack-summary">
    <section id="workspace-overview" className="workspace-card workspace-welcome"><div className="workspace-welcome-message"><span>Personal workspace</span><h1>{welcomeTitle}</h1><p>Here is your workspace and what needs your attention today.</p></div><div className="workspace-profile-identity"><Avatar person={user} size={112}/><div><span className="workspace-job-role"><BriefcaseBusiness size={13}/>{jobTitle}</span><h2>{user.name}</h2><p>{user.email}</p></div></div><div className="workspace-profile-foot"><div className="workspace-profile-tags"><span>{accessOf(user)}</span><span>{user.department}</span></div><small>{employmentOf(user)} · Olyxee</small></div></section>
    </div>
    <div className="workspace-stack workspace-stack-work">
    <section id="workspace-tasks" className="workspace-card workspace-tasks workspace-tasks-ios"><div className="workspace-card-head"><div><span className="workspace-icon blue"><ClipboardList size={17}/></span><span><b>{accessOf(user)==="Member"?"Your tasks":"Tasks"}</b><small>{tasks.filter(task=>!["Completed","Cancelled"].includes(task.status)).length} active</small></span></div>{accessOf(user)!=="Member"&&<span className="workspace-head-actions">{can("task")&&<button onClick={()=>onModal("task")}><Plus size={14}/> New</button>}<button onClick={()=>onView("Tasks")}>See all <ChevronRight size={13}/></button></span>}</div><div className="workspace-list">{tasks.filter(task=>!["Completed","Cancelled"].includes(task.status)).slice(0,6).map(task=><button className={`workspace-home-task workspace-task-${task.status.toLowerCase().replace(/\s+/g,"-")}`} key={task.id} onClick={()=>onOpen(task.id)}><span className="workspace-home-task-icon"><ClipboardList size={16}/></span><span className="workspace-home-task-copy"><b>{task.title}</b><small>{task.project} · Due {task.due}</small><span><em>{task.code||task.id}</em>{task.githubUrl&&<em className="workspace-github-meta"><Github size={11}/> GitHub</em>}</span></span><span className="workspace-home-task-state"><Status s={task.status}/><ChevronRight size={15}/></span></button>)}{!tasks.filter(task=>!["Completed","Cancelled"].includes(task.status)).length&&<div className="workspace-empty">You are all caught up. No active tasks.</div>}</div></section>
    {accessOf(user)==="Member"?<section id="workspace-feedback" className="workspace-card workspace-feedback"><div className="workspace-card-head"><div><span className="workspace-icon amber"><MessageSquare size={17}/></span><span><b>Manager feedback</b><small>{managerFeedback.length?"Latest guidance on your work":"Nothing new yet"}</small></span></div><span className="workspace-feedback-count">{managerFeedback.length}</span></div><div className="workspace-list">{managerFeedback.slice(0,6).map(({task,update})=><button key={update.id} onClick={()=>onOpen(task.id)}><span><b>{task.title}</b><small>{update.type} · {update.authorName}</small><p>{update.message}</p></span><ChevronRight size={14}/></button>)}{!managerFeedback.length&&<div className="workspace-empty">Manager comments and review feedback will appear here.</div>}</div></section>:<section id="workspace-projects" className="workspace-card workspace-projects"><div className="workspace-card-head"><div><span className="workspace-icon amber"><BriefcaseBusiness size={17}/></span><b>Projects</b></div>{isAdmin(user)&&<span className="workspace-head-actions"><button onClick={()=>onModal("project")}><Plus size={14}/> New</button></span>}</div><div className="workspace-project-grid">{scopedProjects.slice(0,6).map(project=><button key={project.id} onClick={()=>onProject(project.id)} title={`Open ${project.name}`}><ProjectLogo project={project} size={72}/><b>{project.name}</b></button>)}{!scopedProjects.length&&<div className="workspace-empty">No assigned projects.</div>}</div></section>}
     </div>
     {accessOf(user)!=="Member"&&<div className="workspace-stack workspace-stack-operations">
    <section id="workspace-people" className="workspace-card workspace-people workspace-managers"><div className="workspace-card-head"><div><span className="workspace-icon violet"><Users size={17}/></span><b>{isManager(user)?"Department people":"Managers"}</b></div><span className="workspace-head-actions">{can("person")&&<button onClick={()=>onModal("person")}><UserPlus size={14}/> Add</button>}<button onClick={()=>onView("People")}>View all <ChevronRight size={13}/></button></span></div><div className="workspace-people-columns" aria-hidden="true"><span>{isManager(user)?"Team member":"Manager"}</span><span>{isManager(user)?"Role":"Department"}</span><span>Availability</span></div><div className="workspace-list">{homePeople.map(person=>{const status=statuses.find(item=>item.userId===person.id);return <button key={person.id} onClick={()=>onManage(person)}><span className="workspace-person-row"><Avatar person={person} size={36}/><span><b>{person.name}</b><small>{person.position||(isManager(user)?employmentOf(person):"Manager")}</small></span></span><span className="workspace-person-detail"><small>{isManager(user)?"Role":"Department"}</small><b>{isManager(user)?(person.position||employmentOf(person)):person.department}</b></span><StatusPill status={status}/></button>})}{homePeople.length===0&&<div className="workspace-empty">{isManager(user)?"No department members available.":"No managers available."}</div>}</div></section>
    <section id="workspace-departments" className="workspace-card workspace-departments"><div className="workspace-card-head"><div><span className="workspace-icon teal"><Building2 size={17}/></span><b>{isManager(user)?"Department health":"Departments"}</b></div><span className="workspace-head-actions">{isAdmin(user)&&<button onClick={()=>onModal("department")}><Plus size={14}/> New</button>}<button onClick={()=>isManager(user)?onDepartment(user.department):onView("Departments")}>{isManager(user)?"View department":"Open"} <ChevronRight size={13}/></button></span></div>{isManager(user)?<div className="manager-health-card"><button type="button" className="manager-health-open" onClick={()=>onDepartment(user.department)}><span><b>{user.department}</b><small className={`manager-health-state ${departmentHealthState.toLowerCase().replace(/\s+/g,"-")}`}>{departmentHealthState}</small></span><ChevronRight size={15}/></button><div className="manager-health-chart" aria-label={`${user.department} Monday to Sunday delivery health: ${departmentHealthState}`}><div className="manager-health-grid"><i/><i/><i/></div><svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img"><path className="manager-health-area" d={`M 18 136 ${departmentHealthCurve.map((item,index)=>`L ${18+index*(564/Math.max(1,departmentHealthCurve.length-1))} ${136-item.score*1.18}`).join(" ")} L 582 136 Z`}/><path className="manager-health-line" d={`M ${departmentHealthCurve.map((item,index)=>`${18+index*(564/Math.max(1,departmentHealthCurve.length-1))} ${136-item.score*1.18}`).join(" L ")}`}/>{departmentHealthCurve.map((item,index)=><circle key={item.label} cx={18+index*(564/Math.max(1,departmentHealthCurve.length-1))} cy={136-item.score*1.18} r={!item.future&&index===currentWeekDay?5:3}/>)}</svg></div><div className="manager-health-hours">{departmentHealthCurve.map(item=><span key={item.label}>{item.label}</span>)}</div><button type="button" className="manager-health-action" onClick={()=>departmentReview[0]?onOpen(departmentReview[0].id):onModal("task")}><AlertTriangle size={16}/><span><small>Recommended next action</small><b>{departmentAction}</b></span><ChevronRight size={15}/></button></div>:<div className="workspace-department-grid">{visibleDepartments.slice(0,4).map(department=>{const departmentTasks=allTasks.filter(task=>task.department===department[0]);const done=departmentTasks.filter(task=>task.status==="Completed").length;return <button type="button" key={department[0]} onClick={()=>onDepartment(department[0])}><span className="workspace-department-icon"><Building2 size={18}/></span><span className="workspace-department-copy"><b>{department[0]}</b><small>{department[1]}</small></span><strong>{done}/{departmentTasks.length}</strong><ChevronRight size={14}/></button>})}</div>}</section>
    </div>}
      {accessOf(user)!=="Member"&&<section id="workspace-review" className="workspace-card workspace-review workspace-review-home">
       <div className="workspace-card-head review-home-head"><div><span className="workspace-icon review-home-icon"><FileCheck2 size={17}/></span><span className="review-home-title"><b>Weekly review</b><small>{scopedObjectives.length} {scopedObjectives.length===1?"objective":"objectives"}{accessOf(user)==="Superadmin"?" across all departments":user.department?` for ${user.department}`:""}</small></span></div><span className="workspace-head-actions">{scopedObjectives.length>2&&<button onClick={()=>onView("Weekly Review")}>View all <ChevronRight size={13}/></button>}{(isAdmin(user)||isManager(user))&&<button onClick={()=>onModal("objective")}><Plus size={14}/> Add objective</button>}</span></div>
        <div className="review-home-objective-list">
            {scopedObjectives.slice(0,2).map(objective=>{const responsible=objectivePeople(objective);const owner=responsible[0];return <div className={`review-objective-row review-objective-${objective.status.toLowerCase().replace(/\s+/g,"-")}`} key={objective.id}><button type="button" className="review-objective-open" onClick={()=>onObjective(objective.id)} aria-label={`Open objective ${objective.title}`}><span className="review-objective-marker" aria-hidden="true">{objective.status==="Complete"?<Check size={18}/>:objective.status==="At risk"?<AlertTriangle size={17}/>:objective.status==="In progress"?<Clock3 size={18}/>:objective.status==="Not started"?<ClipboardList size={18}/>:<FileCheck2 size={17}/>}</span><span className="review-objective-copy"><b>{objective.title}</b><span className="review-objective-details"><i className={`review-objective-priority priority-${objective.priority.toLowerCase()}`}>{objective.priority}</i><small>Due {objective.dueDate}</small></span>{owner&&<span className="review-objective-owner"><span className="review-objective-owner-avatar"><Avatar person={owner} size={24}/></span><span><small>Owner</small><strong>{owner.name}</strong></span></span>}</span><span className="review-objective-meta">{responsible.length>0&&<span className="review-objective-people" aria-label={`Responsible: ${responsible.map(person=>person.name).join(", ")}`}>{responsible.slice(0,3).map(person=><span key={person.id} title={person.name}><Avatar person={person} size={29}/></span>)}</span>}<span className="workspace-objective-state">{objective.status}</span><ChevronRight className="review-objective-chevron" size={16}/></span></button>{(accessOf(user)==="Superadmin"||objective.managerId===user.id)&&<button type="button" className="review-objective-edit" aria-label={`Edit ${objective.title}`} title="Edit objective" onClick={()=>onEditObjective(objective)}><Pencil size={14}/></button>}</div>})}
         {!scopedObjectives.length&&<div className="review-home-empty">No weekly objectives assigned.</div>}
       </div>
     </section>}
  </div>
}
 function InternTaskBoard({tasks,onOpen}:{tasks:Task[];onOpen:(id:string)=>void}){
   const [filter,setFilter]=useState("All");
   const groups=["Not Started","In Progress","Blocked","Changes Requested","Submitted for Review","Completed"];
   const visible=filter==="All"?tasks:tasks.filter(task=>task.status===filter);
   return <div className="intern-task-board"><div className="intern-filter-row">{["All",...groups].map(item=><button key={item} className={filter===item?"active":""} onClick={()=>setFilter(item)}>{item}<span>{item==="All"?tasks.length:tasks.filter(task=>task.status===item).length}</span></button>)}</div><div className="intern-task-list">{visible.map(task=><button key={task.id} onClick={()=>onOpen(task.id)}><span className="intern-task-copy"><small>{task.project} · Due {task.due}</small><b>{task.title}</b></span><Status s={task.status}/><ChevronRight size={15}/></button>)}{!visible.length&&<div className="empty"><strong>No tasks in this view</strong>Your assigned work will appear here.</div>}</div></div>;
 }
  function InternFeedback({tasks,onOpen:_onOpen}:{tasks:Task[];onOpen:(id:string)=>void}){
    const [selectedId,setSelectedId]=useState<string|null>(null);
    const formatDuration=(hours:number)=>hours<1?"Under 1 hour":hours<24?`${Math.max(1,Math.round(hours))} hours`:`${Math.max(1,Math.round(hours/24))} ${Math.round(hours/24)===1?"day":"days"}`;
    const approved=tasks.filter(task=>task.status==="Completed"&&task.completedAt).map(task=>{const review=[...(task.updates||[])].reverse().find(update=>update.type==="Review feedback"&&["Manager","Admin","Superadmin"].includes(update.authorRole));if(!review)return null;const started=new Date(task.createdDate||task.startDate||review.createdAt).getTime();const completed=new Date(task.completedAt!).getTime();const due=new Date(`${task.due}T23:59:59`).getTime();const elapsedHours=Math.max(0,(completed-started)/3_600_000);const allowedHours=Math.max(1,(due-started)/3_600_000);const ratio=elapsedHours/allowedHours;const grade=ratio<=.6?"A":ratio<=.85?"B":ratio<=1?"C":ratio<=1.25?"D":"E";return{task,review,elapsedHours,grade}}).filter(Boolean) as {task:Task;review:NonNullable<Task["updates"]>[number];elapsedHours:number;grade:string}[];
    approved.sort((a,b)=>new Date(b.task.completedAt!).getTime()-new Date(a.task.completedAt!).getTime());
    const selected=approved.find(item=>item.task.id===selectedId);
     if(selected)return <div className="feedback-detail-page"><BackButton className="workspace-back" onClick={()=>setSelectedId(null)} label="Back to feedback"/><Header eyebrow="Approved work" title="Feedback details" subtitle="Your final manager review and completion result."/><div className="feedback-detail"><header><span className="feedback-detail-check"><Check size={20}/></span><div><small>Work approved</small><h2>{selected.task.title}</h2><p>{selected.task.project}</p></div><span className={`intern-speed-grade grade-${selected.grade.toLowerCase()}`}><small>Speed</small><b>{selected.grade}</b></span></header><section><span>Manager feedback</span><blockquote>{selected.review.message}</blockquote><small>Reviewed by {selected.review.authorName}</small></section><dl><div><dt>Completion time</dt><dd>{formatDuration(selected.elapsedHours)}</dd></div><div><dt>Approved on</dt><dd>{new Date(selected.task.completedAt!).toLocaleDateString()}</dd></div><div><dt>Due date</dt><dd>{new Date(`${selected.task.due}T00:00:00`).toLocaleDateString()}</dd></div><div><dt>Final result</dt><dd>Approved</dd></div></dl></div></div>;
    return <><Header eyebrow="Completed work" title="Feedback" subtitle="Your approved tasks, manager feedback, and completion-speed grades."/><div className="intern-updates intern-approved-feedback">{approved.map(({task,review,elapsedHours,grade})=><button key={task.id} onClick={()=>setSelectedId(task.id)}><span className="intern-update-mark approved"><Check size={16}/></span><span className="intern-approved-copy"><span className="intern-approved-heading"><b>{task.title}</b><strong>Work approved</strong></span><p>{review.message}</p><span className="intern-feedback-meta"><small>{review.authorName}</small><small><Clock3 size={12}/> Completed in {formatDuration(elapsedHours)}</small></span></span><span className={`intern-speed-grade grade-${grade.toLowerCase()}`}><small>Speed</small><b>{grade}</b></span></button>)}{!approved.length&&<div className="empty"><strong>No approved work yet</strong>Your final manager feedback and completion grade will appear here after a task is approved.</div>}</div></>;
 }
 function InternProjectFinder({projects}:{projects:Project[]}){
   return <div className="intern-project-finder"><Header eyebrow="Your projects" title="Projects" subtitle=""/><div className="intern-project-grid">{projects.map(project=><a className="intern-project-card" key={project.id} href={project.githubUrl} target="_blank" rel="noreferrer"><ProjectLogo project={project} size={72}/><b>{project.name}</b></a>)}{!projects.length&&<div className="intern-project-empty"><strong>No projects yet</strong></div>}</div></div>;
 }
 function ViewContent(p:{view:View;user:User;team?:User[];databasePeople:DatabasePerson[]|null;databasePeopleError:string;statuses:StaffStatus[];tasks:Task[];allTasks:Task[];projectsData:Project[];departmentsData:[string,string,string][];initialDepartment?:string|null;audit:Audit[];notices?:Notice[];objectives:WeeklyObjective[];objectiveId?:string|null;can:(x:string)=>boolean;onOpen:(id:string)=>void;onProject:(id:string)=>void;onView:(v:View)=>void;onObjective:(id:string)=>void;onEditObjective:(objective:WeeklyObjective)=>void;onSettings:()=>void;onModal:(x:"task"|"person"|"blocker"|"project"|"objective"|"department"|null)=>void;onManage:(u:User)=>void;update:(id:string,x:Partial<Task>)=>void;setTasks:React.Dispatch<React.SetStateAction<Task[]>>;setObjectives:React.Dispatch<React.SetStateAction<WeeklyObjective[]>>;setDepartmentsData:React.Dispatch<React.SetStateAction<[string,string,string][]>>;log:(s:string)=>void;flash:(s:string)=>void}){
       const {view,user,tasks,audit}=p; const today=new Date().toISOString().slice(0,10); const mine=tasks.filter(t=>t.assignee===user.id); const [peopleFilter,setPeopleFilter]=useState<"All"|"Employee"|"Intern">("All"); const [selectedDepartment,setSelectedDepartment]=useState<string|null>(p.initialDepartment||null); const [editingDepartment,setEditingDepartment]=useState<[string,string,string]|null>(null);
  if(view==="Overview"){
    const commitments=tasks.filter(t=>t.weeklyCommitment);
    const delivered=commitments.filter(t=>t.status==="Completed");
    const review=commitments.filter(t=>t.status==="Submitted for Review");
    const blocked=commitments.filter(t=>t.status==="Blocked");
    const active=commitments.filter(t=>!["Completed","Cancelled"].includes(t.status));
    const completion=commitments.length?Math.round(delivered.length/commitments.length*100):0;
     const overdue=active.filter(t=>t.due<today&&!blocked.includes(t)&&!review.includes(t));
     const attention=(user.role==="Super Admin"?[...blocked,...review,...overdue]:[...blocked,...review,...active.filter(t=>!blocked.includes(t)&&!review.includes(t))])
      .sort((a,b)=>a.due.localeCompare(b.due)).slice(0,5);
    const owner=(id?:string)=>id?((p.team||users).find(u=>u.id===id)?.name||"Unassigned"):"Unassigned";
     const myObjectives=p.objectives.filter(o=>user.role==="Super Admin"||o.managerId===user.id);
      if(user.role==="Manager"){
        const directReports=(p.team||[]).filter(person=>person.reportsTo===user.id&&isCurrentTeamMember(person));
        const decisions=[...blocked,...review].sort((a,b)=>a.due.localeCompare(b.due)).slice(0,4);
        const completeObjectives=myObjectives.filter(objective=>objective.status==="Complete").length;
         const openCommitments=commitments.filter(task=>!["Completed","Cancelled"].includes(task.status));
         const teamActiveWork=directReports.reduce((total,person)=>total+p.allTasks.filter(task=>task.assignee===person.id&&!["Completed","Cancelled"].includes(task.status)).length,0);
        return <div className="manager-overview"><Header eyebrow="Manager overview" title={`Good morning, ${user.name.split(" ")[0]}.`} subtitle="Your priorities, team delivery, and decisions that need attention."/>
           <div className="manager-signal-row">
             <div className="panel manager-signal manager-signal-primary"><div className="stat-label">Team delivery</div><div className="manager-signal-value">{completion}<span>%</span></div><div className="manager-progress"><i style={{width:`${completion}%`}}/></div><div className="stat-note">{delivered.length} of {commitments.length} weekly commitments delivered</div></div>
             <div className="panel manager-signal"><div className="stat-label">Your objectives</div><div className="manager-signal-value">{completeObjectives}<span> / {myObjectives.length}</span></div><div className="stat-note">complete this week</div></div>
             <div className={`panel manager-signal ${decisions.length?"manager-signal-attention":""}`}><div className="stat-label">Needs a decision</div><div className="manager-signal-value">{decisions.length}</div><div className="stat-note">{decisions.length?"blocked or awaiting review":"Nothing waiting"}</div></div>
           </div>
           <div className="manager-overview-grid">
             <div className="manager-overview-main">
                {myObjectives.length>0&&<div className="panel manager-priority"><div className="panel-head"><span><span className="panel-kicker">This week</span><span className="panel-title">Your objectives</span></span></div><div className="list">{myObjectives.map(objective=><button className="row overview-row manager-objective-row" key={objective.id} onClick={()=>p.onObjective(objective.id)}><span className={`manager-objective-marker manager-objective-${objective.status.toLowerCase().replace(/\s+/g,"-")}`}/><div className="row-main"><div className="row-title">{objective.title}</div><div className="row-meta">{objective.priority} priority · Due {objective.dueDate}</div></div><Status s={objective.status}/><ChevronRight size={14}/></button>)}</div></div>}
               <div className="panel manager-decisions"><div className="panel-head"><span><span className="panel-kicker">Keep moving</span><span className="panel-title">Needs your decision</span></span><span className="mono">{decisions.length} {decisions.length===1?"item":"items"}</span></div><div className="list">{decisions.map(task=><button className="row overview-row" key={task.id} onClick={()=>p.onOpen(task.id)}><div className="row-main"><div className="row-title">{task.title}</div><div className="row-meta">{owner(task.assignee)} · {task.project} · Due {task.due}</div></div><Status s={task.status}/><ChevronRight size={14}/></button>)}{!decisions.length&&<div className="empty"><strong>Nothing waiting</strong>No blockers or reviews need your decision.</div>}</div></div>
             </div>
             <div className="manager-overview-side">
               <div className="panel manager-delivery"><div className="panel-head"><span><span className="panel-kicker">Delivery summary</span><span className="panel-title">Commitments</span></span><span className="mono">{openCommitments.length} open</span></div><div className="manager-delivery-rows"><div><span>Completed</span><strong>{delivered.length}</strong></div><div><span>In review</span><strong>{review.length}</strong></div><div><span>Blocked</span><strong>{blocked.length}</strong></div></div></div>
               <div className="panel manager-staff"><div className="panel-head"><span><span className="panel-kicker">Team today</span><span className="panel-title">Direct reports</span></span><button className="panel-link" onClick={()=>p.onView("People")}>Open staff <ChevronRight size={13}/></button></div><div className="manager-staff-total"><strong>{teamActiveWork}</strong><span>active {teamActiveWork===1?"task":"tasks"} across {directReports.length} {directReports.length===1?"person":"people"}</span></div><div className="list">{directReports.map(person=>{const status=p.statuses.find(item=>item.userId===person.id);const activeWork=p.allTasks.filter(task=>task.assignee===person.id&&!["Completed","Cancelled"].includes(task.status)).length;return <div className="row" key={person.id}><div className="inline"><Avatar person={person}/><div><div className="row-title">{person.name}</div><div className="row-meta">{activeWork} active {activeWork===1?"task":"tasks"} · {status?.start||"—"}–{status?.end||"—"}</div></div></div><StatusPill status={status}/></div>})}{!directReports.length&&<div className="empty"><strong>No staff assigned</strong>Your direct reports will appear here.</div>}</div></div>
             </div>
           </div>
        </div>;
      }
    return <><Header eyebrow={user.role==="Super Admin"?"Executive summary":"Operating pulse"} title={user.role==="Super Admin"?"Operating summary":`Good morning, ${user.name.split(" ")[0]}.`} subtitle={user.role==="Super Admin"?"Manager priorities, delivery health, and exceptions requiring an executive decision.":"A clear read on commitments, delivery, and where attention is needed."}/>
      <div className="grid stats overview-stats">
         <div className="panel stat"><div className="stat-label">Weekly commitments</div><div className="stat-num">{commitments.length}</div><div className="stat-note">Current commitments scoped to you</div></div>
        <div className="panel stat"><div className="stat-label">Delivered</div><div className="stat-num">{delivered.length}<span className="stat-denom"> / {commitments.length}</span></div><div className="stat-note">approved with evidence</div></div>
        <div className="panel stat"><div className="stat-label">Review decisions</div><div className="stat-num">{review.length}</div><div className="stat-note">waiting for a decision</div></div>
        <div className="panel stat"><div className="stat-label">Blocked</div><div className="stat-num">{blocked.length}</div><div className="stat-note">{blocked.length?"requires a decision":"no active blockers"}</div></div>
      </div>
        {myObjectives.length>0&&<div className="panel objective-priority"><div className="panel-head"><span className="panel-title">Weekly priorities</span><span className="mono">{myObjectives.length} objectives</span></div><div className="list">{myObjectives.map(o=><div className="row" key={o.id}><div className="row-main"><div className="row-title">{o.title}</div><div className="row-meta">{user.role==="Super Admin"?owner(o.managerId):"Assigned to you"} · Due {o.dueDate}</div></div><Status s={o.status}/></div>)}</div></div>}
        <div className="overview-progress panel"><div><div className="panel-title">Current delivery</div><div className="row-meta">{delivered.length} of {commitments.length} weekly commitments delivered</div></div><strong>{completion}%</strong><div className="delivery-track"><span style={{width:`${completion}%`}}/></div></div>
       <div className="grid cols overview-columns">
        <div className="panel"><div className="panel-head"><span className="panel-title">{user.role==="Super Admin"?"Executive attention":"Next attention"}</span><span className="mono">{attention.length} items</span></div><div className="list">{attention.map(t=><button className="row overview-row" key={t.id} onClick={()=>p.onOpen(t.id)}><div className="row-main"><div className="row-title">{t.title}</div><div className="row-meta">{t.project} · {owner(t.assignee)} · Due {t.due}</div></div><Status s={t.status}/><ChevronRight size={14}/></button>)}{!attention.length&&<div className="empty">No commitments need executive attention.</div>}</div></div>
         <div className="panel"><div className="panel-head"><span className="panel-title">Decision queue</span><span className="badge amber">{review.length} awaiting</span></div><div className="list">{review.slice(0,4).map(t=><button className="row overview-row" key={t.id} onClick={()=>p.onOpen(t.id)}><div className="row-main"><div className="row-title">{t.title}</div><div className="row-meta">{t.id} · {owner(t.assignee)} · {t.pr?"Evidence linked":"Evidence missing"}</div></div><ChevronRight size={14}/></button>)}{!review.length&&<div className="empty">No review decisions waiting.</div>}</div></div>
      </div>
    </>;
  }
    if(view==="My Tasks"&&employmentOf(user)==="Intern")return <><Header eyebrow="My work" title="My Tasks" subtitle="Only work assigned to you, grouped by its current stage."/><InternTaskBoard tasks={mine.filter(task=>task.status!=="Cancelled")} onOpen={p.onOpen}/></>;
    if(view==="Tasks"&&accessOf(user)==="Member")return <><Header eyebrow="My work" title="Assigned tasks" subtitle="Open a task to view its brief, submit your pull request, or read Manager feedback."/><div className="panel"><div className="workspace-list">{mine.filter(task=>task.status!=="Cancelled").map(task=><button className={`workspace-task-${task.status.toLowerCase().replace(/\s+/g,"-")}`} key={task.id} onClick={()=>p.onOpen(task.id)}><span><b>{task.title}</b><small>{task.project} · Due {task.due}</small></span><Status s={task.status}/></button>)}{!mine.filter(task=>task.status!=="Cancelled").length&&<div className="workspace-empty">No tasks have been assigned to you.</div>}</div></div></>;
    if(view==="Feedback"&&employmentOf(user)==="Intern")return <InternFeedback tasks={mine} onOpen={p.onOpen}/>;
   if(view==="Tasks")return <><Header eyebrow="Work registry" title="Tasks" subtitle={isAdmin(user)?"The complete delivery record across Olyxee.":`Work for ${user.department}.`} action={p.can("task")&&<button className="btn primary" onClick={()=>p.onModal("task")}><Plus size={14}/> New task</button>}/><TaskList tasks={tasks} {...p}/></>;
    if(view==="Projects"){const assigned=p.projectsData.filter(project=>isAdmin(user)||isManager(user)||project.assigneeIds.includes(user.id)||mine.some(task=>task.project===project.name&&task.status!=="Cancelled"));if(employmentOf(user)==="Intern")return <InternProjectFinder projects={assigned}/>;const canSeeAll=isAdmin(user)||isManager(user);return <><Header eyebrow="Delivery map" title="Projects" subtitle={canSeeAll?"All active project workspaces and ownership.":"Projects connected to your assigned tasks."} action={isAdmin(user)&&<button className="btn primary" onClick={()=>p.onModal("project")}><Plus size={14}/> Create project</button>}/><div className="project-intro"><span><b>{assigned.length}</b> active workspaces</span><span>Open a project for delivery context, people, and resources.</span></div><div className="grid project-grid">{assigned.map((project,i)=>{const people=project.assigneeIds.map(id=>(p.team||users).find(person=>person.id===id&&isCurrentTeamMember(person))).filter(Boolean) as User[];return <button className="panel project-card" key={project.id} onClick={()=>p.onProject(project.id)}><div className="project-card-top"><div className="inline"><ProjectLogo project={project}/><div className="eyebrow">{String(i+1).padStart(2,"0")} / workspace</div></div><Status s={project.status}/></div><div className="task-title">{project.name}</div><p className="project-description">{project.description}</p><div className="project-card-people"><AvatarStack people={people}/><span>{people.length} assigned {people.length===1?"person":"people"}</span></div><div className="project-card-foot"><span>View project</span><ChevronRight size={15}/></div></button>})}{!assigned.length&&<div className="empty">{canSeeAll?"No projects are available yet.":"No projects are connected to your tasks yet."}</div>}</div></>;}
     if(view==="People"){
         const canSeeEveryone=isAdmin(user)||isManager(user);
         const directorySource=(canSeeEveryone?(p.databasePeople||[]):(p.team||users)).filter(isCurrentTeamMember);
        const directory=directorySource.filter(person=>canSeeEveryone||person.reportsTo===user.id);
       const employees=directory.filter(person=>employmentOf(person)==="Employee"); const interns=directory.filter(person=>employmentOf(person)==="Intern");
       const people=directory.filter(person=>peopleFilter==="All"||employmentOf(person)===peopleFilter);
        return <><Header eyebrow="Team directory" title="People" subtitle="Live employment, access, and account standing from Supabase." action={p.can("person")&&<button className="btn primary" onClick={()=>p.onModal("person")}><UserPlus size={14}/> Add {isManager(user)?"staff member":"person"}</button>}/>
       {canSeeEveryone?<><div className="people-summary"><button className={peopleFilter==="All"?"active":""} onClick={()=>setPeopleFilter("All")}><span>Everyone</span><strong>{p.databasePeople?directory.length:"—"}</strong></button><button className={peopleFilter==="Employee"?"active":""} onClick={()=>setPeopleFilter("Employee")}><span>Employees</span><strong>{p.databasePeople?employees.length:"—"}</strong></button><button className={peopleFilter==="Intern"?"active":""} onClick={()=>setPeopleFilter("Intern")}><span>Interns</span><strong>{p.databasePeople?interns.length:"—"}</strong></button></div><div className="people-filter-note">{p.databasePeople?<>Showing <b>{peopleFilter==="All"?"everyone":`${peopleFilter.toLowerCase()}s`}</b> · {people.length} people from Supabase</>:"Loading people from Supabase…"}</div></>:<div className="people-summary staff-summary"><button className="active"><span>Your staff</span><strong>{directory.length}</strong></button></div>}
        {p.databasePeopleError&&canSeeEveryone&&<div className="notice staff-database-notice">{p.databasePeopleError}</div>}
         <div className="panel table-wrap"><table className="table people-table"><thead><tr><th>Person</th><th>Employment</th><th>Access role</th><th>Department</th><th>Reports to</th><th>Availability</th><th>Account</th><th></th></tr></thead><tbody>{people.map(person=>{const staff=p.statuses.find(status=>status.userId===person.id);const databasePerson="source" in person&&person.source==="Supabase";return <tr key={person.id}><td><button className="people-profile-link" onClick={()=>p.onManage(person)}><Avatar person={person}/><span><b>{person.name}</b><small>{person.email||"No email recorded"}</small></span></button></td><td>{databasePerson?(person as DatabasePerson).employmentStatus||employmentOf(person):employmentOf(person)}</td><td><span className={`role-pill ${accessOf(person).toLowerCase()}`}>{accessOf(person)}</span></td><td>{person.department}{person.departmentReviewRequired&&<><br/><span className="badge amber">Supaadmin review</span></>}</td><td>{directorySource.find(item=>item.id===person.reportsTo)?.name||(databasePerson?(person as DatabasePerson).supervisorName:"")||"—"}</td><td>{databasePerson?<span className={`availability ${person.active?"available":"offline"}`}><i/>{person.active?"Active":"Inactive"}</span>:<StatusPill status={staff}/>}</td><td><span className={`people-status ${accountOf(person).toLowerCase()}`}>{accountOf(person)}</span></td><td><button className="btn" onClick={()=>p.onManage(person)}>View profile</button></td></tr>})}</tbody></table>{!people.length&&<div className="empty"><strong>No people found</strong>Try another employment filter.</div>}</div></>;
     }
    if(view==="Departments"){
      const directory=(p.team||users).filter(person=>isCurrentTeamMember(person));
        const visibleDepartments=p.departmentsData.filter(d=>isAdmin(user)||d[0]===user.department);
      const departmentTasks=(name:string)=>p.allTasks.filter(task=>taskDepartments(task).includes(name)&&task.status!=="Cancelled"&&task.weeklyCommitment);
      const departmentPeople=(name:string)=>directory.filter(person=>person.department===name&&person.active!==false);
     if(selectedDepartment){
       const department=visibleDepartments.find(d=>d[0]===selectedDepartment);
       if(!department)return null;
       const departmentTaskList=departmentTasks(selectedDepartment);
          const managerIds=directory.filter(person=>person.department===selectedDepartment&&isManager(person)).map(person=>person.id);
          const departmentObjectives=objectivesForUser(p.objectives,user,directory).filter(objective=>managerIds.includes(objective.managerId));
          const departmentMemberList=departmentPeople(selectedDepartment);
       if(isManager(user))return <ManagerDepartmentDetail user={user} department={department} tasks={departmentTaskList} objectives={departmentObjectives} team={directory} onBack={()=>p.onView("Overview")} onOpen={p.onOpen}/>;
       return <div className="department-detail">
          <BackButton className="department-back" onClick={()=>p.onView("Overview")} label="Back to Home"/>
           <Header eyebrow="Department workspace" title={selectedDepartment} subtitle={`${department[1]} · Weekly goals, delivery health, and the people working in this department.`}/>
            <DepartmentHealthPanel departmentName={selectedDepartment} tasks={departmentTaskList}/>
            <div className="grid cols department-insights department-insights-clean">
              <section className="panel"><div className="panel-head"><span><span className="panel-kicker">Monday–Sunday</span><span className="panel-title">Weekly goals</span></span><span className="mono">{departmentObjectives.length} recorded</span></div><div className="list">{departmentObjectives.map(objective=><div className="row" key={objective.id}><div className="row-main"><div className="row-title">{objective.title}</div><div className="row-meta">{objective.priority} priority · Due {objective.dueDate}</div></div><Status s={objective.status}/></div>)}{!departmentObjectives.length&&<div className="empty"><strong>No weekly goals</strong>No manager goal is assigned to this department for the week.</div>}</div></section>
              <section className="panel"><div className="panel-head"><span><span className="panel-kicker">Department roster</span><span className="panel-title">People working here</span></span><span className="mono">{departmentMemberList.length} people</span></div><div className="list">{departmentMemberList.map(person=><div className="row" key={person.id}><div className="inline"><Avatar person={person}/><div><div className="row-title">{person.name}</div><div className="row-meta">{person.position||employmentOf(person)} · {accessOf(person)}</div></div></div><StatusPill status={p.statuses.find(status=>status.userId===person.id)}/></div>)}{!departmentMemberList.length&&<div className="empty"><strong>No department people</strong>No active people are assigned to this department.</div>}</div></section>
            </div>
       </div>;
     }
         if(isManager(user)){
           const d=visibleDepartments[0]; if(!d)return <><Header eyebrow="Your team" title="Department" subtitle="No department has been assigned to your account."/><div className="panel empty"><strong>No department assigned</strong>Ask an administrator to assign your manager account to a department.</div></>;
            const departmentTaskList=departmentTasks(d[0]); const staff=departmentPeople(d[0]); const active=departmentTaskList.filter(task=>!["Completed","Cancelled"].includes(task.status)); const completed=departmentTaskList.filter(task=>task.status==="Completed").length; const blocked=active.filter(task=>task.status==="Blocked").length; const reviews=active.filter(task=>task.status==="Submitted for Review").length; const overdue=active.filter(task=>task.due<currentDate()).length; const completion=departmentTaskList.length?Math.round(completed/departmentTaskList.length*100):0;
           return <><Header eyebrow="Your team" title="Department" subtitle="A focused view of the department you lead and the work that needs your attention."/><button className="panel manager-department-card" onClick={()=>setSelectedDepartment(d[0])}><div className="manager-department-main"><div><div className="eyebrow">Your assigned department</div><h2>{d[0]}</h2><p>{d[2]}</p></div><span className="manager-department-open">View department <ChevronRight size={16}/></span></div><div className="manager-department-health"><div><span>Delivery health</span><strong>{completion}%</strong><div className="department-progress"><span style={{width:`${completion}%`}}/></div></div><div><span>Your staff</span><strong>{staff.length}</strong><small>direct reports</small></div><div><span>Active work</span><strong>{active.length}</strong><small>{overdue} overdue</small></div><div className={reviews?"attention":""}><span>Needs review</span><strong>{reviews}</strong><small>awaiting decision</small></div><div className={blocked?"danger":""}><span>Blocked</span><strong>{blocked}</strong><small>needs support</small></div></div></button></>;
         }
         return <><Header eyebrow="Organization" title="Departments" subtitle="Select a department to view its team, objectives, and delivery health."/><div className="department-grid">{visibleDepartments.map(d=>{
        const departmentTaskList=departmentTasks(d[0]); const people=departmentPeople(d[0]); const completed=departmentTaskList.filter(task=>task.status==="Completed").length; const open=departmentTaskList.filter(task=>!["Completed","Cancelled"].includes(task.status)).length; const blocked=departmentTaskList.filter(task=>task.status==="Blocked").length; const completion=departmentTaskList.length?Math.round(completed/departmentTaskList.length*100):0;
          return <button className="panel department-card department-card-open" key={d[0]} onClick={()=>setSelectedDepartment(d[0])}><div className="department-card-head"><div><div className="eyebrow">Official department</div><div className="task-title">{d[0]}</div></div><ChevronRight size={16}/></div><div className="row-meta">Lead · {d[1]}</div><div className="department-meter"><span style={{width:`${completion}%`}}/></div><div className="department-card-stats"><span><b>{completion}%</b> complete</span><span><b>{open}</b> open</span><span className={blocked?"metric-alert":""}><b>{blocked}</b> blocked</span><span><b>{people.length}</b> people</span></div></button>;
       })}</div></>;
   }
  if(view==="Blockers")return <><Header eyebrow="Needs a decision" title="Blockers" subtitle="Surface constraints early. Resolve or replan with context."/><div className="panel table-wrap"><table className="table"><thead><tr><th>Task</th><th>Blocker</th><th>Owner</th><th>Action</th></tr></thead><tbody>{tasks.filter(t=>t.status==="Blocked").map(t=><tr key={t.id}><td><b>{t.title}</b><br/><span className="muted">{t.id}</span></td><td>{t.blocker?.reason}</td><td>{users.find(u=>u.id===t.assignee)?.name}</td><td><button className="btn" onClick={()=>p.onOpen(t.id)}>Open task</button></td></tr>)}</tbody></table></div></>;
  if(view==="Weekly Review")return <Review objectives={p.objectives} objectiveId={p.objectiveId} team={p.team||users} tasks={p.tasks} user={user} onBack={()=>p.onView(employmentOf(user)==="Intern"?"Home":"Overview")} onOpenTask={p.onOpen} onObjective={p.onObjective} onEditObjective={p.onEditObjective} setObjectives={p.setObjectives}/>;
 if(view==="Notifications")return <><Header eyebrow="Updates" title="Notifications" subtitle="The decisions and changes that need your attention."/><div className="panel"><div className="list">{(p.notices||[]).map(n=><div className="row" key={n.id}><div className="inline"><div className="avatar" style={{background:n.title.includes("blocked")?"#f4e4e1":"#e6efe9"}}>O</div><div><div className="row-title">{n.title}</div><div className="row-meta">{n.body} · {n.time}</div></div></div><ChevronRight size={15}/></div>)}{!(p.notices||[]).length&&<div className="empty">No notifications.</div>}</div></div></>;
  if(view==="Integrations")return <><Header eyebrow="Data connections" title="Integrations" subtitle="Live services connected to Olyxee Ops."/><div className="panel"><div className="list">{[["Ops database","Accounts, sessions, projects, tasks, and workspace data"],["People database","Employees, interns, departments, and reporting lines"]].map(connection=><div className="row" key={connection[0]}><div className="inline"><div className="avatar">{connection[0][0]}</div><div><div className="row-title">{connection[0]}</div><div className="row-meta">{connection[1]}</div></div></div><span className="badge green">Connected</span></div>)}</div></div></>;
 if(view==="Audit Log")return <><Header eyebrow="Traceability" title="Audit Log" subtitle="Every important change has an actor and a timestamp."/><div className="panel table-wrap"><table className="table"><thead><tr><th>Event</th><th>Actor</th><th>When</th></tr></thead><tbody>{audit.map(event=><tr key={event.id}><td>{event.action}</td><td>{event.actor}</td><td className="mono">{event.time}</td></tr>)}</tbody></table>{!audit.length&&<div className="empty">No audit events recorded.</div>}</div></>;
   return <><Header eyebrow="Workspace controls" title="Settings" subtitle="Olyxee Ops database configuration and workspace status."/><div className="panel detail-section" style={{maxWidth:680}}><h3>Data storage</h3><div className="row"><div><b>Ops database</b><div className="row-meta">Accounts and operational workspace data</div></div><span className="badge green">Connected</span></div><div className="row"><div><b>People database</b><div className="row-meta">Employee and intern directory</div></div><span className="badge green">Connected</span></div><div className="row"><div><b>Tasks</b><div className="row-meta">{tasks.length} current records</div></div></div></div></>;
}
function DepartmentTrendChart({curve,label}:{curve:DepartmentHealthPoint[];label:string}){
  const x=(index:number)=>28+index*(544/Math.max(1,curve.length-1));
  const y=(score:number)=>168-score*1.35;
  const labelStep=Math.max(1,Math.ceil(curve.length/8));
  const area=`M ${x(0)} 174 ${curve.map((point,index)=>`L ${x(index)} ${y(point.score)}`).join(" ")} L ${x(curve.length-1)} 174 Z`;
  const latest=[...curve].reverse().find(point=>!point.future)||curve[curve.length-1];
  return <div className="department-trend-chart">
    <div className="department-trend-plot"><div className="manager-health-grid"><i/><i/><i/></div><svg viewBox="0 0 600 190" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${label}, currently ${latest?.score||0} out of 100`}><path className="manager-health-area" d={area}/>{curve.slice(1).map((point,index)=>{const previous=curve[index];return <line key={`${point.label}-${index}`} className={`department-trend-segment ${point.direction}`} x1={x(index)} y1={y(previous.score)} x2={x(index+1)} y2={y(point.score)}/>})}{curve.map((point,index)=><circle key={point.label} className={`department-trend-point ${point.direction}`} cx={x(index)} cy={y(point.score)} r={index===curve.length-1?5:3}><title>{point.label}: {point.score}/100 · {point.event}</title></circle>)}</svg></div>
    <div className="manager-detail-hours" style={{gridTemplateColumns:`repeat(${curve.length},minmax(0,1fr))`}}>{curve.map((point,index)=><span key={`${point.label}-${index}`} className={index%labelStep&&index!==curve.length-1?"hide-chart-label":""}>{point.label}</span>)}</div>
    <div className="department-trend-footer"><div className="department-trend-legend"><span><i className="up"/>Task activity / recovery</span><span><i className="down"/>No activity / decline</span><span><i className="steady"/>No score change</span></div><span className="department-trend-latest">{latest?.event}</span></div>
  </div>;
}
function DepartmentOverallProgress({tasks}:{tasks:Task[]}){
  const completed=tasks.filter(task=>task.status==="Completed").length;
  const percent=tasks.length?Math.round(completed/tasks.length*100):0;
  return <div className={`department-overall-progress ${tasks.length?"":"no-work"}`} aria-label={`Overall weekly progress: ${percent}%`}>
    <div><span><b>Overall progress</b><small>{tasks.length?`${completed} of ${tasks.length} weekly tasks completed`:"No weekly tasks created"}</small></span><strong>{percent}%</strong></div>
    <div className="department-overall-progress-track"><span style={{width:`${tasks.length?Math.max(percent,2):100}%`}}/></div>
  </div>;
}
function DepartmentHealthPanel({departmentName,tasks}:{departmentName:string;tasks:Task[]}){
  const goalTasks=tasks.some(task=>task.weeklyCommitment)?tasks.filter(task=>task.weeklyCommitment):tasks;
  const curve=departmentHealthCurveFor(goalTasks,Date.now());
  const score=curve[curve.length-1]?.score||50;
  const state=score>=68?"On track":score>=44?"Needs attention":"At risk";
  return <section className="panel admin-department-health" aria-labelledby="admin-department-health-title">
    <div className="admin-department-health-head"><div><span className="panel-kicker">Monday–Sunday · full week</span><h2 id="admin-department-health-title">Delivery health</h2><p>Blue rises show delivery activity. Red drops show blockers, overdue work, or a department with no weekly tasks. Upcoming days stay neutral once work is planned.</p></div><div className="admin-department-health-score"><strong>{score}</strong><span>/ 100</span><small className={`manager-detail-state ${state.toLowerCase().replace(/\s+/g,"-")}`}>{state}</small></div></div>
    <DepartmentTrendChart curve={curve} label={`${departmentName} delivery health`}/>
    <DepartmentOverallProgress tasks={goalTasks}/>
  </section>;
}
function ManagerDepartmentDetail({user,department,tasks,objectives,team,onBack,onOpen}:{user:User;department:[string,string,string];tasks:Task[];objectives:WeeklyObjective[];team:User[];onBack:()=>void;onOpen:(id:string)=>void}){
  const curve=departmentHealthCurveFor(tasks.filter(task=>task.weeklyCommitment).length?tasks.filter(task=>task.weeklyCommitment):tasks,Date.now());
  const departmentMembers=team.filter(person=>person.department===department[0]&&person.active!==false&&isCurrentTeamMember(person));
  const active=tasks.filter(task=>!["Completed","Cancelled"].includes(task.status));
  const review=tasks.filter(task=>task.status==="Submitted for Review").length;
  const blockedOrOverdue=tasks.filter(task=>task.status==="Blocked"||(!["Completed","Cancelled"].includes(task.status)&&task.due<currentDate())).length;
  const attention=[...tasks.filter(task=>["Blocked","Submitted for Review"].includes(task.status)),...active.filter(task=>task.due<currentDate()&&!["Blocked","Submitted for Review"].includes(task.status))].filter((task,index,list)=>list.findIndex(item=>item.id===task.id)===index).slice(0,6);
  const shown=attention.length?attention:active.slice(0,6);
  const lead=team.find(person=>person.name===department[1])||team.find(person=>isManager(person)&&person.department===department[0]);
  const score=curve[curve.length-1]?.score||50;
  const state=score>=68?"On track":score>=44?"Needs attention":"At risk";
  return <div className="manager-department-detail">
    <button type="button" className="manager-detail-back" onClick={onBack} aria-label="Back to Manager Home" title="Back to Manager Home"><ArrowLeft size={18}/></button>
    <header className="manager-detail-header"><div><span className="panel-kicker">Department health</span><h1>{department[0]}</h1><p>Led by {lead?.name||department[1]}</p></div><span className={`manager-detail-state ${state.toLowerCase().replace(/\s+/g,"-")}`}>{state}</span></header>
    <section className="panel manager-detail-chart" aria-labelledby="manager-health-detail-title"><div className="manager-detail-chart-head"><div><span className="panel-kicker">Monday–Sunday · full week</span><h2 id="manager-health-detail-title">Delivery health trend</h2><p>Blue rises show delivery activity. Red drops show blockers, overdue work, or no weekly tasks. The full week remains visible.</p></div><strong>{score}<small>/ 100</small></strong></div><DepartmentTrendChart curve={curve} label={`${department[0]} delivery health`}/><DepartmentOverallProgress tasks={tasks}/></section>
    <div className="manager-detail-metrics"><div><span>Department people</span><strong>{departmentMembers.length}</strong></div><div><span>Active work</span><strong>{active.length}</strong></div><div><span>Awaiting review</span><strong>{review}</strong></div><div><span>Blocked / overdue</span><strong className={blockedOrOverdue?"metric-alert":""}>{blockedOrOverdue}</strong></div></div>
    <div className="manager-detail-columns"><section className="panel"><div className="panel-head"><span><span className="panel-kicker">Current team</span><span className="panel-title">Department people</span></span><span className="mono">{departmentMembers.length}</span></div><div className="list">{departmentMembers.map(person=><div className="row" key={person.id}><div className="inline"><Avatar person={person}/><div><div className="row-title">{person.name}</div><div className="row-meta">{person.position||employmentOf(person)} · {accessOf(person)}</div></div></div></div>)}{!departmentMembers.length&&<div className="empty">No active people are assigned to this department.</div>}</div></section><section className="panel"><div className="panel-head"><span><span className="panel-kicker">{attention.length?"Needs attention":"This week"}</span><span className="panel-title">Department tasks</span></span><span className="mono">{shown.length}</span></div><div className="list">{shown.map(task=><button className="row manager-detail-task" key={task.id} onClick={()=>onOpen(task.id)}><div className="row-main"><div className="row-title">{task.title}</div><div className="row-meta">{task.project} · Due {task.due}</div></div><Status s={task.status}/><ChevronRight size={14}/></button>)}{!shown.length&&<div className="empty">No department tasks are recorded for this week.</div>}</div></section></div>
  </div>;
}

function TaskList({tasks,onOpen,team}:any){const [q,setQ]=useState("");const [status,setStatus]=useState("All");const [department,setDepartment]=useState("All");const [priority,setPriority]=useState("All");const [assignee,setAssignee]=useState("All");const people=(team||[]).filter((person:User)=>tasks.some((task:Task)=>taskAssignees(task).includes(person.id)));const departmentsList:string[]=[...new Set<string>(tasks.flatMap((task:Task)=>taskDepartments(task)))];const filtered=tasks.filter((t:Task)=>(status==="All"||t.status===status)&&(department==="All"||taskDepartments(t).includes(department))&&(priority==="All"||t.priority===priority)&&(assignee==="All"||taskAssignees(t).includes(assignee))&&`${t.title} ${t.project} ${t.code||t.id} ${taskDepartmentLabel(t)}`.toLowerCase().includes(q.toLowerCase()));return <><div className="filters"><div className="input search inline"><Search size={14}/><input style={{border:0,outline:0,width:"100%"}} placeholder="Search tasks" value={q} onChange={e=>setQ(e.target.value)}/></div><select className="select" value={department} onChange={e=>setDepartment(e.target.value)}><option value="All">All departments</option>{departmentsList.map(name=><option key={name}>{name}</option>)}</select><select className="select" value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="All">All assignees</option>{people.map((person:User)=><option key={person.id} value={person.id}>{person.name}</option>)}</select><select className="select" value={priority} onChange={e=>setPriority(e.target.value)}><option value="All">All priorities</option>{["Critical","Urgent","High","Normal","Medium","Low"].map(value=><option key={value}>{value}</option>)}</select><select className="select" value={status} onChange={e=>setStatus(e.target.value)}><option value="All">All statuses</option>{["Not Started","In Progress","Blocked","Submitted for Review","Changes Requested","Completed","Cancelled"].map(s=><option key={s}>{s}</option>)}</select></div><div className="panel table-wrap"><table className="table"><thead><tr><th>Task</th><th>Project</th><th>Departments</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>{filtered.map((t:Task)=><tr className="task-table-row" key={t.id} tabIndex={0} role="button" aria-label={`Open ${t.title}`} onClick={()=>onOpen(t.id)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onOpen(t.id)}}}><td><b>{t.title}</b><br/><span className="muted">{t.code||t.id} · {t.priority} priority</span></td><td>{t.project}</td><td>{taskDepartmentLabel(t)}{t.taskLeadId&&<><br/><span className="muted">Lead: {team?.find((person:User)=>person.id===t.taskLeadId)?.name||"Assigned"}</span></>}</td><td>{taskAssignees(t).map(id=>team?.find((u:User)=>u.id===id)?.name).filter(Boolean).join(", ")||"Unassigned"}</td><td>{t.due}</td><td><Status s={t.status}/></td><td><button className="btn" onClick={event=>{event.stopPropagation();onOpen(t.id)}}>View details</button></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty"><strong>No matching tasks</strong>Try a different search.</div>}</div></>}

function Github({size=15}:{size?:number}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 .7a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.24c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.49.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.4 1.23-3.25-.12-.3-.53-1.53.12-3.2 0 0 1-.33 3.3 1.24a11.5 11.5 0 0 1 6 0c2.29-1.57 3.3-1.24 3.3-1.24.65 1.67.24 2.9.12 3.2.77.85 1.23 1.93 1.23 3.25 0 4.63-2.8 5.65-5.48 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .7Z"/></svg>}
function ProjectDetail({user,project,tasks,objectives,team,onBack,onOpen,onProjectUpdated,onResourceAdded,flash}:{user:User;project:Project;tasks:Task[];objectives:WeeklyObjective[];team:User[];onBack:()=>void;onOpen:(id:string)=>void;onProjectUpdated:(project:Project)=>void;onResourceAdded:(resource:ProjectResource)=>void;flash:(message:string)=>void}){
  const [uploading,setUploading]=useState(false);
  const [editing,setEditing]=useState(false);
  const [githubUrl,setGithubUrl]=useState(project.githubUrl);
  const [logoUrl,setLogoUrl]=useState(project.logoUrl||"");
  const [processingLogo,setProcessingLogo]=useState(false);
  const currentAssigneeIds=project.assigneeIds.filter(id=>team.some(person=>person.id===id&&isCurrentTeamMember(person)));
  const [assigneeIds,setAssigneeIds]=useState(currentAssigneeIds);
  const [saving,setSaving]=useState(false);
  const projectTasks=tasks.filter(task=>task.project===project.name);
  const weeklyProjectTasks=projectTasks.filter(task=>task.weeklyCommitment);
  const manager=isManager(user);
  const canManageProject=isAdmin(user)||manager;
  const assignable=(manager?team.filter(person=>employmentOf(person)==="Intern"&&person.reportsTo===user.id&&person.active!==false):team.filter(isCurrentTeamMember)).sort((a,b)=>a.name.localeCompare(b.name));
  const projectDepartments=[...new Set([
    ...projectTasks.flatMap(task=>taskDepartments(task)),
    ...currentAssigneeIds.map(id=>team.find(person=>person.id===id)?.department).filter(Boolean) as string[],
  ])].filter(Boolean).sort();
  const departmentManagerIds=team.filter(person=>isManager(person)&&projectDepartments.includes(person.department)).map(person=>person.id);
  const projectName=project.name.toLowerCase();
  const weekStart=new Date(); weekStart.setHours(0,0,0,0); weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
  const weekEnd=new Date(weekStart); weekEnd.setDate(weekStart.getDate()+6);
  const weekStartDate=weekStart.toISOString().slice(0,10);
  const weekEndDate=weekEnd.toISOString().slice(0,10);
  const weeklyObjectives=objectives.filter(objective=>{
    const text=`${objective.title} ${objective.description}`.toLowerCase();
    return objective.dueDate>=weekStartDate&&objective.dueDate<=weekEndDate&&(departmentManagerIds.includes(objective.managerId)||text.includes(projectName));
  }).sort((a,b)=>objectivePriorityRank[a.priority]-objectivePriorityRank[b.priority]||a.dueDate.localeCompare(b.dueDate));
  const contributionRows=projectDepartments.map(department=>{
    const departmentTasks=weeklyProjectTasks.filter(task=>taskDepartments(task).includes(department));
    const signals=departmentTasks.reduce((total,task)=>total+
      (task.status==="Completed"?3:0)+
      (task.status==="Submitted for Review"?2:0)+
      (task.updates||[]).length+
      (task.activityLog||[]).filter(activity=>!activity.action.startsWith("Task created")).length,0);
    const completed=departmentTasks.filter(task=>task.status==="Completed").length;
    const people=[...new Set(departmentTasks.flatMap(task=>taskAssignees(task)))].length;
    return{department,tasks:departmentTasks.length,signals,completed,people};
  }).sort((a,b)=>b.signals-a.signals||b.tasks-a.tasks||a.department.localeCompare(b.department));
  const maxContribution=Math.max(1,...contributionRows.map(row=>row.signals));
  const readProjectLogo=async(file?:File)=>{if(!file)return;if(!file.type.startsWith("image/")){flash("Choose an image file");return}if(file.size>8*1024*1024){flash("Project logo must be smaller than 8 MB");return}setProcessingLogo(true);try{const source=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const element=new window.Image();element.onload=()=>resolve(element);element.onerror=reject;element.src=source});const side=Math.min(image.naturalWidth,image.naturalHeight);const canvas=document.createElement("canvas");canvas.width=320;canvas.height=320;const context=canvas.getContext("2d");if(!context)throw new Error("Could not process this logo");context.clearRect(0,0,320,320);context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,320,320);const compressed=canvas.toDataURL("image/webp",.86);if(compressed.length>450000)throw new Error("This logo could not be compressed enough. Choose a smaller image.");setLogoUrl(compressed);flash("Logo ready. Save changes to apply it.");}catch(error){flash(error instanceof Error?error.message:"Could not process project logo")}finally{setProcessingLogo(false)}};
  const addResource=async(file?:File)=>{if(!file||!isAdmin(user))return;setUploading(true);try{const kind=file.type.startsWith("image/")?"image":"document";const url=await uploadAsset(file,kind);const response=await fetch(`/api/projects/${encodeURIComponent(project.id)}/resources`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:file.name,kind,url})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Could not add this resource.");onResourceAdded(payload.resource);flash("Resource uploaded");}catch(error){flash(error instanceof Error?error.message:"Resource upload failed");}finally{setUploading(false);}};
  const saveProject=async()=>{setSaving(true);try{const response=await fetch(`/api/projects/${encodeURIComponent(project.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({githubUrl,assigneeIds,logoUrl})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Could not update this project.");onProjectUpdated(payload.project);setEditing(false);flash("Project updated");}catch(error){flash(error instanceof Error?error.message:"Project update failed");}finally{setSaving(false);}};
  return <div className="project-detail project-detail-clear">
    <BackButton onClick={onBack} label="Back to projects"/>
    <header className="project-detail-head project-detail-hero">
      <div className="project-heading"><ProjectLogo project={project} size={64}/><div><div className="eyebrow">Project workspace · {project.id}</div><h1 className="title">{project.name}</h1><p className="subtitle">{project.description}</p><div className="project-department-tags">{projectDepartments.map(department=><span key={department}><Building2 size={12}/>{department}</span>)}{!projectDepartments.length&&<span>Departments not assigned</span>}</div></div></div>
      <div className="inline">{canManageProject&&<button className="btn" onClick={()=>setEditing(value=>!value)}><Settings size={14}/> {manager?"Manage interns":"Edit project"}</button>}{project.githubUrl&&<a className="btn github-button" href={project.githubUrl} target="_blank" rel="noreferrer"><Github size={15}/> Open GitHub</a>}</div>
    </header>
    {editing&&<section className="panel detail-section project-edit-panel"><div className="panel-head"><div><b>{manager?"Project interns":"Project settings"}</b><div className="row-meta">{manager?"Add or remove interns who report to you.":`Update the project logo, repository access${accessOf(user)==="Superadmin"?", and assigned people":""}.`}</div></div><button className="btn primary" disabled={saving||processingLogo||(!manager&&!/^https?:\/\/(www\.)?github\.com\/.+/i.test(githubUrl))} onClick={saveProject}>{saving?"Saving…":"Save changes"}</button></div>{!manager&&<><label className="form-label">Project logo<div className="inline">{logoUrl?<img className="project-logo-preview" src={logoUrl} alt="Project logo preview"/>:<ProjectLogo project={{...project,logoUrl:undefined}} size={54}/>}<label className="btn">{processingLogo?"Processing…":"Choose logo"}<input type="file" hidden accept="image/*" disabled={processingLogo} onChange={event=>{void readProjectLogo(event.target.files?.[0]);event.currentTarget.value=""}}/></label>{logoUrl&&<button type="button" className="btn" disabled={processingLogo} onClick={()=>setLogoUrl("")}>Remove logo</button>}</div></label><label className="form-label">GitHub repository URL<input className="input" value={githubUrl} onChange={event=>setGithubUrl(event.target.value)} placeholder="https://github.com/olyxee/repository"/></label></>}{(accessOf(user)==="Superadmin"||manager)&&<div className="form-label project-assignee-picker">{manager?"Your interns":"Assigned people"}<div className="project-assignee-grid">{assignable.map(person=><label key={person.id}><input type="checkbox" checked={assigneeIds.includes(person.id)} onChange={event=>setAssigneeIds(current=>event.target.checked?[...current,person.id]:current.filter(id=>id!==person.id))}/><Avatar person={person} size={28}/><span><b>{person.name}</b><small>{person.position||person.department}</small></span></label>)}{manager&&!assignable.length&&<div className="row-meta">No active interns report to you.</div>}</div></div>}</section>}
    <div className="project-insight-grid">
      <section className="panel project-weekly-objectives">
        <div className="panel-head"><span><span className="panel-kicker">Monday–Sunday</span><span className="panel-title">Weekly objectives</span></span><span className="mono">{weeklyObjectives.length} goals</span></div>
        <div className="list">{weeklyObjectives.map(objective=><div className="row" key={objective.id}><div className="row-main"><div className="row-title">{objective.title}</div><div className="row-meta">{team.find(person=>person.id===objective.managerId)?.name||"Department manager"} · {objective.priority} priority · Due {objective.dueDate}</div></div><Status s={objective.status}/></div>)}{!weeklyObjectives.length&&<div className="empty"><strong>No weekly objectives connected</strong>Goals owned by the involved department managers will appear here.</div>}</div>
      </section>
      <section className="panel project-department-contribution">
        <div className="panel-head"><span><span className="panel-kicker">Current-week delivery signals</span><span className="panel-title">Department contribution</span></span><span className="mono">{contributionRows.length} departments</span></div>
        <div className="project-contribution-list">{contributionRows.map(row=><article key={row.department}><div><span><Building2 size={15}/><b>{row.department}</b></span><strong>{row.signals} signals</strong></div><div className="project-contribution-track"><span style={{width:`${row.signals?Math.max(8,row.signals/maxContribution*100):0}%`}}/></div><small>{row.tasks} weekly {row.tasks===1?"task":"tasks"} · {row.completed} completed · {row.people} contributors</small></article>)}{!contributionRows.length&&<div className="empty"><strong>No departments involved yet</strong>Assign departments to this project’s weekly tasks to begin contribution tracking.</div>}</div>
      </section>
    </div>
    <div className="project-detail-grid">
      <section className="panel"><div className="panel-head"><span><span className="panel-kicker">Current project work</span><span className="panel-title">Delivery tasks</span></span><span className="mono">{projectTasks.length} tasks</span></div><div className="list">{projectTasks.map(task=><button className="row project-task-row" key={task.id} onClick={()=>onOpen(task.id)}><div className="row-main"><div className="row-title">{task.title}</div><div className="row-meta">{task.code||task.id} · {taskDepartmentLabel(task)} · Due {task.due}</div></div><Status s={task.status}/><ChevronRight size={14}/></button>)}{!projectTasks.length&&<div className="empty">No tasks have been added to this project.</div>}</div></section>
      <aside className="project-side"><section className="panel detail-section"><h3>Assigned people</h3>{currentAssigneeIds.map(id=>{const person=team.find(item=>item.id===id);return <div className="project-person" key={id}><Avatar person={person}/><div><b>{person?.name||id}</b><div className="row-meta">{person?.position||employmentOf(person||emptyUser)} · {person?.department||"—"}</div></div></div>})}{!currentAssigneeIds.length&&<div className="row-meta">No people assigned.</div>}</section><section className="panel detail-section"><div className="panel-head"><h3>Resources</h3>{isAdmin(user)&&<label className="btn"><Upload size={14}/>{uploading?"Uploading…":"Upload"}<input type="file" hidden disabled={uploading} accept="image/*,.pdf,.doc,.docx,.txt,.md" onChange={event=>{void addResource(event.target.files?.[0]);event.currentTarget.value=""}}/></label>}</div>{project.resources.length?project.resources.map(resource=><a className="resource-row" key={resource.id} href={resource.url||undefined} target={resource.url?"_blank":undefined} rel="noreferrer">{resource.kind==="image"?<Image size={14}/>:<FileText size={14}/>}<span>{resource.name}</span></a>):<div className="row-meta">No resources uploaded.</div>}</section></aside>
    </div>
  </div>;
}
  function TaskDetail({task,user,team,projectsData,can,update,refresh,flash,deleteTask,onBack}:{task:Task;user:User;team:User[];projectsData:Project[];can:(x:string)=>boolean;update:(id:string,p:Partial<Task>)=>Promise<void>;refresh:()=>Promise<void>;flash:(message:string)=>void;deleteTask:(task:Task)=>Promise<void>;onBack:()=>void}){
       const mine=taskAssignees(task).includes(user.id); const reviewer=can("review")&&!mine; const [message,setMessage]=useState(""); const [linkUrl,setLinkUrl]=useState(""); const [checkText,setCheckText]=useState(""); const [showCheckForm,setShowCheckForm]=useState(false); const [showCommentForm,setShowCommentForm]=useState(false); const [evidenceUrl,setEvidenceUrl]=useState(""); const [evidenceLabel,setEvidenceLabel]=useState("Evidence"); const [evidenceFile,setEvidenceFile]=useState<File|null>(null); const [uploadingEvidence,setUploadingEvidence]=useState(false); const [summary,setSummary]=useState(""); const [reviewFeedback,setReviewFeedback]=useState(""); const [showFeedback,setShowFeedback]=useState(false); const [blocker,setBlocker]=useState(""); const [showBlocker,setShowBlocker]=useState(false); const [saving,setSaving]=useState(false); const [editAssignee,setEditAssignee]=useState(task.assignee||""); const [editPriority,setEditPriority]=useState(task.priority); const [editDue,setEditDue]=useState(task.due);
    const owner=team.find(person=>person.id===task.taskLeadId)?.name||team.find(person=>person.id===task.assignee)?.name||"Unassigned";
    const project=projectsData.find(item=>item.name===task.project);
    const collaborators=taskAssignees(task).filter(id=>id!==task.taskLeadId).map(id=>team.find(person=>person.id===id)).filter(Boolean) as User[];
      const validEvidenceUrl=!evidenceUrl.trim()||/^https?:\/\/\S+$/i.test(evidenceUrl.trim())||/^\/api\/assets\/[0-9a-f-]+$/i.test(evidenceUrl.trim());
      const nextStepCopy=task.status==="Not Started"?"Start the task when you are ready. This unlocks progress tracking and work submission.":task.status==="Blocked"?"Resume the task when the blocker has been cleared.":task.status==="Submitted for Review"?"Your work is with your Manager for review. You can still add a comment if needed.":task.status==="Completed"?"This task is complete. Your work and feedback remain available here.":task.status==="Cancelled"?"This task has been cancelled. No further action is required.":"Work through the checklist, share progress, and submit your work when it is ready.";
       if(employmentOf(user)==="Intern"&&mine)return <InternTaskDetail task={task} user={user} team={team} onBack={onBack} update={update} refresh={refresh} flash={flash}/>;
        if(isManager(user)&&reviewer)return <ManagerTaskDetail task={task} user={user} team={team} onBack={onBack} update={update} refresh={refresh} flash={flash} deleteTask={deleteTask}/>;
   const mutate=async(path:string,method:string,body:unknown,success:string)=>{setSaving(true);try{const response=await fetch(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||"Task update failed.");await refresh();flash(success);}catch(error){flash(error instanceof Error?error.message:"Task update failed.");}finally{setSaving(false)}};
     const submitWork=async()=>{if(!summary.trim()||!validEvidenceUrl)return;setSaving(true);try{if(evidenceUrl.trim()){const evidenceResponse=await fetch(`/api/tasks/${task.id}/evidence`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:evidenceLabel.trim()||"Evidence",url:evidenceUrl.trim()})});const evidenceResult=await evidenceResponse.json();if(!evidenceResponse.ok)throw new Error(evidenceResult.error||"Could not attach evidence.");}const submitResponse=await fetch(`/api/tasks/${task.id}/submit`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({summary:summary.trim()})});const submitResult=await submitResponse.json();if(!submitResponse.ok)throw new Error(submitResult.error||"Could not send this task for review.");await refresh();setEvidenceUrl("");setSummary("");flash("Work sent for review.");}catch(error){flash(error instanceof Error?error.message:"Could not submit the work.");}finally{setSaving(false)}};
     const chooseEvidence=async(file?:File)=>{if(!file)return;const kind=file.type.startsWith("image/")?"image":"document";setUploadingEvidence(true);try{const url=await uploadAsset(file,kind);setEvidenceFile(file);setEvidenceLabel(file.name);setEvidenceUrl(url);flash("Evidence file ready.");}catch(error){flash(error instanceof Error?error.message:"Could not upload evidence.");}finally{setUploadingEvidence(false)}};
      return <div className={`task-detail ${employmentOf(user)==="Intern"?"task-detail-intern":"task-detail-manager"}`}>
      {isAdmin(user)&&<button className="btn danger" disabled={saving} onClick={()=>deleteTask(task)}>Delete task</button>}
     <BackButton onClick={onBack} label="Back to tasks"/>
       <div className="task-workspace-head"><div><div className="eyebrow">{task.code||task.id} / {task.project} / {taskDepartmentLabel(task)}</div><h1 className="title">{task.title}</h1><div className="inline"><Status s={task.status}/><span className="muted">{task.priority} priority · Due {task.due}</span></div></div><div className="task-head-actions">{task.githubUrl&&<a className="btn task-github-link" href={task.githubUrl} target="_blank" rel="noreferrer"><Github size={15}/> Open GitHub</a>}<div className="task-ownership"><span>Assigned to <b>{owner}</b></span><span>Assigned by <b>{task.creatorName||"Olyxee"}</b></span></div></div></div>
       <section className="task-detail-summary" aria-label="Task summary"><span><small>Departments</small><b>{taskDepartmentLabel(task)}</b></span><span><small>Lead</small><b>{owner}</b></span><span><small>Due date</small><b>{task.due}</b></span><span><small>Priority</small><b>{task.priority}</b></span>{task.deliverables&&<span className="task-deliverables-summary"><small>Deliverables</small><b>{task.deliverables}</b></span>}</section>
        <section className="task-collaboration" aria-label="Task collaboration"><div><span className="task-collaboration-icon"><Users size={18}/></span><span><small>Task team</small><b>{taskAssignees(task).length?`${taskAssignees(task).length} ${taskAssignees(task).length===1?"owner":"owners"}`:"Unassigned"}</b></span></div>{taskAssignees(task).length?<div className="task-collaborator-list">{taskAssignees(task).map(id=>{const person=team.find(item=>item.id===id);return person?<span key={person.id} title={person.name}><Avatar person={person} size={34}/><span><b>{person.name}{id===task.taskLeadId?" · Lead":""}</b><small>{person.position||person.department}</small></span></span>:null})}</div>:<p>No assignees are assigned to this task.</p>}</section>
     {task.blockerReason&&<div className="notice task-blocker"><AlertTriangle size={14}/> <b>Blocked:</b> {task.blockerReason}</div>}
      {mine&&["In Progress","Changes Requested"].includes(task.status)&&<div className="task-file-evidence"><label className="btn">{uploadingEvidence?"Uploading…":"Choose evidence file"}<input type="file" hidden accept="image/*,.pdf,.txt,.md,.doc,.docx" disabled={uploadingEvidence||saving} onChange={event=>{void chooseEvidence(event.target.files?.[0]);event.currentTarget.value=""}}/></label>{evidenceFile&&<span>{evidenceFile.name}</span>}<small>Optional. You can also paste a URL below.</small></div>}
      <div className="task-workspace-grid">
        <section className="panel detail-section task-main"><div className="task-description-card"><div className="task-section-heading"><span><FileText size={18}/></span><div><h3>Task brief</h3><p>What you need to deliver.</p></div></div><p>{task.description||"No description provided."}</p></div>
         <div className="task-section"><h3>Progress checklist</h3><div className="task-checklist">{(task.checklist||[]).map(item=><label key={item.id}><input type="checkbox" checked={item.completed} disabled={!mine||saving} onChange={event=>mutate(`/api/tasks/${task.id}/checklist/${item.id}`,"PATCH",{completed:event.target.checked},"Checklist updated.")}/><span>{item.text}</span></label>)}{!(task.checklist||[]).length&&<p className="row-meta">No checklist items yet.</p>}</div>{(mine||reviewer)&&<div className="inline"><input className="input" value={checkText} onChange={e=>setCheckText(e.target.value)} placeholder="Add checklist item"/><button className="btn" disabled={!checkText.trim()||saving} onClick={async()=>{await mutate(`/api/tasks/${task.id}/checklist`,"POST",{text:checkText},"Checklist item added.");setCheckText("")}}>Add</button></div>}</div>
           <div className="task-section task-delivery-section"><div className="task-section-heading"><span><FileCheck2 size={18}/></span><div><h3>Submit your work</h3><p>Add a required summary and optional evidence link.</p></div></div><div className="task-evidence">{(task.evidence||[]).map(item=><a href={item.url} target="_blank" rel="noreferrer" key={item.id}><FileText size={14}/><span>{item.label}</span></a>)}</div>{mine&&["In Progress","Changes Requested"].includes(task.status)&&<div className="task-pr-submit"><label>Evidence label<input className="input" value={evidenceLabel} onChange={e=>setEvidenceLabel(e.target.value)} placeholder="Demo, design file, repository"/></label><label>Evidence link <span className="muted">(optional)</span><input className="input" type="url" value={evidenceUrl} onChange={e=>setEvidenceUrl(e.target.value)} placeholder="https://…"/></label>{evidenceUrl&&!validEvidenceUrl&&<small className="person-field-error">Enter a valid http(s) link.</small>}<label>Submission summary<textarea className="textarea" rows={3} value={summary} onChange={e=>setSummary(e.target.value)} placeholder="What did you complete, and what should your Manager review?"/></label><button className="btn primary" disabled={!summary.trim()||!validEvidenceUrl||saving} onClick={submitWork}><FileCheck2 size={15}/>{saving?"Sending…":"Submit for review"}</button></div>}{mine&&task.status==="Not Started"&&<div className="task-pr-guidance">Start the task first. When your work is ready, the submission form will appear here.</div>}{task.status==="Submitted for Review"&&<div className="task-pr-guidance submitted"><Check size={15}/> Your work has been sent for review.</div>}</div>
           <details className="task-section task-secondary-section" open={accessOf(user)!=="Member"}><summary>Discussion <span>{(task.updates||[]).length}</span></summary><div className="task-secondary-content"><div className="task-section-heading"><span><CircleHelp size={18}/></span><div><h3>Discussion</h3><p>Questions and comments stay attached to this task.</p></div></div><div className="task-feed">{(task.updates||[]).map(item=><article className={item.authorRole==="Manager"?"manager-comment":""} key={item.id}><div><b>{item.authorName}</b><span>{item.authorRole} · {new Date(item.createdAt).toLocaleString()}</span></div><small>{item.type}</small><p>{item.message}</p>{item.linkUrl&&<a href={item.linkUrl} target="_blank" rel="noreferrer">{item.linkUrl}</a>}</article>)}{!(task.updates||[]).length&&<div className="task-feed-empty">No discussion yet.</div>}</div><div className="task-update-form"><textarea className="textarea" rows={3} value={message} onChange={e=>setMessage(e.target.value)} placeholder={mine?"Ask your Manager a question or leave a comment…":"Leave a clear comment for the assignee…"}/><input className="input" type="url" value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="Optional supporting link"/><button className="btn" disabled={!message.trim()||saving} onClick={async()=>{await mutate(`/api/tasks/${task.id}/updates`,"POST",{type:"General comment",message,linkUrl},"Comment posted.");setMessage("");setLinkUrl("")}}>Post comment</button></div></div></details>
       </section>
        <aside className="task-side"><section className="panel detail-section"><h3>{mine?"Next step":"Actions"}</h3>{mine&&<p className="task-next-step-copy">{nextStepCopy}</p>}<div className="form-grid">{mine&&task.status==="Not Started"&&<button className="btn primary" disabled={saving} onClick={()=>update(task.id,{status:"In Progress"})}>Start working</button>}{mine&&!["Blocked","Completed","Cancelled","Submitted for Review"].includes(task.status)&&!showBlocker&&<button className="btn" onClick={()=>setShowBlocker(true)}>I need help</button>}{mine&&!["Blocked","Completed","Cancelled","Submitted for Review"].includes(task.status)&&showBlocker&&<><textarea className="textarea" rows={3} autoFocus value={blocker} onChange={e=>setBlocker(e.target.value)} placeholder="What is stopping you?"/><div className="inline"><button className="btn" onClick={()=>{setShowBlocker(false);setBlocker("")}}>Cancel</button><button className="btn danger" disabled={!blocker.trim()||saving} onClick={()=>update(task.id,{status:"Blocked",blockerReason:blocker})}>Tell my Manager</button></div></>}{mine&&task.status==="Blocked"&&<button className="btn primary" disabled={saving} onClick={()=>update(task.id,{status:"In Progress"})}>Resume working</button>}{task.status==="Submitted for Review"&&reviewer&&<><button className="btn primary" disabled={saving} onClick={()=>update(task.id,{status:"Completed"})}>Approve and complete</button><button className="btn" disabled={saving} onClick={()=>update(task.id,{status:"Changes Requested"})}>Request changes</button></>}</div></section>{isAdmin(user)&&<section className="panel detail-section"><h3>Task administration</h3><div className="form-grid"><label className="form-label">Assignee<select className="select" value={editAssignee} onChange={e=>setEditAssignee(e.target.value)}><option value="">Unassigned</option>{team.filter(isCurrentTeamMember).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="form-label">Priority<select className="select" value={editPriority} onChange={e=>setEditPriority(e.target.value as Task["priority"])}>{["Critical","High","Medium","Low"].map(value=><option key={value}>{value}</option>)}</select></label><label className="form-label">Due date<input className="input" type="date" value={editDue} onChange={e=>setEditDue(e.target.value)}/></label><button className="btn" disabled={!editDue||saving} onClick={()=>mutate(`/api/tasks/${task.id}`,"PATCH",{assignee:editAssignee,priority:editPriority,due:editDue},"Task details updated.")}>Save task details</button></div></section>}<details className="panel detail-section task-activity-panel" open={accessOf(user)!=="Member"}><summary>Activity <span>{(task.activityLog||[]).length}</span></summary><div className="task-activity">{(task.activityLog||[]).map(item=><div key={item.id}><b>{item.action}</b><span>{item.actorName} · {new Date(item.createdAt).toLocaleString()}</span></div>)}</div></details></aside>
     </div>
   </div>
  }
 function ManagerTaskDetail({task,user,team,onBack,update,refresh,flash,deleteTask}:{task:Task;user:User;team:User[];onBack:()=>void;update:(id:string,p:Partial<Task>)=>Promise<void>;refresh:()=>Promise<void>;flash:(message:string)=>void;deleteTask:(task:Task)=>Promise<void>}){
  const [saving,setSaving]=useState(false);
  const [showCheckForm,setShowCheckForm]=useState(false);
  const [showCommentForm,setShowCommentForm]=useState(false);
  const [checkText,setCheckText]=useState("");
  const [message,setMessage]=useState("");
   const [reviewFeedback,setReviewFeedback]=useState("");
  const assignee=team.find(person=>person.id===task.taskLeadId)||team.find(person=>taskAssignees(task).includes(person.id));
  const owner=assignee?.name||"Unassigned";
  const submissions=(task.updates||[]).filter(item=>["Submission","Resubmission"].includes(item.type));
  const latestSubmission=submissions[submissions.length-1];
  const discussion=(task.updates||[]).filter(item=>!["Submission","Resubmission","Progress update"].includes(item.type));
  const completedChecks=(task.checklist||[]).filter(item=>item.completed).length;
  const mutate=async(path:string,body:unknown,success:string)=>{
    setSaving(true);
    try{
      const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Task update failed.");
      await refresh(); flash(success); return true;
    }catch(error){flash(error instanceof Error?error.message:"Task update failed.");return false}
    finally{setSaving(false)}
  };
  const addChecklist=async()=>{
    if(!checkText.trim())return;
    if(await mutate(`/api/tasks/${task.id}/checklist`,{text:checkText.trim()},"Checklist item added.")){setCheckText("");setShowCheckForm(false)}
  };
  const postComment=async()=>{
    if(!message.trim())return;
    if(await mutate(`/api/tasks/${task.id}/updates`,{type:"General comment",message:message.trim()},"Comment posted.")){setMessage("");setShowCommentForm(false)}
  };
  return <div className="task-detail task-detail-manager">
    <BackButton onClick={onBack} label="Back to tasks"/>
    <header className="manager-task-head"><div><div className="eyebrow">{task.code||task.id} · {task.project}</div><h1 className="title">{task.title}</h1><div className="task-work-meta"><Status s={task.status}/><span>{owner}</span><span>Due {task.due}</span><span>{task.priority} priority</span></div></div>{task.githubUrl&&<a className="btn task-github-link" href={task.githubUrl} target="_blank" rel="noreferrer"><Github size={15}/> Open GitHub</a>}</header>
     {task.deliverables&&<section className="manager-task-section task-deliverables-summary"><div className="manager-section-title"><div><h2>Deliverables</h2><p>Expected outcome for this task.</p></div></div><p className="manager-task-brief">{task.deliverables}</p></section>}{task.blockerReason&&<div className="notice task-blocker"><AlertTriangle size={14}/><b>Needs attention:</b> {task.blockerReason}</div>}
     {task.status==="Submitted for Review"&&<section className="manager-review-callout"><div><small>Review required</small><h2>Review {owner}’s work</h2><p>{latestSubmission?.message||"The work has been submitted and is ready for your review."}</p></div><div className="manager-review-form"><label>Written feedback<textarea className="textarea" rows={3} value={reviewFeedback} onChange={event=>setReviewFeedback(event.target.value)} placeholder={`Tell ${owner} what was done well or what needs to change…`}/></label><div className="manager-decision-actions"><button className="btn" disabled={saving||!reviewFeedback.trim()} onClick={()=>update(task.id,{status:"Changes Requested",feedback:reviewFeedback.trim()} as Partial<Task>)}>Request changes</button><button className="btn primary" disabled={saving||!reviewFeedback.trim()} onClick={()=>update(task.id,{status:"Completed",feedback:reviewFeedback.trim()} as Partial<Task>)}><Check size={15}/> Save review & approve</button></div></div></section>}
    <div className="manager-task-grid">
      <main className="manager-task-main">
        <section className="manager-task-section"><div className="manager-section-title"><div><h2>Task brief</h2><p>What was assigned.</p></div></div><p className="manager-task-brief">{task.description||"No description was provided."}</p></section>
        <section className="manager-task-section"><div className="manager-section-title"><div><h2>Submission</h2><p>{latestSubmission?`Submitted by ${latestSubmission.authorName}`:"No work has been submitted yet."}</p></div></div>{latestSubmission?<div className="manager-submission"><p>{latestSubmission.message}</p><small>{new Date(latestSubmission.createdAt).toLocaleString()}</small></div>:<div className="intern-empty">Waiting for the intern to submit their work.</div>}{task.evidence?.length?<div className="intern-evidence-list">{task.evidence.map(item=><a key={item.id} href={item.url} target="_blank" rel="noreferrer"><FileText size={14}/>{item.label}</a>)}</div>:null}</section>
        <details className="manager-task-section manager-collapsible"><summary>Checklist <span>{completedChecks}/{(task.checklist||[]).length}</span></summary><div className="manager-collapsible-body"><div className="task-checklist">{(task.checklist||[]).map(item=><label key={item.id}><input type="checkbox" checked={item.completed} disabled/><span>{item.text}</span></label>)}{!(task.checklist||[]).length&&<p className="row-meta">No checklist items.</p>}</div>{!showCheckForm?<button className="btn" onClick={()=>setShowCheckForm(true)}>Add checklist item</button>:<div className="manager-inline-form"><input className="input" value={checkText} onChange={event=>setCheckText(event.target.value)} placeholder="Checklist item" autoFocus/><div className="inline"><button className="btn" onClick={()=>{setShowCheckForm(false);setCheckText("")}}>Cancel</button><button className="btn primary" disabled={!checkText.trim()||saving} onClick={addChecklist}>Add</button></div></div>}</div></details>
        <details className="manager-task-section manager-collapsible"><summary>Discussion <span>{discussion.length}</span></summary><div className="manager-collapsible-body"><div className="intern-discussion">{discussion.map(item=><article key={item.id}><div><b>{item.authorName}</b><span>{item.authorRole} · {new Date(item.createdAt).toLocaleString()}</span></div><p>{item.message}</p></article>)}{!discussion.length&&<div className="intern-empty">No messages yet.</div>}</div>{!showCommentForm?<button className="btn" onClick={()=>setShowCommentForm(true)}>Add comment</button>:<div className="manager-inline-form"><textarea className="textarea" rows={3} value={message} onChange={event=>setMessage(event.target.value)} placeholder={`Write a short message to ${owner}…`} autoFocus/><div className="inline"><button className="btn" onClick={()=>{setShowCommentForm(false);setMessage("")}}>Cancel</button><button className="btn primary" disabled={!message.trim()||saving} onClick={postComment}>Post comment</button></div></div>}</div></details>
      </main>
       <aside className="manager-task-side">{assignee?<section className="manager-assignee-profile"><div className="manager-assignee-avatar"><Avatar person={assignee} size={58}/><span className={accountOf(assignee)==="Active"?"is-active":""}/></div><div className="manager-assignee-identity"><small>Assigned to</small><h3>{assignee.name}</h3><p>{assignee.position||employmentOf(assignee)}</p></div><div className="manager-assignee-details"><span><small>Department</small><b>{assignee.department||"Unassigned"}</b></span><span><small>Account</small><b>{accountOf(assignee)}</b></span></div>{assignee.email&&<a href={`mailto:${assignee.email}`}>{assignee.email}</a>}{assignee.githubUsername&&<a href={`https://github.com/${assignee.githubUsername}`} target="_blank" rel="noreferrer"><Github size={13}/>@{assignee.githubUsername}</a>}</section>:<section className="manager-assignee-profile manager-assignee-empty"><small>Assigned to</small><b>Unassigned</b><p>Assign someone before work begins.</p></section>}<section><small>Status</small><Status s={task.status}/></section><section><small>Due date</small><b>{task.due}</b></section><section><small>Priority</small><b>{task.priority}</b></section>{task.createdBy===user.id&&<section><button className="btn danger" disabled={saving} onClick={()=>deleteTask(task)}>Delete task</button></section>}<details><summary>Activity <span>{(task.activityLog||[]).length}</span></summary><div className="task-activity">{(task.activityLog||[]).map(item=><div key={item.id}><b>{item.action}</b><span>{item.actorName} · {new Date(item.createdAt).toLocaleString()}</span></div>)}</div></details></aside>
    </div>
  </div>
}

function InternTaskDetail({task,user,team,onBack,update,refresh,flash}:{task:Task;user:User;team:User[];onBack:()=>void;update:(id:string,p:Partial<Task>)=>Promise<void>;refresh:()=>Promise<void>;flash:(message:string)=>void}){
  const [comment,setComment]=useState("");
  const [summary,setSummary]=useState("");
  const [evidenceUrl,setEvidenceUrl]=useState("");
  const [evidenceLabel,setEvidenceLabel]=useState("Evidence");
  const [evidenceFile,setEvidenceFile]=useState<File|null>(null);
  const [uploading,setUploading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [showSubmitForm,setShowSubmitForm]=useState(false);
  const [showCommentForm,setShowCommentForm]=useState(false);
  const [completingItemId,setCompletingItemId]=useState<string|null>(null);
  const [completionNote,setCompletionNote]=useState("");
  const [helpOpen,setHelpOpen]=useState(false);
  const [helpCategory,setHelpCategory]=useState("Requirements unclear");
  const [helpExplanation,setHelpExplanation]=useState("");
   const owner=team.find(person=>person.id===task.taskLeadId)?.name||team.find(person=>person.id===task.assignee)?.name||"Your Manager";
  const validEvidenceUrl=!evidenceUrl.trim()||/^https?:\/\/\S+$/i.test(evidenceUrl.trim())||/^\/api\/assets\/[0-9a-f-]+$/i.test(evidenceUrl.trim());
  const feedback=[...(task.updates||[])].filter(item=>item.type==="Review feedback"||item.type==="Changes Requested").pop();
  const discussion=(task.updates||[]).filter(item=>!["Progress update","Submission","Resubmission","Review feedback","Changes Requested","Help requested"].includes(item.type));
  const hasPriorSubmission=(task.updates||[]).some(item=>["Submission","Resubmission"].includes(item.type));
  const helpRequested=(task.activityLog||[]).some(item=>item.action==="Help requested");
  const canWork=task.status==="In Progress";
  const canAskForHelp=!["Submitted for Review","Completed","Cancelled"].includes(task.status);
  const mutate=async(path:string,method:string,body:unknown,success:string)=>{
    setSaving(true);
    try{
      const response=await fetch(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Task update failed.");
      await refresh(); flash(success);
    }catch(error){flash(error instanceof Error?error.message:"Task update failed");}
    finally{setSaving(false)}
  };
  const postComment=async()=>{
    if(!comment.trim())return;
    await mutate(`/api/tasks/${task.id}/updates`,"POST",{type:"General comment",message:comment.trim()},"Comment posted.");
    setComment(""); setShowCommentForm(false);
  };
  const updateChecklist=async(itemId:string,completed:boolean,note="")=>{
    setSaving(true);
    try{
      const response=await fetch(`/api/tasks/${task.id}/checklist/${itemId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({completed,comment:note.trim()})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Could not update this checklist item.");
      await refresh();
      setCompletingItemId(null); setCompletionNote("");
      flash(completed?"Checklist item completed and progress posted.":"Checklist item reopened.");
    }catch(error){flash(error instanceof Error?error.message:"Could not update this checklist item.");}
    finally{setSaving(false)}
  };
  const chooseEvidence=async(file?:File)=>{
    if(!file)return;
    setUploading(true);
    try{
      const kind=file.type.startsWith("image/")?"image":"document";
      const url=await uploadAsset(file,kind);
      setEvidenceFile(file); setEvidenceLabel(file.name); setEvidenceUrl(url); flash("Evidence file ready.");
    }catch(error){flash(error instanceof Error?error.message:"Could not upload evidence.");}
    finally{setUploading(false)}
  };
  const submitWork=async()=>{
    if(!summary.trim()||!validEvidenceUrl||!canWork||task.status==="Submitted for Review")return;
    setSaving(true);
    try{
      if(evidenceUrl.trim()){
        const evidenceResponse=await fetch(`/api/tasks/${task.id}/evidence`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:evidenceLabel.trim()||"Evidence",url:evidenceUrl.trim()})});
        const evidenceResult=await evidenceResponse.json();
        if(!evidenceResponse.ok)throw new Error(evidenceResult.error||"Could not attach evidence.");
      }
      const response=await fetch(`/api/tasks/${task.id}/submit`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({summary:summary.trim()})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Could not send this task for review.");
      await refresh(); setSummary(""); setEvidenceUrl(""); setEvidenceFile(null); setShowSubmitForm(false); flash("Work sent for review.");
    }catch(error){flash(error instanceof Error?error.message:"Could not submit the work.");}
    finally{setSaving(false)}
  };
  const requestHelp=async()=>{
    if(!helpExplanation.trim())return;
    await mutate(`/api/tasks/${task.id}/help`,"POST",{category:helpCategory,explanation:helpExplanation.trim()},"Help request sent to your Manager.");
    setHelpOpen(false); setHelpExplanation("");
  };
  return <div className="task-detail task-detail-intern task-detail-work-page">
    <BackButton onClick={onBack} label="Back to tasks"/>
    <header className="task-workspace-head">
       <div><div className="eyebrow">{task.code||task.id} · {task.project} · {taskDepartmentLabel(task)}</div><h1 className="title">{task.title}</h1><div className="task-work-meta"><Status s={task.status}/><span>{task.priority} priority</span><span>Due {task.due}</span></div></div>{task.githubUrl&&<a className="btn task-github-link" href={task.githubUrl} target="_blank" rel="noreferrer"><Github size={15}/> Open GitHub</a>}
    </header>
     {task.deliverables&&<section className="intern-work-section task-deliverables-summary"><div className="intern-section-heading"><FileCheck2 size={17}/><div><h2>Deliverables</h2><p>Expected outcome for this task.</p></div></div><p className="intern-brief">{task.deliverables}</p></section>}{task.status==="Changes Requested"&&feedback&&<section className="intern-feedback-banner"><strong>Changes requested by {feedback.authorName}</strong><p>{feedback.message}</p></section>}
    {task.status==="Completed"&&<div className="intern-approved-banner"><Check size={16}/> Work approved</div>}
    {helpRequested&&<div className="intern-help-indicator"><CircleHelp size={15}/> Help requested · your Manager has been notified.</div>}
    <div className="intern-primary-actions"><button className="btn" disabled={saving||!canAskForHelp} onClick={()=>setHelpOpen(true)}><CircleHelp size={15}/> I need help</button>{task.status==="Not Started"&&<button className="btn primary" disabled={saving} onClick={()=>update(task.id,{status:"In Progress"})}>Start working</button>}{task.status==="Changes Requested"&&<button className="btn primary" disabled={saving} onClick={()=>update(task.id,{status:"In Progress"})}>Continue working</button>}{task.status==="Blocked"&&<button className="btn primary" disabled={saving} onClick={()=>update(task.id,{status:"In Progress"})}>Resume working</button>}</div>
    <div className="intern-work-sections">
      <section className="intern-work-section"><div className="intern-section-heading"><FileText size={17}/><div><h2>Task brief</h2><p>What you need to deliver.</p></div></div><p className="intern-brief">{task.description||"No description was provided for this task."}</p></section>
      <section className="intern-work-section intern-checklist-section"><div className="intern-section-heading"><Check size={17}/><div><h2>Checklist</h2><p>Tick completed work and add a short progress note.</p></div></div><div className="intern-progress-count"><span>{(task.checklist||[]).filter(item=>item.completed).length} of {(task.checklist||[]).length} completed</span><div><i style={{width:`${(task.checklist||[]).length?Math.round((task.checklist||[]).filter(item=>item.completed).length/(task.checklist||[]).length*100):0}%`}}/></div></div><div className="intern-task-checklist">{(task.checklist||[]).map(item=><div className={item.completed?"is-complete":""} key={item.id}><label><input type="checkbox" checked={item.completed} disabled={!canWork||saving} onChange={event=>{if(event.target.checked){setCompletingItemId(item.id);setCompletionNote("")}else{void updateChecklist(item.id,false)}}}/><span>{item.text}</span></label>{completingItemId===item.id&&<div className="intern-checklist-note"><textarea className="textarea" rows={2} value={completionNote} onChange={event=>setCompletionNote(event.target.value)} placeholder="What did you complete for this item?" disabled={saving} autoFocus/><div className="inline"><button className="btn" disabled={saving} onClick={()=>{setCompletingItemId(null);setCompletionNote("")}}>Cancel</button><button className="btn primary" disabled={!completionNote.trim()||saving} onClick={()=>void updateChecklist(item.id,true,completionNote)}>{saving?"Saving…":"Complete item"}</button></div></div>}</div>)}{!(task.checklist||[]).length&&<div className="intern-empty">Your manager has not added checklist items yet.</div>}</div></section>
      <section className="intern-work-section intern-submit-section"><div className="intern-section-heading"><FileCheck2 size={17}/><div><h2>Submit for review</h2><p>Do this only when the work is ready.</p></div></div>{task.evidence?.length?<div className="intern-evidence-list">{task.evidence.map(item=><a key={item.id} href={item.url} target="_blank" rel="noreferrer"><FileText size={14}/>{item.label}</a>)}</div>:null}{canWork&&!showSubmitForm&&<button className="btn primary intern-action" onClick={()=>setShowSubmitForm(true)}>{hasPriorSubmission?"Resubmit work":"Submit completed work"}</button>}{canWork&&showSubmitForm&&<div className="intern-submit-form"><label className="form-label">What did you complete?<textarea className="textarea" rows={3} value={summary} onChange={event=>setSummary(event.target.value)} placeholder="A short summary is enough." disabled={saving} autoFocus/></label><details className="intern-optional-fields"><summary>Add evidence <span>Optional</span></summary><div><label className="form-label">Link<input className="input" type="url" value={evidenceUrl.startsWith("/api/assets/")?"":evidenceUrl} onChange={event=>{setEvidenceFile(null);setEvidenceUrl(event.target.value)}} placeholder="GitHub, Drive, Figma, or deployed URL" disabled={saving}/></label><div className="intern-file-row"><label className="btn">{uploading?"Uploading…":"Attach a file"}<input type="file" hidden accept="image/*,.pdf,.txt,.md,.doc,.docx" disabled={uploading||saving} onChange={event=>{void chooseEvidence(event.target.files?.[0]);event.currentTarget.value=""}}/></label>{evidenceFile&&<span>{evidenceFile.name}</span>}</div>{evidenceUrl&&!validEvidenceUrl&&<small className="person-field-error">Enter a valid http(s) link.</small>}</div></details><div className="inline"><button className="btn" disabled={saving} onClick={()=>{setShowSubmitForm(false);setSummary("");setEvidenceUrl("");setEvidenceFile(null)}}>Cancel</button><button className="btn primary" disabled={!summary.trim()||!validEvidenceUrl||saving} onClick={submitWork}>{saving?"Sending…":hasPriorSubmission?"Resubmit":"Send for review"}</button></div></div>}{task.status==="Submitted for Review"&&<div className="intern-awaiting"><Check size={15}/> Sent for review. You do not need to do anything else right now.</div>}{task.status==="Changes Requested"&&<div className="intern-awaiting">Continue working to address the feedback before resubmitting.</div>}</section>
      <section className="intern-work-section"><div className="intern-section-heading"><MessageSquare size={17}/><div><h2>Discussion</h2><p>Ask your manager a question when you need to.</p></div></div><div className="intern-discussion">{discussion.map(item=><article key={item.id}><div><b>{item.authorName}</b><span>{item.authorRole} · {new Date(item.createdAt).toLocaleString()}</span></div><p>{item.message}</p>{item.linkUrl&&<a href={item.linkUrl} target="_blank" rel="noreferrer">{item.linkUrl}</a>}</article>)}{!discussion.length&&<div className="intern-empty">No messages yet.</div>}</div>{!showCommentForm&&<button className="btn intern-action" onClick={()=>setShowCommentForm(true)}>Ask a question or comment</button>}{showCommentForm&&<div className="intern-quick-form"><textarea className="textarea" rows={3} value={comment} onChange={event=>setComment(event.target.value)} placeholder="Write a short message..." disabled={saving} autoFocus/><div className="inline"><button className="btn" disabled={saving} onClick={()=>{setShowCommentForm(false);setComment("")}}>Cancel</button><button className="btn primary" disabled={!comment.trim()||saving} onClick={postComment}>Post comment</button></div></div>}</section>
    </div>
    {helpOpen&&<Modal title="I need help" onClose={()=>setHelpOpen(false)} footer={<><button className="btn" onClick={()=>setHelpOpen(false)}>Cancel</button><button className="btn primary" disabled={!helpExplanation.trim()||saving} onClick={requestHelp}>Send help request</button></>}><div className="form-grid"><p className="row-meta">What do you need help with?</p><label className="form-label">Reason<select className="select" value={helpCategory} onChange={event=>setHelpCategory(event.target.value)}>{["Requirements unclear","Technical blocker","Missing access or permissions","Waiting on someone","Deadline issue","Other"].map(option=><option key={option}>{option}</option>)}</select></label><label className="form-label">Short explanation<textarea className="textarea" rows={4} value={helpExplanation} onChange={event=>setHelpExplanation(event.target.value)} placeholder="Tell your Manager what you need." autoFocus/></label></div></Modal>}
  </div>;
}
  function TaskModal({onClose,onSave,user,team,projects}:{onClose:()=>void;onSave:(t:Task)=>Promise<void>;user:User;team:User[];projects:Project[]}){
    const projectNames=projects.map(project=>project.name);
    const [title,setTitle]=useState("");
    const [project,setProject]=useState(projectNames[0]||"");
     const [githubUrl,setGithubUrl]=useState(projects[0]?.githubUrl||"");
     const [departmentIds,setDepartmentIds]=useState<string[]>(user.department&&user.department!==UNASSIGNED_DEPARTMENT?[user.department]:[]);
     const [assigneeIds,setAssigneeIds]=useState<string[]>([]);
     const [taskLeadId,setTaskLeadId]=useState("");
     const [peopleSearch,setPeopleSearch]=useState("");
     const [step,setStep]=useState<1|2>(1);
    const [desc,setDesc]=useState("");
     const [deliverables,setDeliverables]=useState("");
       const [priority,setPriority]=useState<Task["priority"]>("Normal");
    const [due,setDue]=useState("");
    const [saving,setSaving]=useState(false); const [error,setError]=useState(""); const [attempted,setAttempted]=useState(false);
    const departmentOptions=[...OFFICIAL_DEPARTMENTS];
      const people=team.filter(person=>isCurrentTeamMember(person)&&departmentIds.includes(person.department)&&person.active!==false);
     const filteredPeople=people.filter(person=>!peopleSearch.trim()||[person.name,person.department,person.position,person.role].some(value=>value?.toLowerCase().includes(peopleSearch.trim().toLowerCase())));
    const validGithubUrl=/^https:\/\/(www\.)?github\.com\/.+/i.test(githubUrl.trim());
     const goToAssignment=()=>{setAttempted(true);setError("");if(!title.trim()){setError("Enter a task name.");return}if(!project){setError("Choose a project.");return}if(!validGithubUrl){setError("The selected project needs a valid GitHub link.");return}if(!due){setError("Choose a due date.");return}setAttempted(false);setStep(2)};
    const toggleDepartment=(name:string,checked:boolean)=>{
      const nextDepartments=checked?[...departmentIds,name]:departmentIds.filter(department=>department!==name);
      const nextAssignees=assigneeIds.filter(id=>{const person=team.find(item=>item.id===id);return Boolean(person&&nextDepartments.includes(person.department))});
      setDepartmentIds(nextDepartments); setAssigneeIds(nextAssignees);
      if(taskLeadId&&!nextAssignees.includes(taskLeadId))setTaskLeadId("");
    };
    const toggleAssignee=(id:string,checked:boolean)=>{
      setAssigneeIds(ids=>checked?[...ids,id]:ids.filter(item=>item!==id));
      if(!checked&&taskLeadId===id)setTaskLeadId("");
    };
       const save=async()=>{setAttempted(true);setError("");if(!title.trim()){setError("Enter a task name.");return}if(!project){setError("Choose a project.");return}if(!validGithubUrl){setError("The selected project needs a valid GitHub link.");return}if(!departmentIds.length){setError("Choose at least one department.");return}if(!due){setError("Choose a due date.");return}setSaving(true);try{await onSave({id:"",title:title.trim(),project,githubUrl:githubUrl.trim(),department:departmentIds[0],departmentIds,createdBy:user.id,status:"Not Started",assignee:assigneeIds[0],assigneeIds,taskLeadId:taskLeadId||undefined,priority,due,createdDate:currentDate(),description:desc.trim(),deliverables:deliverables.trim()||undefined,criteria:[]})}catch(saveError){setError(saveError instanceof Error?saveError.message:"Unable to assign task. Please try again.")}finally{setSaving(false)}};
       return <Modal className="task-create-modal" title={<span className="task-create-title"><span className="task-create-title-icon"><ClipboardList size={16}/></span><span><b>Create task</b><small>{step===1?"Add the task details.":"Choose departments and assign people."}</small></span></span>} onClose={onClose} footer={step===1?<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={goToAssignment}>Next: Assign people <ChevronRight size={15}/></button></>:<><button className="btn" disabled={saving} onClick={()=>{setError("");setAttempted(false);setStep(1)}}>Back</button><button className="btn primary" disabled={saving} onClick={save}>{saving?"Creating…":"Create task"}</button></>}>
        <div className="task-create-progress" aria-label={`Step ${step} of 2`}>
          <div className={step===1?"is-active":"is-complete"}><span>{step===1?"1":<Check size={13}/>}</span><b>Task details</b></div>
          <i/>
          <div className={step===2?"is-active":""}><span>2</span><b>Assign people</b></div>
        </div>
       <div className="form-grid task-create-form">
          {step===1?<>
            <label className="form-label task-create-wide">Task name<input className="input" autoFocus value={title} onChange={event=>setTitle(event.target.value)} placeholder="What needs to get done?"/></label>
            <label className="form-label task-create-wide">Description <span className="task-create-optional">Optional</span><textarea className="textarea" rows={2} value={desc} onChange={event=>setDesc(event.target.value)} placeholder="Add context or describe the expected outcome."/></label>
            <label className="form-label">Project<select className="select" value={project} onChange={event=>{const name=event.target.value;setProject(name);setGithubUrl(projects.find(item=>item.name===name)?.githubUrl||"")}}><option value="">Select a project</option>{projectNames.map(name=><option key={name}>{name}</option>)}</select></label>
            <label className="form-label">Priority<select className="select" value={priority} onChange={event=>setPriority(event.target.value as Task["priority"])}>{["Low","Normal","High","Urgent"].map(value=><option key={value}>{value}</option>)}</select></label>
            <label className="form-label task-create-wide">GitHub link *<input className="input" type="url" value={githubUrl} aria-invalid={attempted&&!validGithubUrl} onChange={event=>setGithubUrl(event.target.value)} placeholder="https://github.com/organization/repository/issues/123"/>{attempted&&!validGithubUrl&&<span className="person-field-error">Enter a valid GitHub link.</span>}</label>
            <label className="form-label">Due date *<input className="input" type="date" min={currentDate()} value={due} aria-invalid={attempted&&!due} onChange={event=>setDue(event.target.value)}/>{attempted&&!due&&<span className="person-field-error">Due date is required.</span>}</label>
            <label className="form-label task-create-wide">Deliverables <span className="task-create-optional">Optional</span><textarea className="textarea" rows={2} value={deliverables} onChange={event=>setDeliverables(event.target.value)} placeholder="What must exist before this task is complete?"/></label>
          </>:<>
            <div className="task-create-assignment-intro task-create-wide"><b>Who should work on this?</b><span>Select departments first, then choose people from those teams.</span></div>
            <div className="form-label task-department-picker task-create-wide"><span>Departments * <small>{departmentIds.length} selected</small></span><div className="task-picker-results task-department-options">{departmentOptions.map(name=>{const required=isManager(user)&&name===user.department;return <label key={name}><input type="checkbox" checked={departmentIds.includes(name)} disabled={required} onChange={event=>toggleDepartment(name,event.target.checked)}/><span><b>{name}</b>{required&&<small>Your department is required</small>}</span></label>})}</div>{attempted&&!departmentIds.length&&<span className="person-field-error">Choose at least one department.</span>}</div>
            <div className="form-label task-assignee-picker task-create-wide"><span>People <small>{assigneeIds.length?`${assigneeIds.length} selected`:"Optional"}</small></span><input className="input" value={peopleSearch} onChange={event=>setPeopleSearch(event.target.value)} placeholder="Search team members…"/><div className="task-picker-results">{filteredPeople.map(person=><label key={person.id}><input type="checkbox" checked={assigneeIds.includes(person.id)} onChange={event=>toggleAssignee(person.id,event.target.checked)}/><span><b>{person.name}</b><small>{person.department} · {person.position||person.role}</small></span></label>)}{!filteredPeople.length&&<small className="task-picker-empty">Select a department to see available collaborators.</small>}</div></div>
            {assigneeIds.length>0&&<label className="form-label task-create-wide">Task lead <span className="task-create-optional">Optional</span><select className="select" value={taskLeadId} onChange={event=>setTaskLeadId(event.target.value)}><option value="">No task lead</option>{assigneeIds.map(id=>{const person=team.find(item=>item.id===id);return person?<option key={id} value={id}>{person.name} · {person.department}</option>:null})}</select></label>}
          </>}
        {error&&<span className="person-field-error" role="alert">{error}</span>}
      </div>
    </Modal>
  }
  function ProjectModal({user,team,onClose,onSave}:{user:User;team:User[];onClose:()=>void;onSave:(project:Omit<Project,"id">)=>void}){
    const [name,setName]=useState("");
    const [description,setDescription]=useState("");
    const [githubUrl,setGithubUrl]=useState("");
    const [logoUrl,setLogoUrl]=useState("");
    const [assigneeIds,setAssigneeIds]=useState<string[]>([]);
    const [peopleQuery,setPeopleQuery]=useState("");
    const people=team.filter(isCurrentTeamMember).sort((a,b)=>a.name.localeCompare(b.name));
    const normalizedPeopleQuery=peopleQuery.trim().toLowerCase();
    const filteredPeople=people.filter(person=>!normalizedPeopleQuery||[person.name,person.email,person.department,person.position,person.role].some(value=>value?.toLowerCase().includes(normalizedPeopleQuery)));
    const validUrl=/^https?:\/\/(www\.)?github\.com\/.+/i.test(githubUrl.trim());
    const readLogo=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>setLogoUrl(String(reader.result));reader.readAsDataURL(file)};
    return <Modal title="Create project" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()||!validUrl} onClick={()=>onSave({name:name.trim(),description:description.trim()||"Project workspace",githubUrl:githubUrl.trim(),logoUrl:logoUrl||undefined,assigneeIds,resources:[],active:true,status:"Active"})}>Create project</button></>}>
      <div className="form-grid">
        <label className="form-label">Project name<input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Customer onboarding"/></label>
        <label className="form-label">Description<textarea className="textarea" rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="What outcome does this project deliver?"/></label>
        <label className="form-label">Project logo<input className="input" type="file" accept="image/*" onChange={e=>readLogo(e.target.files?.[0])}/>{logoUrl&&<img className="project-logo-preview" src={logoUrl} alt="Project logo preview"/>}</label>
        <label className="form-label">GitHub repository URL<input className="input" type="url" value={githubUrl} onChange={e=>setGithubUrl(e.target.value)} placeholder="https://github.com/olyxee/repository"/>{githubUrl&&!validUrl&&<span style={{color:"#9a453d"}}>Enter a valid GitHub URL.</span>}</label>
        {accessOf(user)==="Superadmin"&&<div className="form-label project-people-picker">
          <span>Assign people {assigneeIds.length>0&&<small>{assigneeIds.length} selected</small>}</span>
          <div className="project-people-search"><Search size={15}/><input value={peopleQuery} onChange={event=>setPeopleQuery(event.target.value)} placeholder="Search by name, department, or role" aria-label="Search people"/></div>
          <div className="project-people-results">{filteredPeople.map(person=><label key={person.id}><input type="checkbox" checked={assigneeIds.includes(person.id)} onChange={event=>setAssigneeIds(ids=>event.target.checked?[...ids,person.id]:ids.filter(id=>id!==person.id))}/><span><b>{person.name}</b><small>{person.department} · {person.position||person.role}{person.active===false?" · Inactive":""}</small></span></label>)}{filteredPeople.length===0&&<div className="workspace-empty">No people match your search.</div>}</div>
        </div>}
      </div>
    </Modal>
  }
 function PersonModal({user,team,tasks,person,onOpenTask,onClose,onSave}:{user:User;team:User[];tasks:Task[];person?:User;onOpenTask:(id:string)=>void;onClose:()=>void;onSave:(person:User)=>void|Promise<void>}){
  const administrator=isAdmin(user);
  const editing=Boolean(person);
  const livePerson=Boolean(person&&"source" in person&&person.source==="Supabase");
  const intern=person?employmentOf(person)==="Intern":false;
   const targetIsManager=Boolean(person&&(person.accessRole==="Manager"||person.role==="Manager"));
   const superadminCanProvision=accessOf(user)==="Superadmin"&&targetIsManager;
   const managerCanProvision=isManager(user)&&!targetIsManager&&Boolean(person&&(person.department===user.department||person.reportsTo===user.id));
    const canProvision=livePerson&&Boolean(person?.id)&&(superadminCanProvision||managerCanProvision);
    const canAdministerAccount=livePerson&&Boolean(person?.id)&&accessOf(user)==="Superadmin";
    const canAccessAccountPanel=canProvision||canAdministerAccount;
  const departmentOptions=[...OFFICIAL_DEPARTMENTS,UNASSIGNED_DEPARTMENT];
  const [name,setName]=useState(person?.name||"");
  const [email,setEmail]=useState(person?.email||"");
  const [position,setPosition]=useState(person?.position||"");
  const [department,setDepartment]=useState(person?.department||(isManager(user)?user.department:departmentOptions[0]||""));
  const [employmentType,setEmploymentType]=useState<EmploymentType>(person?employmentOf(person):isManager(user)?"Intern":"Employee");
   const [accessRole,setAccessRole]=useState<AccessRole>(person?livePerson?(person.accessRole==="Manager"?"Manager":"Member"):accessOf(person):"Member");
  const [accountStatus,setAccountStatus]=useState<AccountStatus>(person?accountOf(person):"Active");
  const [reportsTo,setReportsTo]=useState(person?.reportsTo||(isManager(user)?user.id:""));
  const [provisioning,setProvisioning]=useState(false);
   const [credentials,setCredentials]=useState<{name:string;email:string;role:string;invitationStatus:string;message:string}|null>(null);
  const [opsRole,setOpsRole]=useState<AccessRole>(person?.opsRole||"Member");
  const [opsActive,setOpsActive]=useState(person?.opsActive!==false);
  const [savingAccount,setSavingAccount]=useState(false);
  const [deletingAccount,setDeletingAccount]=useState(false);
  const [deletingPerson,setDeletingPerson]=useState(false);
   const [editMode,setEditMode]=useState(!person);
   const [activePanel,setActivePanel]=useState<"identity"|"organisation"|"access">("identity");
   const emailValid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const managers=team.filter(member=>isManager(member)&&isCurrentTeamMember(member));
   const superadmins=team.filter(member=>accessOf(member)==="Superadmin"&&accountOf(member)==="Active");
   const departmentManager=isManager(user)&&!person?user:managers.find(manager=>manager.id!==person?.id&&manager.department===department);
   const personTasks=person?tasks.filter(task=>taskAssignees(task).includes(person.id)):[];
   const completedPersonTasks=personTasks.filter(task=>task.status==="Completed").length;
   const activePersonTasks=personTasks.filter(task=>!["Completed","Cancelled"].includes(task.status)).length;
   const taskProgress=personTasks.length?Math.round(completedPersonTasks/personTasks.length*100):0;
  const accessOptions:AccessRole[]=livePerson?["Manager","Member"]:administrator?["Superadmin","Admin","Manager","Member"]:["Member"];
   useEffect(()=>{
     if(accessRole==="Manager"){
       const superadmin=superadmins.find(member=>member.id!==person?.id);
       setReportsTo(superadmin?.id||"");
      }else if(employmentType==="Intern"){
        const manager=managers.find(member=>member.id!==person?.id&&member.department===department);
        setReportsTo(manager?.id||"");
     }
    },[accessRole,department,employmentType,person?.id,team]);
  const provision=async()=>{
    if(!person?.id)return;
    setProvisioning(true);
    const response=await fetch(`/api/people/${person.id}/ops-access`,{method:"POST"});
    const result=await response.json();
    setProvisioning(false);
    if(!response.ok){window.alert(result.error||"Could not create Ops access");return}
    setCredentials(result);
  };
  const saveOpsAccount=async()=>{
    if(!person?.id)return;
    setSavingAccount(true);
    const response=await fetch(`/api/people/${person.id}/ops-account`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:opsRole,active:opsActive})});
    const result=await response.json();
    setSavingAccount(false);
    if(!response.ok){window.alert(result.error||"Could not update this Ops account");return}
    window.location.reload();
  };
  const deletePerson=async()=>{
    if(!person?.id||!window.confirm(`Delete ${person.name} permanently?\n\nThis removes their People directory record and Ops login. Their historical task and project activity will remain. This cannot be undone.`))return;
    setDeletingPerson(true);
    const response=await fetch(`/api/people/${person.id}`,{method:"DELETE"});
    const result=await response.json();
    setDeletingPerson(false);
    if(!response.ok){window.alert(result.error||"Could not delete this person");return}
    window.location.reload();
  };
  const shareMessage=credentials?`Hello ${credentials.name},\n\nYour Olyxee Ops account has been created. A secure account setup email was sent to ${credentials.email}. The setup link expires in 24 hours.\n\nRegards,\nOlyxee`:"";
  const emailShare=credentials?`mailto:${encodeURIComponent(credentials.email)}?subject=${encodeURIComponent("Your Olyxee Ops Account")}&body=${encodeURIComponent(shareMessage)}`:"#";
  const whatsappShare=credentials?`https://wa.me/?text=${encodeURIComponent(shareMessage)}`:"#";
  const savePerson=()=>onSave({...person,id:person?.id||"",name,email,position:position.trim(),department:isManager(user)&&!person?user.department:department,employmentType:isManager(user)&&!person?"Intern":employmentType,accessRole:isManager(user)&&!person?"Member":accessRole,accountStatus,reportsTo:isManager(user)&&!person?user.id:reportsTo} as User);
    const footer=editing&&!editMode?<><button className="btn" onClick={onClose}>Close</button>{administrator&&<button className="btn primary" onClick={()=>setEditMode(true)}><Pencil size={14}/> Edit profile</button>}</>:<><button className="btn" onClick={editing?()=>setEditMode(false):onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()||!emailValid||((isManager(user)&&!person)||employmentType==="Intern")&&!position.trim()||(!isManager(user)&&(accessRole==="Manager"||employmentType==="Intern")&&!reportsTo)} onClick={savePerson}>{editing?"Save changes":isManager(user)?"Add intern":"Add person"}</button></>;
   return <Modal title={editing?(editMode?"Edit person":"Person profile"):"Add team member"} className={`person-modal ${editing?"":"person-modal-add"}`} onClose={onClose} footer={footer}>
     <div className="person-modal-content">
     {!editing?<div className="person-add-form">
       <p className="person-add-copy">Add their details and place them in the correct team.</p>
       <div className="person-add-fields">
         <label className="form-label person-field-wide">Full name<input className="input" autoFocus value={name} onChange={event=>setName(event.target.value)} placeholder="Full name"/></label>
         <label className="form-label person-field-wide">Email address<input className="input" type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="name@example.com"/>{email&&!emailValid&&<span className="person-field-error">Enter a valid email address.</span>}</label>
          <label className="form-label person-field-wide">Role / job title<input className="input" value={position} onChange={event=>setPosition(event.target.value)} placeholder="e.g. Software Developer, Designer, Content Creator" maxLength={120}/></label>
         <label className="form-label">Department<select className="select" value={department} disabled={!administrator} onChange={event=>setDepartment(event.target.value)}><option value="">Select department</option>{departmentOptions.map(option=><option key={option}>{option}</option>)}</select></label>
         <label className="form-label">Employment<select className="select" value={employmentType} disabled={!administrator} onChange={event=>setEmploymentType(event.target.value as EmploymentType)}>{["Employee","Intern"].map(value=><option key={value}>{value}</option>)}</select></label>
         <label className="form-label">Access role<select className="select" value={accessRole} disabled={!administrator} onChange={event=>setAccessRole(event.target.value as AccessRole)}>{accessOptions.map(value=><option key={value}>{value}</option>)}</select></label>
         <label className="form-label">Account status<select className="select" value={accountStatus} onChange={event=>setAccountStatus(event.target.value as AccountStatus)}>{["Active","Suspended"].map(value=><option key={value}>{value}</option>)}</select></label>
         {accessRole==="Member"&&<label className="form-label person-field-wide">Reports to<select className="select" value={reportsTo} disabled={!administrator||employmentType==="Intern"} onChange={event=>setReportsTo(event.target.value)}><option value="">{employmentType==="Intern"&&!departmentManager?"No active manager in this department":"Unassigned"}</option>{managers.filter(manager=>administrator||manager.id===user.id).map(manager=><option key={manager.id} value={manager.id}>{manager.name}</option>)}</select>{employmentType==="Intern"&&<small className="person-field-help">Assigned automatically from the selected department.</small>}</label>}
         {accessRole==="Manager"&&<label className="form-label person-field-wide">Reports to<select className="select" value={reportsTo} disabled><option value="">{superadmins.length?"Select active Superadmin":"No active Superadmin available"}</option>{superadmins.map(superadmin=><option key={superadmin.id} value={superadmin.id}>{superadmin.name}</option>)}</select></label>}
       </div>
       <p className="person-add-footnote">Sign-in access can be created after the team member is added.</p>
     </div>:editMode?<div className="person-edit-form">
       <div className="person-edit-identity"><Avatar person={person!} size={44}/><span><b>{person!.name}</b><small>{person!.email}</small></span></div>
       <div className="person-add-fields">
         <label className="form-label person-field-wide">Full name<input className="input" value={name} onChange={event=>setName(event.target.value)} placeholder="Full name"/></label>
         <label className="form-label person-field-wide">Email address<input className="input" type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="name@example.com"/>{email&&!emailValid&&<span className="person-field-error">Enter a valid email address.</span>}</label>
          {intern&&<label className="form-label person-field-wide">Role / job title<input className="input" value={position} onChange={event=>setPosition(event.target.value)} placeholder="e.g. Software Developer, Designer, Content Creator" maxLength={120}/></label>}
         <label className="form-label">Department<select className="select" value={department} disabled={!administrator} onChange={event=>setDepartment(event.target.value)}><option value="">Select department</option>{departmentOptions.map(option=><option key={option}>{option}</option>)}</select></label>
         <label className="form-label">Employment<select className="select" value={employmentType} disabled={livePerson||!administrator} onChange={event=>setEmploymentType(event.target.value as EmploymentType)}>{["Employee","Intern"].map(value=><option key={value}>{value}</option>)}</select></label>
         <label className="form-label">{livePerson?"Directory role":"Access role"}<select className="select" value={accessRole} disabled={!administrator||livePerson&&intern} onChange={event=>setAccessRole(event.target.value as AccessRole)}>{accessOptions.map(value=><option key={value}>{value}</option>)}</select></label>
         <label className="form-label">{livePerson?"Employment status":"Account status"}<select className="select" value={accountStatus} onChange={event=>setAccountStatus(event.target.value as AccountStatus)}>{["Active","Suspended"].map(value=><option key={value}>{value}</option>)}</select></label>
         {accessRole==="Member"&&<label className="form-label person-field-wide">Reports to<select className="select" value={reportsTo} disabled={!administrator||employmentType==="Intern"} onChange={event=>setReportsTo(event.target.value)}><option value="">{employmentType==="Intern"&&!departmentManager?"No active manager in this department":"Unassigned"}</option>{managers.filter(manager=>manager.id!==person?.id&&(administrator||manager.id===user.id)).map(manager=><option key={manager.id} value={manager.id}>{manager.name}</option>)}</select>{employmentType==="Intern"&&<small className="person-field-help">Assigned automatically from the selected department.</small>}</label>}
         {accessRole==="Manager"&&<label className="form-label person-field-wide">Reports to<select className="select" value={reportsTo} disabled><option value="">{superadmins.length?"Select active Superadmin":"No active Superadmin available"}</option>{superadmins.filter(superadmin=>superadmin.id!==person?.id).map(superadmin=><option key={superadmin.id} value={superadmin.id}>{superadmin.name}</option>)}</select></label>}
       </div>
        {canAccessAccountPanel&&<details className="person-account-disclosure" open><summary>Account access</summary><div className="person-account-content">
          {canAdministerAccount&&person?.hasOpsAccess&&<><div className="account-management-grid"><label className="form-label">Ops role<select className="select" value={opsRole} onChange={event=>setOpsRole(event.target.value as AccessRole)}>{["Manager","Member"].map(value=><option key={value}>{value}</option>)}</select></label><label className="form-label">Sign-in access<select className="select" value={opsActive?"Active":"Suspended"} onChange={event=>setOpsActive(event.target.value==="Active")}><option>Active</option><option>Suspended</option></select></label></div><div className="account-management-actions"><button className="btn" type="button" disabled={savingAccount||deletingAccount} onClick={saveOpsAccount}>{savingAccount?"Saving…":"Save account access"}</button></div></>}
          <section className="access-provision"><div><b>{person?.hasOpsAccess?"Resend password invitation":"Create Ops access"}</b><p>Send a secure, single-use link that lets {person?.email} create their password. Passwords are never exposed in email.</p></div><button className="btn primary" type="button" disabled={provisioning} onClick={provision}>{provisioning?"Sending…":person?.hasOpsAccess?"Resend password link":"Create Ops access"}</button>{credentials&&<div className="access-credentials"><span><small>Login email</small><b>{credentials.email}</b></span><span><small>Password</small><b>{credentials.invitationStatus==="sent"?"Creation link sent":"Needs retry"}</b></span><div><button className="btn" type="button" onClick={()=>navigator.clipboard.writeText(shareMessage)}>Copy note</button><a className="btn" href={emailShare}>Open email</a><a className="btn" href={whatsappShare} target="_blank" rel="noreferrer">Share by WhatsApp</a></div></div>}</section>
          {accessOf(user)==="Superadmin"&&<div className="person-delete-row"><span><b>Delete person</b><small>Removes their directory record and login.</small></span><button className="btn" type="button" disabled={deletingPerson||deletingAccount||savingAccount} onClick={deletePerson}>{deletingPerson?"Deleting…":"Delete"}</button></div>}
       </div></details>}
      </div>:!editMode&&person?<div className="person-profile-view">
       <div className="person-profile-identity"><Avatar person={person} size={72}/><div><h3>{person.name}</h3><p>{person.email||"No email recorded"}</p><span className={`people-status ${accountOf(person).toLowerCase()}`}>{accountOf(person)}</span></div>{administrator&&<button type="button" className="person-profile-edit" aria-label={`Edit ${person.name}`} title="Edit profile" onClick={()=>setEditMode(true)}><Pencil size={16}/></button>}</div>
      <dl className="person-profile-details">
        <div><dt>Employment</dt><dd>{employmentOf(person)}</dd></div>
        <div><dt>Access role</dt><dd>{accessOf(person)}</dd></div>
        <div><dt>Department</dt><dd>{person.department||"Unassigned"}</dd></div>
        <div><dt>Position</dt><dd>{person.position||"—"}</dd></div>
        <div><dt>Reports to</dt><dd>{team.find(manager=>manager.id===person.reportsTo)?.name||"Unassigned"}</dd></div>
        <div><dt>Ops access</dt><dd>{person.hasOpsAccess?(person.opsActive===false?"Suspended":"Active"):"Not provisioned"}</dd></div>
        {person.contactDetails&&<div><dt>Contact</dt><dd>{person.contactDetails}</dd></div>}
        {person.githubUsername&&<div><dt>GitHub</dt><dd>@{person.githubUsername}</dd></div>}
      </dl>
       {canProvision&&<section className="access-provision person-profile-provision"><div><b>{person.hasOpsAccess?"Resend password invitation":"Create Ops access"}</b><p>Send a secure, single-use link that lets this person create their password. Passwords are never exposed in email.</p></div><button className="btn primary" type="button" disabled={provisioning} onClick={provision}>{provisioning?"Sending…":person.hasOpsAccess?"Resend password link":"Create Ops access"}</button>{credentials&&<div className="access-credentials"><span><small>Login email</small><b>{credentials.email}</b></span><span><small>Password</small><b>{credentials.invitationStatus==="sent"?"Creation link sent":"Needs retry"}</b></span><div><button className="btn" type="button" onClick={()=>navigator.clipboard.writeText(shareMessage)}>Copy note</button><a className="btn" href={emailShare}>Open email</a><a className="btn" href={whatsappShare} target="_blank" rel="noreferrer">Share by WhatsApp</a></div></div>}</section>}
       {canAdministerAccount&&<section className="access-provision person-profile-provision"><div><b>Delete person</b><p>Permanently remove this person from People and revoke their Ops login. Their historical work records will remain.</p></div><button className="btn danger" type="button" disabled={deletingPerson} onClick={deletePerson}>{deletingPerson?"Deleting person…":"Delete person"}</button></section>}
       <section className="person-progress" aria-label={`${person.name} task progress`}>
         <div className="person-progress-head"><span><small>Task progress</small><b>{taskProgress}% complete</b></span><strong>{completedPersonTasks}/{personTasks.length}</strong></div>
         <div className="person-progress-track"><span style={{width:`${taskProgress}%`}}/></div>
         <div className="person-progress-stats"><span><b>{activePersonTasks}</b> active</span><span><b>{completedPersonTasks}</b> completed</span><span><b>{personTasks.length}</b> total</span></div>
       </section>
       <section className="person-task-history"><div className="person-task-history-head"><span><b>Tasks worked on</b><small>Assigned work and delivery status</small></span><strong>{personTasks.length}</strong></div><div>{personTasks.slice().sort((a,b)=>b.due.localeCompare(a.due)).map(task=><button type="button" key={task.id} onClick={()=>onOpenTask(task.id)}><span><b>{task.title}</b><small>{task.project} · Due {task.due}</small></span><Status s={task.status}/><ChevronRight size={14}/></button>)}{!personTasks.length&&<div className="person-task-empty">No assigned tasks yet.</div>}</div></section>
     </div>:<>
     <div className={`person-modal-switcher ${canAccessAccountPanel?"has-access":"two-tabs"}`} role="group" aria-label="Person details sections">
       <button type="button" className={activePanel==="identity"?"active":""} aria-label="Identity: name and contact" aria-pressed={activePanel==="identity"} onClick={()=>setActivePanel("identity")}><span><b>Identity</b><small>Name and contact</small></span></button>
       <button type="button" className={activePanel==="organisation"?"active":""} aria-label="Organisation: role and reporting" aria-pressed={activePanel==="organisation"} onClick={()=>setActivePanel("organisation")}><span><b>Organisation</b><small>Role and reporting</small></span></button>
        {editing&&canAccessAccountPanel&&<button type="button" className={activePanel==="access"?"active":""} aria-label="Access: Ops account controls" aria-pressed={activePanel==="access"} onClick={()=>setActivePanel("access")}><span><b>Access</b><small>Ops account controls</small></span></button>}
     </div>
     {activePanel==="identity"&&<div className="person-modal-section person-modal-section-active">
      <div className="person-modal-section-head"><span><b>Profile</b><small>Basic contact details</small></span></div>
      <div className="person-modal-fields person-modal-fields-profile">
        <label className="form-label">Full name<input className="input" value={name} onChange={event=>setName(event.target.value)} placeholder="Full name"/></label>
        <label className="form-label">Email address<input className="input" type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="name@example.com"/>{email&&!emailValid&&<span className="person-field-error">Enter a valid email address.</span>}</label>
      </div>
     </div>}
     {activePanel==="organisation"&&<div className="person-modal-section person-modal-section-active">
      <div className="person-modal-section-head"><span><b>Role & organisation</b><small>Where this person sits in Olyxee</small></span></div>
      <div className="person-modal-fields">
        <label className="form-label">Department<select className="select" value={department} disabled={!administrator} onChange={event=>setDepartment(event.target.value)}><option value="">Select a department</option>{departmentOptions.map(option=><option key={option}>{option}</option>)}</select></label>
        <label className="form-label">Employment type<select className="select" value={employmentType} disabled={livePerson||!administrator} onChange={event=>setEmploymentType(event.target.value as EmploymentType)}>{["Employee","Intern"].map(value=><option key={value}>{value}</option>)}</select></label>
        <label className="form-label">{livePerson?"People directory role":"Access role"}<select className="select" value={accessRole} disabled={!administrator||livePerson&&intern} onChange={event=>setAccessRole(event.target.value as AccessRole)}>{accessOptions.map(value=><option key={value}>{value}</option>)}</select></label>
        <label className="form-label">{livePerson?"Employment status":"Account status"}<select className="select" value={accountStatus} onChange={event=>setAccountStatus(event.target.value as AccountStatus)}>{["Active","Suspended"].map(value=><option key={value}>{value}</option>)}</select></label>
        {accessRole==="Member"&&<label className="form-label person-field-wide">Reports to<select className="select" value={reportsTo} disabled={!administrator} onChange={event=>setReportsTo(event.target.value)}><option value="">Unassigned</option>{managers.filter(manager=>manager.id!==person?.id&&(administrator||manager.id===user.id)).map(manager=><option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>}
        {accessRole==="Manager"&&<label className="form-label person-field-wide">Reports to<select className="select" value={reportsTo} disabled><option value="">{superadmins.length?"Select an active Superadmin":"No active Superadmin available"}</option>{superadmins.filter(superadmin=>superadmin.id!==person?.id).map(superadmin=><option key={superadmin.id} value={superadmin.id}>{superadmin.name} · Superadmin</option>)}</select><small className="person-field-help">Managers automatically report to the active Superadmin account.</small></label>}
      </div>
     </div>}
     {activePanel==="access"&&<div className="person-modal-access-panel">
       {editMode&&canAdministerAccount&&person?.hasOpsAccess&&<section className="access-provision account-management">
        <div><b>Manage Ops account</b><p>Control this person’s role and sign-in access. These settings do not alter their employee record.</p></div>
        <div className="account-management-grid">
          <label className="form-label">Ops role<select className="select" value={opsRole} onChange={event=>setOpsRole(event.target.value as AccessRole)}>{["Admin","Manager","Member"].map(value=><option key={value}>{value}</option>)}</select></label>
          <label className="form-label">Sign-in access<select className="select" value={opsActive?"Active":"Suspended"} onChange={event=>setOpsActive(event.target.value==="Active")}><option>Active</option><option>Suspended</option></select></label>
        </div>
        <div className="account-management-actions"><button className="btn primary" type="button" disabled={savingAccount||deletingAccount} onClick={saveOpsAccount}>{savingAccount?"Saving…":"Save account access"}</button></div>
      </section>}
       {editMode&&canProvision&&!person?.hasOpsAccess&&<section className="access-provision">
         <div><b>Ops login access</b><p>The login will use <b>{person.email}</b>. A secure password setup link will be emailed and will expire after 24 hours.</p></div>
          <button className="btn primary" type="button" disabled={provisioning} onClick={provision}>{provisioning?"Sending invitation…":credentials?"Resend invitation":"Create Ops login"}</button>
         {credentials&&<div className="access-credentials"><span><small>Login email</small><b>{credentials.email}</b></span><span><small>Invitation</small><b>{credentials.invitationStatus==="sent"?"Email sent":"Needs retry"}</b></span><div><button className="btn" type="button" onClick={()=>navigator.clipboard.writeText(shareMessage)}>Copy note</button><a className="btn" href={emailShare}>Open email</a><a className="btn" href={whatsappShare} target="_blank" rel="noreferrer">Share by WhatsApp</a></div></div>}
      </section>}
      {editMode&&canProvision&&person?.hasOpsAccess&&<section className="access-provision">
          <div><b>Reset account access</b><p>Send a new secure password setup link to <b>{person.email}</b>. Their current password remains active until they use the new link.</p></div>
          <button className="btn" type="button" disabled={provisioning} onClick={provision}>{provisioning?"Sending invitation…":"Send new setup link"}</button>
         {credentials&&<div className="access-credentials"><span><small>Login email</small><b>{credentials.email}</b></span><span><small>Invitation</small><b>{credentials.invitationStatus==="sent"?"Email sent":"Needs retry"}</b></span><div><button className="btn" type="button" onClick={()=>navigator.clipboard.writeText(shareMessage)}>Copy note</button><a className="btn" href={emailShare}>Open email</a><a className="btn" href={whatsappShare} target="_blank" rel="noreferrer">Share by WhatsApp</a></div></div>}
      </section>}
       {editMode&&canAdministerAccount&&<section className="person-delete-section">
         <div><b>Delete person permanently</b><p>Remove this person from the People database and revoke their Ops login. Historical work records are retained.</p></div>
        <button className="btn danger" type="button" disabled={deletingPerson||deletingAccount||savingAccount} onClick={deletePerson}>{deletingPerson?"Deleting person…":"Delete person"}</button>
      </section>}
       </div>}
       <div className="notice person-modal-note">{livePerson?"Changes are saved to the connected people database.":administrator?"Employment type, access permissions, and account status are managed independently.":"Managers can add members within their own department and manage their account status."}</div>
       </>}
    </div>
  </Modal>
 }
function BlockerModal({onClose,onSave}:{onClose:()=>void;onSave:(b:{reason:string;need:string;waitingFor:string;severity:"Low"|"Medium"|"High"|"Critical"})=>void}){const [reason,setReason]=useState("");const [need,setNeed]=useState("");const [waitingFor,setWaitingFor]=useState("");const [severity,setSeverity]=useState<"Low"|"Medium"|"High"|"Critical">("Medium");return <Modal title="Report blocker" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!reason||!need||!waitingFor} onClick={()=>onSave({reason,need,waitingFor,severity})}>Report blocker</button></>}><div className="form-grid"><label className="form-label">What is blocking you?<textarea className="textarea" rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Describe the constraint clearly."/></label><label className="form-label">What do you need?<input className="input" value={need} onChange={e=>setNeed(e.target.value)} placeholder="Access, decision, dependency, clarification..."/></label><label className="form-label">Who or what are you waiting for?<input className="input" value={waitingFor} onChange={e=>setWaitingFor(e.target.value)} placeholder="Team, person, or external dependency"/></label><label className="form-label">Severity<select className="select" value={severity} onChange={e=>setSeverity(e.target.value as typeof severity)}>{["Low","Medium","High","Critical"].map(x=><option key={x}>{x}</option>)}</select></label></div></Modal>}
function Modal({title,onClose,children,footer,className=""}:{title:React.ReactNode;onClose:()=>void;children:React.ReactNode;footer:React.ReactNode;className?:string}){return <div className="modal-back" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className={`modal ${className}`}><div className="modal-head"><b>{title}</b><button className="close" onClick={onClose}><X size={18}/></button></div><div className="modal-body">{children}</div><div className="modal-foot">{footer}</div></div></div>}
 function EmailAdminPanel({flash}:{flash:(s:string)=>void}){
   const [health,setHealth]=useState<any>(null); const [logs,setLogs]=useState<any[]>([]); const [busy,setBusy]=useState(false);
   const load=async()=>{try{const [h,l]=await Promise.all([fetch("/api/email-notifications/health"),fetch("/api/email-notifications?limit=25")]);const hj=await h.json();const lj=await l.json();if(!h.ok)throw new Error(hj.error||"Could not load email health");setHealth(hj);setLogs(lj.notifications||[])}catch(error){flash(error instanceof Error?error.message:"Could not load email status")}};
   useEffect(()=>{load()},[]);
   const test=async()=>{setBusy(true);try{const r=await fetch("/api/email-notifications/test",{method:"POST"});const body=await r.json();if(!r.ok)throw new Error(body.error||"Test email failed");flash("Test email sent successfully");await load()}catch(error){flash(error instanceof Error?error.message:"Test email failed")}finally{setBusy(false)}};
   const retry=async(id:string)=>{try{const r=await fetch(`/api/email-notifications/${id}/retry`,{method:"POST"});const body=await r.json();if(!r.ok)throw new Error(body.error||"Retry failed");flash(body.ok?"Email retry sent":"Email retry failed");await load()}catch(error){flash(error instanceof Error?error.message:"Email retry failed")}};
   return <div className="settings-email-admin"><div className="settings-section-head"><div><div className="eyebrow">Delivery operations</div><h3>Email notifications</h3><p>Notification-only delivery through Resend. Users take action inside Olyxee Ops.</p></div><button className="btn primary" disabled={busy} onClick={test}>{busy?"Sending…":"Send test email"}</button></div>
     <div className="settings-group email-health"><b>{health?.enabled&&health?.configured?"Operational":health?"Needs configuration":"Checking…"}</b><span>{health?`${health.successful||0} successful · ${health.failed||0} failed · ${health.pending||0} pending`:"Loading delivery status"}</span></div>
     <div className="email-log-list"><div className="settings-section-head"><div><h3>Recent email log</h3><p>Recipient addresses and provider IDs are shown for troubleshooting.</p></div></div>{logs.map(item=><div className="email-log-row" key={item.id}><span><b>{item.subject}</b><small>{item.recipientEmail} · {item.type}</small></span><span className={`badge ${["FAILED","BOUNCED","COMPLAINED"].includes(item.status)?"red":"green"}`}>{item.status}</span>{["FAILED","DISABLED"].includes(item.status)&&<button className="btn" onClick={()=>retry(item.id)}>Retry</button>}</div>)}{!logs.length&&<div className="empty">No email notifications have been recorded.</div>}</div>
   </div>;
 }
 function SettingsModal({user,team,setTeam,statuses,setStatuses,tasks,flash,onClose}:{user:User;team:User[];setTeam:React.Dispatch<React.SetStateAction<User[]>>;statuses:StaffStatus[];setStatuses:React.Dispatch<React.SetStateAction<StaffStatus[]>>;tasks:Task[];flash:(s:string)=>void;onClose:()=>void}){
    const [tab,setTab]=useState<"Status"|"Profile"|"Email">("Profile");
  const current=statuses.find(s=>s.userId===user.id)||{userId:user.id,availability:"Available" as Availability,start:"09:00",end:"17:30",note:"",updatedAt:""};
  const [availability,setAvailability]=useState<Availability>(current.availability); const [start,setStart]=useState(current.start); const [end,setEnd]=useState(current.end); const [note,setNote]=useState(current.note);
  const [displayName,setDisplayName]=useState(user.name); const [avatarUrl,setAvatarUrl]=useState(user.avatarUrl||""); const [email,setEmail]=useState(user.email); const [contactDetails,setContactDetails]=useState(user.contactDetails||""); const [githubUsername,setGithubUsername]=useState(user.githubUsername||"");
   const [uploadingPhoto,setUploadingPhoto]=useState(false); const [savingProfile,setSavingProfile]=useState(false);
  const emailValid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()); const githubValid=!githubUsername.trim()||/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(githubUsername.trim());
   const saveStatus=()=>{setStatuses(all=>[...all.filter(s=>s.userId!==user.id),{userId:user.id,availability,start,end,note,updatedAt:"Just now"}]);flash("Status updated");onClose()};
     const saveProfile=async()=>{if(!displayName.trim()||!emailValid||!githubValid||uploadingPhoto)return;setSavingProfile(true);try{const response=await fetch("/api/me/profile",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:displayName.trim(),avatarUrl,contactDetails:contactDetails.trim(),githubUsername:githubUsername.trim()})});const saved=await response.json();if(!response.ok)throw new Error(saved.error||"Could not update profile");setAvatarUrl(saved.avatarUrl||"");setTeam(all=>all.map(person=>person.id===user.id?{...person,name:saved.displayName||displayName.trim(),contactDetails:saved.contactDetails||undefined,githubUsername:saved.githubUsername||undefined,avatarUrl:saved.avatarUrl||undefined}:person));flash("Profile saved");onClose()}catch(error){flash(error instanceof Error?error.message:"Could not update profile")}finally{setSavingProfile(false)}};
   const readImage=async(file?:File)=>{
     if(!file)return;
     if(!file.type.startsWith("image/")){flash("Choose an image file");return}
     if(file.size>8*1024*1024){flash("Profile image must be smaller than 8 MB");return}
      setUploadingPhoto(true);
      try{
        const source=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});
        const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const element=new window.Image();element.onload=()=>resolve(element);element.onerror=reject;element.src=source});
        const side=Math.min(image.naturalWidth,image.naturalHeight);
        const canvas=document.createElement("canvas");
        canvas.width=320;
        canvas.height=320;
        const context=canvas.getContext("2d");
        if(!context)throw new Error("Could not process this image");
        context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,320,320);
        const profileImage=canvas.toDataURL("image/jpeg",.78);
        if(profileImage.length>450000)throw new Error("This image could not be compressed enough. Choose a smaller image.");
        setAvatarUrl(profileImage);
        flash("Photo ready. Save profile to apply it.");
      }catch(error){flash(error instanceof Error?error.message:"Could not process profile image")}finally{setUploadingPhoto(false)}
   };
       const nav=[{id:"Profile" as const,label:"Profile",detail:"Photo and contact details",icon:UserRound},{id:"Status" as const,label:"Work status",detail:"Availability and hours",icon:Clock3},...(isAdmin(user)?[{id:"Email" as const,label:"Email delivery",detail:"Test and monitor notifications",icon:Bell}]:[])];
      return <Modal className="settings-dialog" title={<span className="settings-modal-title"><Settings size={18}/><span>Settings</span></span>} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button>{tab==="Status"&&<button className="btn primary" onClick={saveStatus}>Save status</button>}{tab==="Profile"&&<button className="btn primary" disabled={!displayName.trim()||!emailValid||!githubValid||uploadingPhoto||savingProfile} onClick={saveProfile}>{uploadingPhoto?"Uploading photo…":savingProfile?"Saving…":"Save profile"}</button>}</>}>
      <div className="settings-layout">
        <aside className="settings-sidebar">{nav.map(item=>{const Icon=item.icon;return <button className={tab===item.id?"active":""} onClick={()=>setTab(item.id)} key={item.id}><span className="settings-tab-icon"><Icon size={17}/></span><span className="settings-tab-copy"><b>{item.label}</b><small>{item.detail}</small></span><ChevronRight className="settings-tab-chevron" size={14}/></button>})}</aside>
       <section className="settings-panel">
          <div className="settings-panel-content" key={tab}>
            {tab==="Email"?<EmailAdminPanel flash={flash}/>:tab==="Profile"?<><div className="settings-section-head"><div><div className="eyebrow">Personal profile</div><h3>Profile details</h3><p>Your details appear across projects, staff views, and assignments.</p></div></div><div className="settings-group profile-photo-row"><Avatar person={{...user,name:displayName,avatarUrl}} size={64}/><div><b>{displayName||user.name}</b><span>{employmentOf(user)} · {accessOf(user)} · {user.department}</span><label className="profile-photo-action">{uploadingPhoto?"Uploading…":"Change photo"}<input type="file" accept="image/*" disabled={uploadingPhoto} onChange={e=>readImage(e.target.files?.[0])}/></label>{avatarUrl&&<button type="button" disabled={uploadingPhoto} onClick={()=>setAvatarUrl("")}>Remove</button>}</div></div><div className="settings-group settings-fields"><label>Full name<span><input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your full name"/>{!displayName.trim()&&<small className="field-error">Enter your name</small>}</span></label><label>Email address<span className="locked-field"><input type="email" value={email} readOnly/><small>Your sign-in email is managed by an administrator</small></span></label><label>Contact number<span><input value={contactDetails} onChange={e=>setContactDetails(e.target.value)} placeholder="+27 00 000 0000"/></span></label><label>GitHub username<span className="input-prefix"><i>@</i><input value={githubUsername} onChange={e=>setGithubUsername(e.target.value)} placeholder="username"/></span>{githubUsername&&!githubValid&&<small className="field-error">Enter a valid GitHub username</small>}</label></div></>:<><div className="settings-section-head"><div><div className="eyebrow">Work presence</div><h3>Status and hours</h3><p>This is visible to your manager and administrators.</p></div></div><div className="settings-group settings-fields"><label>Availability<span><select value={availability} onChange={e=>setAvailability(e.target.value as Availability)}>{["Available","Busy","Offline"].map(x=><option key={x}>{x}</option>)}</select></span></label><label>Working hours<span className="settings-time-pair"><input type="time" value={start} onChange={e=>setStart(e.target.value)}/><em>to</em><input type="time" value={end} onChange={e=>setEnd(e.target.value)}/></span></label><label>Current focus<span><textarea rows={3} maxLength={120} value={note} onChange={e=>setNote(e.target.value)} placeholder="What are you focused on?"/></span></label></div></>}
          </div>
       </section>
     </div>
  </Modal>
}
function Review({objectives,objectiveId,team,tasks,user,onBack,onOpenTask,onObjective,onEditObjective,setObjectives}:{objectives:WeeklyObjective[];objectiveId?:string|null;team:User[];tasks:Task[];user:User;onBack:()=>void;onOpenTask:(id:string)=>void;onObjective:(id:string)=>void;onEditObjective:(objective:WeeklyObjective)=>void;setObjectives:React.Dispatch<React.SetStateAction<WeeklyObjective[]>>}){
   const visibleObjectives=objectivesForUser(objectives,user,team);
  const owner=(objective:WeeklyObjective)=>team.find(person=>person.id===objective.managerId);
  const focused=objectiveId?visibleObjectives.find(objective=>objective.id===objectiveId):undefined;
  const [uploading,setUploading]=useState(false);
  const [uploadError,setUploadError]=useState("");
  if(focused){
    const responsible=owner(focused);
    const objectiveDepartment=responsible?.department;
    const contributors=team.filter(person=>isCurrentTeamMember(person)&&person.active!==false&&objectiveDepartment&&person.department===objectiveDepartment).sort((a,b)=>Number(b.id===focused.managerId)-Number(a.id===focused.managerId)||a.name.localeCompare(b.name));
    const departmentWork=tasks.filter(task=>objectiveDepartment&&taskDepartments(task).includes(objectiveDepartment)&&task.status!=="Cancelled");
    const weeklyWork=departmentWork.filter(task=>task.weeklyCommitment);
    const supportingWork=(weeklyWork.length?weeklyWork:departmentWork).sort((a,b)=>new Date(a.due).getTime()-new Date(b.due).getTime()).slice(0,4);
     const canEdit=accessOf(user)==="Superadmin"||focused.managerId===user.id;
     const canUpload=accessOf(user)==="Superadmin"||focused.managerId===user.id;
    const uploadResource=async(file?:File)=>{
      if(!file||!canUpload)return;
      setUploading(true);setUploadError("");
      try{
        const kind=file.type.startsWith("image/")?"image":"document";
        const url=await uploadAsset(file,kind);
        const resource:WeeklyObjectiveResource={id:crypto.randomUUID(),name:file.name,kind,url,uploadedBy:user.name,uploadedAt:new Date().toISOString()};
        setObjectives(items=>items.map(item=>item.id===focused.id?{...item,resources:[...(item.resources||[]),resource]}:item));
      }catch(error){setUploadError(error instanceof Error?error.message:"Could not upload this resource.");}
      finally{setUploading(false);}
    };
    return <div className="weekly-review-page weekly-review-focused">
       <div className="focused-review-nav"><BackButton className="workspace-back" onClick={onBack} label="Back to Home"/><span>Objective detail</span>{canEdit&&<button className="btn" onClick={()=>onEditObjective(focused)}><Pencil size={14}/> Edit</button>}</div>
      <section className={`panel objective-detail-card status-${focused.status.toLowerCase().replace(/\s+/g,"-")}`}>
        <div className="focused-objective-heading"><div className="focused-objective-title"><span className={`focused-objective-icon status-${focused.status.toLowerCase().replace(/\s+/g,"-")}`} aria-hidden="true"><ObjectiveStatusIcon status={focused.status} size={22}/></span><div><span className="eyebrow">Weekly objective</span><h1>{focused.title}</h1><div className="focused-objective-chips"><Status s={focused.status}/><span className={`review-priority priority-${focused.priority.toLowerCase()}`}>{focused.priority} priority</span></div></div></div><div className="focused-objective-owner">{responsible?<Avatar person={responsible} size={34}/>:<span className="objective-owner-fallback"><UserRound size={16}/></span>}<span><small>Responsible manager</small><strong>{responsible?.name||"Unassigned"}</strong></span></div></div>
        <div className="objective-detail-description"><span className="panel-kicker">Outcome that matters most</span><p>{focused.description||"No outcome has been described yet."}</p></div>
        <dl className="objective-detail-facts"><div><span className="objective-fact-icon"><UserRound size={16}/></span><span><dt>Owner</dt><dd>{responsible?.name||"Unassigned"}</dd></span></div><div><span className="objective-fact-icon"><Clock3 size={16}/></span><span><dt>Due date</dt><dd>{focused.dueDate}</dd></span></div><div><span className="objective-fact-icon"><ClipboardList size={16}/></span><span><dt>Created</dt><dd>{focused.createdDate}</dd></span></div><div><span className="objective-fact-icon"><FileCheck2 size={16}/></span><span><dt>Cadence</dt><dd>Weekly review</dd></span></div></dl>
        <div className="objective-focus-grid">
          <section className="objective-focus-section" aria-labelledby="objective-supporting-work"><div className="objective-focus-heading"><span className="objective-focus-heading-icon"><ListTodo size={17}/></span><span><h2 id="objective-supporting-work">Supporting work</h2><p>Current weekly tasks in {objectiveDepartment||"this objective’s department"}.</p></span></div><div className="objective-supporting-list">{supportingWork.map(task=><button type="button" key={task.id} className="objective-supporting-task" onClick={()=>onOpenTask(task.id)}><span className="objective-supporting-status"><Check size={13}/></span><span><strong>{task.title}</strong><small>{task.status} · Due {task.due}</small></span><ChevronRight size={15}/></button>)}{!supportingWork.length&&<div className="objective-focus-empty">No department tasks are available yet.</div>}</div></section>
          <section className="objective-focus-section" aria-labelledby="objective-contributors"><div className="objective-focus-heading"><span className="objective-focus-heading-icon people"><Users size={17}/></span><span><h2 id="objective-contributors">People who can contribute</h2><p>Active members of {objectiveDepartment||"the responsible team"}.</p></span></div><div className="objective-contributor-list">{contributors.slice(0,6).map(person=><div className="objective-contributor" key={person.id}><Avatar person={person} size={32}/><span><strong>{person.name}</strong><small>{person.id===focused.managerId?"Objective owner":person.position||person.role}</small></span>{person.id===focused.managerId&&<Check size={14}/>}</div>)}{!contributors.length&&<div className="objective-focus-empty">No active contributors are assigned to this department.</div>}</div></section>
        </div>
        {isManager(user)&&focused.managerId===user.id&&<div className="objective-control-row"><label className="objective-status-control"><span><span className="panel-kicker">Update progress</span><small>Keep the team’s weekly review current.</small></span><select className="select" aria-label={`Status for ${focused.title}`} value={focused.status} onChange={event=>setObjectives(items=>items.map(item=>item.id===focused.id?{...item,status:event.target.value as ObjectiveStatus}:item))}>{["Not started","In progress","At risk","Complete"].map(status=><option key={status}>{status}</option>)}</select></label></div>}
      </section>
      <section className="panel objective-resources-card" aria-labelledby="objective-resources-title">
        <div className="objective-resources-head"><div><span className="panel-kicker">Supporting material</span><h2 id="objective-resources-title">Resources</h2><p>Files attached to this objective for the team’s reference.</p></div>{canUpload&&<label className="btn primary objective-upload">{uploading?"Uploading…":"Upload file"}<Upload size={14}/><input hidden type="file" accept="image/*,.pdf,.txt,.md,.doc,.docx" disabled={uploading} onChange={event=>{void uploadResource(event.target.files?.[0]);event.currentTarget.value=""}}/></label>}</div>
        {uploadError&&<div className="objective-upload-error" role="alert">{uploadError}</div>}
        {focused.resources?.length?<div className="objective-resource-list">{focused.resources.map(resource=><a className="objective-resource" key={resource.id} href={resource.url} target="_blank" rel="noreferrer"><span className="objective-resource-icon">{resource.kind==="image"?<Image size={17}/>:<FileText size={17}/>}</span><span className="objective-resource-copy"><strong>{resource.name}</strong><small>{resource.kind==="image"?"Image":"Document"} · {new Date(resource.uploadedAt).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"})} · {resource.uploadedBy}</small></span><span className="objective-resource-action">Open <ChevronRight size={14}/></span></a>)}</div>:<div className="objective-resources-empty">No resources have been attached to this objective.</div>}
      </section>
    </div>;
  }
    return <div className="weekly-review-page weekly-review-list-page">
      <div className="weekly-review-list-hero"><Header eyebrow="Weekly review" title="Objectives" subtitle={accessOf(user)==="Superadmin"?"All objectives across every department.":user.department?`Objectives for ${user.department}.`:"Your assigned objectives."}/><span className="weekly-review-list-badge"><FileCheck2 size={16}/><b>{visibleObjectives.length}</b><small>{visibleObjectives.length===1?"objective":"objectives"}</small></span></div>
      <section className="panel objective-list-page">
        <div className="panel-head"><span><span className="panel-kicker">Current week</span><span className="panel-title">All objectives</span></span><span className="mono">{visibleObjectives.length} {visibleObjectives.length===1?"objective":"objectives"}</span></div>
        <div className="list">{visibleObjectives.map(objective=>{const responsible=owner(objective);return <article className={`objective-list-row status-${objective.status.toLowerCase().replace(/\s+/g,"-")}`} key={objective.id}><span className="objective-list-icon" aria-label={`${objective.status} objective`} title={objective.status}><ObjectiveStatusIcon status={objective.status} size={19}/></span><button type="button" className="row-main objective-list-open" onClick={()=>onObjective(objective.id)}><span className="objective-list-copy"><span className="row-title">{objective.title}</span><span className="objective-list-owner">{responsible?<Avatar person={responsible} size={22}/>:<span className="objective-owner-fallback"><UserRound size={13}/></span>}<span>{responsible?.name||"Unassigned"} · Due {objective.dueDate}</span></span></span><span className="objective-list-state"><Status s={objective.status}/><span className={`review-priority priority-${objective.priority.toLowerCase()}`}>{objective.priority}</span></span></button>{(accessOf(user)==="Superadmin"||objective.managerId===user.id)&&<button type="button" className="btn objective-list-edit" onClick={()=>onEditObjective(objective)} aria-label={`Edit ${objective.title}`}><Pencil size={14}/> <span>Edit</span></button>}<ChevronRight className="objective-list-chevron" size={16}/></article>})}{!visibleObjectives.length&&<div className="empty"><strong>No weekly objectives</strong>No objectives are available for your current department.</div>}</div>
      </section>
    </div>;
}
function DepartmentModal({managers,existing,initial,onClose,onSave}:{managers:User[];existing:[string,string,string][];initial?:[string,string,string];onClose:()=>void;onSave:(department:[string,string,string])=>void}){
  const [name,setName]=useState(initial?.[0]||"");
  const [leadId,setLeadId]=useState(managers.find(manager=>manager.name===initial?.[1])?.id||"");
  const [description,setDescription]=useState(initial?.[2]||"");
  const normalized=name.trim().toLowerCase();
  const duplicate=existing.some(department=>department[0]!==initial?.[0]&&department[0].trim().toLowerCase()===normalized);
  const lead=managers.find(manager=>manager.id===leadId);
  return <Modal title={initial?"Edit department":"Create department"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()||duplicate} onClick={()=>onSave([name.trim(),lead?.name||"Unassigned",description.trim()])}>{initial?"Save changes":"Create department"}</button></>}>
    <div className="form-grid">
      <label className="form-label">Department name<input className="input" value={name} onChange={event=>setName(event.target.value)} placeholder="e.g. Product Design"/>{duplicate&&<span className="field-error">A department with this name already exists.</span>}</label>
      <label className="form-label">Department lead<select className="select" value={leadId} onChange={event=>setLeadId(event.target.value)}><option value="">Unassigned</option>{managers.map(manager=><option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
      <label className="form-label">Purpose / description<textarea className="textarea" rows={3} maxLength={240} value={description} onChange={event=>setDescription(event.target.value)} placeholder="What is this department responsible for?"/></label>
      <div className="notice">This manages the Ops department directory. It does not modify employee records in the connected people database.</div>
    </div>
  </Modal>
}
function ObjectiveModal({objective,managers,onClose,onSave}:{objective?:WeeklyObjective;managers:User[];onClose:()=>void;onSave:(objective:Omit<WeeklyObjective,"id"|"createdBy"|"createdDate">)=>void}){
  const [title,setTitle]=useState(objective?.title||"");
  const [description,setDescription]=useState(objective?.description||"");
  const [managerId,setManagerId]=useState(objective?.managerId||managers[0]?.id||"");
  const [priority,setPriority]=useState<WeeklyObjective["priority"]>(objective?.priority||"High");
  const [dueDate,setDueDate]=useState(objective?.dueDate||"");
  const [status,setStatus]=useState<ObjectiveStatus>(objective?.status||"Not started");
  return <Modal title={objective?"Edit weekly objective":"Create weekly objective"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!title.trim()||!managerId||!dueDate} onClick={()=>onSave({title:title.trim(),description:description.trim(),managerId,priority,dueDate,status})}>{objective?"Save changes":"Create objective"}</button></>}>
    <div className="form-grid">
      <label className="form-label">Objective title<input className="input" value={title} onChange={event=>setTitle(event.target.value)}/></label>
      <label className="form-label">Description / outcome<textarea className="textarea" rows={3} value={description} onChange={event=>setDescription(event.target.value)}/></label>
      <label className="form-label">Assigned manager<select className="select" value={managerId} onChange={event=>setManagerId(event.target.value)}><option value="">Select a manager</option>{managers.map(manager=><option key={manager.id} value={manager.id}>{manager.name} · {manager.department}</option>)}</select></label>
      <label className="form-label">Priority<select className="select" value={priority} onChange={event=>setPriority(event.target.value as WeeklyObjective["priority"])}>{["Critical","High","Medium","Low"].map(value=><option key={value}>{value}</option>)}</select></label>
      {objective&&<label className="form-label">Status<select className="select" value={status} onChange={event=>setStatus(event.target.value as ObjectiveStatus)}>{["Not started","In progress","At risk","Complete"].map(value=><option key={value}>{value}</option>)}</select></label>}
      <label className="form-label">Due date<input className="input" type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label>
    </div>
  </Modal>
}