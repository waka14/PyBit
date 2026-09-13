import type { Member } from '../data/types';

export function RoleSwitch({ members, activeId, onChange }: { members: Member[]; activeId: string; onChange: (id: string) => void }) {
  return <section className="dev-switch"><span>开发模拟身份</span><select value={activeId} onChange={(event) => onChange(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.isCzh ? '主要管理员' : member.role === 'ADMIN' ? '备用管理员' : '普通成员'}</option>)}</select></section>;
}
