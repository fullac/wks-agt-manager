// 在 Paseo 插件设置中查看操作记录、取消排队并选择会话的导入工作区。
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useRpc, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { SettingsAction, SettingsRow, SettingsSection, SettingsSelect } from '@getpaseo/plugin/client/ui';
import { management } from '../shared/management';

const states: Record<string, string> = {
  queued: '已排队', applying: '执行中', done: '已完成', error: '失败', cancelled: '已取消',
};
const actions: Record<string, string> = {move: '移动工作区', release: '移除 Agent', remove: '移除工作区'};

export function HistorySettings({host}: PluginSurfaceProps) {
  return <History key={host.id} host={host.id} />;
}

function History({host}: {host: string}) {
  const rpc = useRpc(management);
  const [data, setData] = useState<Awaited<ReturnType<typeof rpc>>>();
  const [expanded, setExpanded] = useState('');
  const [session, setSession] = useState('');
  const [destination, setDestination] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const version = ++revision.current;
    try {
      const result = await rpc({host, op: 'history'});
      if (version === revision.current) { setData(result); setError(''); }
    } catch (e) {
      if (version === revision.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [host, rpc]);
  useEffect(() => { void load(); return () => { revision.current++; }; }, [load]);

  async function run(op: 'import'|'cancel', workspace: string, target: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setNotice(''); setError('');
    try {
      await rpc({host, op, workspace, target});
      setNotice(op === 'import' ? '会话已导入' : '已取消排队');
      setSession(''); setDestination('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      locked.current = false; setBusy(false);
    }
  }

  const sessions = data?.released ?? [];
  const workspaces = data?.destinations ?? [];
  const selected = sessions.find(a => a.id === session);
  const target = workspaces.find(w => w.id === destination);
  return <>
    <SettingsSection title="操作记录">
      {data?.jobs?.map(j => {
        const label = [actions[j.action ?? ''], j.name].filter(Boolean).join(' · ');
        const hint = [states[j.state] ?? j.state, j.error].filter(Boolean).join(' · ');
        const showDetails = expanded === j.id;
        return <React.Fragment key={j.id}>
          <SettingsAction label={label} hint={hint} actionLabel={showDetails ? '收起' : '详情'}
            onPress={() => setExpanded(showDetails ? '' : j.id)} />
          {showDetails && <SettingsRow label="本机操作记录"
            hint={'~/.paseo/plugin-data/subagent-groups/management/' + j.id + '/'} />}
          {j.state === 'queued' && j.workspace && <SettingsAction label="等待后台停止"
            actionLabel="取消排队" disabled={busy} onPress={() => void run('cancel', j.workspace!, j.id)} />}
        </React.Fragment>;
      })}
      <SettingsAction label={data?.jobs?.length ? '更新记录' : data ? '暂无操作记录' : '读取操作记录'}
        hint={notice || undefined} error={error || undefined} actionLabel="刷新" disabled={busy} onPress={() => void load()} />
    </SettingsSection>
    <SettingsSection title="重新导入">
      {sessions.length > 0 ? <>
        <SettingsSelect label="原生会话" value={selected?.id ?? ''} disabled={busy}
          options={[{value:'', label:'选择会话'}, ...sessions.map(a => ({value:a.id, label:a.title + ' · ' + a.provider}))]}
          onValueChange={setSession} />
        <SettingsSelect label="目标工作区" value={target?.id ?? ''} disabled={busy}
          options={[{value:'', label:'选择工作区'}, ...workspaces.map(w => ({value:w.id, label:w.name}))]}
          onValueChange={setDestination} />
        <SettingsAction label={selected && target ? selected.title + ' → ' + target.name : '导入到所选工作区'}
          actionLabel="确认导入" disabled={busy || !selected || !target}
          onPress={() => { if (selected && target) void run('import', target.id, selected.id); }} />
      </> : <SettingsRow label={data ? '暂无可导入的会话' : '正在读取会话…'} />}
    </SettingsSection>
  </>;
}
