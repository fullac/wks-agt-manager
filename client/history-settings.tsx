// 在 Paseo 插件设置中查看操作记录、取消排队并选择会话的导入工作区。
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useRpc, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Icon, SettingsAction, SettingsSelect } from '@getpaseo/plugin/client/ui';
import { management } from '../shared/management';

const states: Record<string, string> = {
  queued: '已排队', applying: '执行中', done: '已完成', error: '失败', cancelled: '已取消',
};
const actions: Record<string, string> = {move: '移动工作区', release: '移除 Agent', remove: '移除工作区'};

const glyphs = {
  move: 'M3 6h7l2 2h8v3M3 6v12h7m3-2h8m-3-3 3 3-3 3',
  release: 'M11 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 8v-2c0-2.5 3.5-4 8-4m4 3h7',
  remove: 'M3 6h7l2 2h8v3M3 6v12h7m4-2h7',
  next: 'm9 6 6 6-6 6', down: 'm6 9 6 6 6-6',
  refresh: 'M20 10a8 8 0 1 0-1.8 7M20 4v6h-6',
  inbox: 'm3 14 3-9h12l3 9v5H3zm0 0h5l2 3h4l2-3h5',
  history: 'M4 12a8 8 0 1 0 2-5M4 3v5h5m3 0v5l3 2',
};
function Glyph({name, color, size = 16}: {name: keyof typeof glyphs; color: string; size?: number}) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="' + glyphs[name] + '"/></svg>';
  return <Icon icon={{svg}} size={size} color={color} />;
}

export function HistorySettings(props: PluginSurfaceProps) {
  return <History key={props.host.id} {...props} />;
}

function History({host: {id: host}, theme: {colors}, layout}: PluginSurfaceProps) {
  const rpc = useRpc(management);
  const [data, setData] = useState<Awaited<ReturnType<typeof rpc>>>();
  const [expanded, setExpanded] = useState('');
  const [session, setSession] = useState('');
  const [destination, setDestination] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const locked = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const version = ++revision.current;
    setLoading(true);
    try {
      const result = await rpc({host, op: 'history'});
      if (version === revision.current) { setData(result); setError(''); }
    } catch (e) {
      if (version === revision.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (version === revision.current) setLoading(false);
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
  const jobs = data?.jobs ?? [];
  const panel = [styles.panel, {backgroundColor: colors.surface1, borderColor: colors.border}];
  const heading = [styles.heading, {color: colors.foreground}];
  const muted = {color: colors.foregroundMuted};
  const statusColor: Record<string, string> = {
    done: colors.statusSuccess, queued: colors.statusWarning, applying: colors.accent,
    error: colors.statusDanger, cancelled: colors.foregroundMuted,
  };
  const empty = (name: 'history'|'inbox', label: string) => (
    <View style={styles.empty}><Glyph name={name} color={colors.foregroundMuted} />
      <Text style={[styles.small, muted]}>{label}</Text>
    </View>
  );

  return <View style={styles.groups}>
    <View>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={heading}>操作记录</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="刷新操作记录"
          disabled={busy || loading} onPress={() => void load()}
          style={({pressed}) => [styles.refresh, {backgroundColor: pressed ? colors.surface2 : 'transparent'}]}>
          <Glyph name="refresh" size={14} color={colors.foregroundMuted} />
          <Text style={[styles.small, muted]}>{loading && data ? '刷新中' : '刷新'}</Text>
        </Pressable>
      </View>
      <View style={panel}>
        {jobs.map((j, index) => {
          const action = actions[j.action ?? ''] ?? j.action ?? '操作';
          const state = states[j.state] ?? j.state;
          const showDetails = expanded === j.id;
          const glyph = j.action === 'move' || j.action === 'release' || j.action === 'remove' ? j.action : 'history';
          const tone = statusColor[j.state] ?? colors.foregroundMuted;
          return <View key={j.id} style={index > 0 && {borderTopWidth: 1, borderTopColor: colors.border}}>
            <Pressable accessibilityRole="button" accessibilityLabel={[j.name, action, state].join('，')}
              accessibilityState={{expanded: showDetails}} onPress={() => setExpanded(showDetails ? '' : j.id)}
              style={({pressed}) => [styles.row, (showDetails || pressed) && {backgroundColor: colors.surface2}]}>
              <View style={[styles.iconSlot, {backgroundColor: colors.surface2}]}>
                <Glyph name={glyph} color={colors.foreground} />
              </View>
              <View style={[styles.identity, !layout.compact && styles.inline]}>
                <Text numberOfLines={1} style={[styles.name, {color: colors.foreground}]}>{j.name}</Text>
                <Text style={[styles.small, muted]}>{action}</Text>
              </View>
              <View style={styles.status}><View style={[styles.dot, {backgroundColor: tone}]} />
                <Text style={[styles.small, muted]}>{state}</Text>
              </View>
              <Glyph name={showDetails ? 'down' : 'next'} color={colors.foregroundMuted} size={14} />
            </Pressable>
            {j.error && <Text accessibilityLiveRegion="polite" style={[styles.feedback, {color:colors.statusDanger}]}>{j.error}</Text>}
            {showDetails && <View style={[styles.detail, {borderTopColor:colors.border}]}>
              <Text style={[styles.small, muted]}>本机操作记录</Text>
              <Text selectable style={[styles.path, {color:colors.foreground}]}>{'~/.paseo/plugin-data/subagent-groups/management/' + j.id + '/'}</Text>
            </View>}
            {j.state === 'queued' && j.workspace && <SettingsAction label="等待后台停止"
              actionLabel="取消排队" disabled={busy} onPress={() => void run('cancel', j.workspace!, j.id)} />}
          </View>;
        })}
        {!jobs.length && empty('history', data ? '暂无操作记录' : error ? '操作记录未载入' : '正在读取操作记录…')}
      </View>
      {(error || notice) ? <Text accessibilityLiveRegion="polite" style={[styles.feedback,
        {color:error ? colors.statusDanger : colors.foreground}]}>{error || notice}</Text> : null}
    </View>
    <View>
      <View style={styles.header}><Text accessibilityRole="header" style={heading}>重新导入</Text></View>
      <View style={panel}>
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
        </> : empty('inbox', data ? '暂无可导入的会话' : error ? '会话未载入' : '正在读取会话…')}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  groups: {gap: 18, paddingBottom: 18},
  header: {minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 4},
  heading: {fontSize: 13, fontWeight: '600'},
  refresh: {flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: 7, borderRadius: 6},
  panel: {borderWidth: 1, borderRadius: 12, overflow: 'hidden'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 13, paddingVertical: 8},
  iconSlot: {width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center'},
  identity: {flex: 1, minWidth: 0, gap: 2},
  inline: {flexDirection: 'row', alignItems: 'baseline', gap: 9},
  name: {flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '500'},
  small: {fontSize: 12, lineHeight: 17},
  status: {flexDirection: 'row', alignItems: 'center', gap: 6},
  dot: {height: 6, width: 6, borderRadius: 3},
  detail: {borderTopWidth: 1, gap: 3, paddingHorizontal: 15, paddingVertical: 10},
  path: {fontSize: 12, lineHeight: 18},
  feedback: {fontSize: 13, lineHeight: 19, marginHorizontal: 12, marginVertical: 6},
  empty: {flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, minHeight: 42},
});
