export type EmploymentType="Employee"|"Intern";
export type AccessRole="Superadmin"|"Admin"|"Manager"|"Member";
export type AccountStatus="Active"|"Pending"|"Suspended";
export type Status="Not Started"|"In Progress"|"Blocked"|"Submitted for Review"|"Changes Requested"|"Completed"|"Cancelled";
export type User={id:string;name:string;email:string;employmentType:EmploymentType;accessRole:AccessRole;accountStatus:AccountStatus;department:string;position?:string;reportsTo?:string;avatarUrl?:string;contactDetails?:string;githubUsername?:string;role?:string;active?:boolean;hasOpsAccess?:boolean;opsRole?:AccessRole;opsActive?:boolean;lastLoginAt?:string;lastSeenAt?:string;departmentReviewRequired?:boolean};
export type Availability="Available"|"Busy"|"Offline";
export type StaffStatus={userId:string;availability:Availability;start:string;end:string;note:string;updatedAt:string};
export type Blocker={reason:string;need:string;waitingFor:string;severity:"Low"|"Medium"|"High"|"Critical";reportedBy:string;createdAt:string;resolvedAt?:string};
export type Comment={id:string;author:string;text:string;createdAt:string};
export type TaskChecklistItem={id:string;text:string;completed:boolean;completedAt?:string;createdAt?:string};
export type TaskUpdate={id:string;authorId:string;authorName:string;authorRole:string;type:string;message:string;linkUrl?:string;createdAt:string};
export type TaskEvidence={id:string;label:string;url:string;createdAt:string};
export type TaskActivity={id:string;actorName:string;action:string;metadata?:Record<string,unknown>;createdAt:string};
export type Task={id:string;code?:string;title:string;project:string;githubUrl?:string;department?:string;departmentIds?:string[];createdBy?:string;creatorName?:string;status:Status;assignee?:string;assigneeIds?:string[];taskLeadId?:string;priority:"Critical"|"High"|"Medium"|"Low"|"Normal"|"Urgent";createdDate?:string;startDate?:string;due:string;targetWeek?:string;description:string;deliverables?:string;criteria:string[];dependencies?:string[];comments?:Comment[];activity?:string[];reviewState?:"Not submitted"|"Awaiting review"|"Changes requested"|"Approved";attachments?:string[];pr?:string;blocker?:Blocker;blockerReason?:string;weeklyCommitment?:boolean;available?:boolean;merged?:boolean;submittedAt?:string;completedAt?:string;checklist?:TaskChecklistItem[];updates?:TaskUpdate[];evidence?:TaskEvidence[];activityLog?:TaskActivity[]};
export type Audit={id:string;actor:string;action:string;time:string};
export type Notice={id:string;userId:string;title:string;body:string;read:boolean;time:string};
export type ObjectiveStatus="Not started"|"In progress"|"Blocked"|"At risk"|"Complete";
export type WeeklyObjectiveResource={id:string;name:string;kind:"document"|"image";url:string;uploadedBy:string;uploadedAt:string};
export type WeeklyObjective={id:string;title:string;description:string;managerId:string;projectIds?:string[];priority:"Critical"|"High"|"Medium"|"Low";dueDate:string;status:ObjectiveStatus;createdBy:string;createdDate:string;resources?:WeeklyObjectiveResource[];blockerMessage?:string;blockedAt?:string;completedAt?:string};
export type Access={id:string;requester:string;department:string;resourceType:string;system:string;relatedTask:string;reason:string;status:"Pending"|"Approved"|"Rejected";date:string};
export type ProjectResource={id:string;name:string;kind:"document"|"image";url?:string};
export type Project={id:string;name:string;description:string;githubUrl:string;assigneeIds:string[];resources:ProjectResource[];active:boolean;status:"Active"|"Archived";logoUrl?:string};

export const users:User[]=[];
export const seedStaffStatuses:StaffStatus[]=[];
export const projects:string[]=[];
export const seedProjects:Project[]=[];
export const seedTasks:Task[]=[];
export const seedAccess:Access[]=[];
export const seedAudit:Audit[]=[];
export const seedNotices:Notice[]=[];
export const seedWeeklyObjectives:WeeklyObjective[]=[];
export const departments:[string,string,string][]=[
  ["Research & Development (R&D)","Unassigned","Software, product, research engineering, and prototyping."],
  ["Engineering","Unassigned","Software, machine learning, applied AI, agents, and technical systems."],
  ["Data & Security","Unassigned","Data platforms, analytics, governance, cybersecurity, and protection."],
  ["Sales & Marketing","Unassigned","Growth, sales, partnerships, customer success, and communications."],
  ["Business Operations","Unassigned","Operations, finance, people, administration, legal, and coordination."],
];