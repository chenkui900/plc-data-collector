import { useEffect, useState } from 'react'
import { Table, Tag, Typography, Empty, Spin } from 'antd'
import {
  HddOutlined,
  NodeIndexOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { protocolConfigs } from '../data/protocolConfigs'
import { api } from '../api/http'
import { useRealtime } from '../api/realtime'
import type { Device, LogEntry, Tag as TagType } from '../types'
import type { PushChannel } from '../types/push'
import type { Overview } from '../api/types'

const { Text } = Typography

const statusMap = {
  online: { color: '#52c41a', text: '在线' },
  offline: { color: '#bfbfbf', text: '离线' },
  error: { color: '#ff4d4f', text: '异常' },
  unknown: { color: '#faad14', text: '未知' },
}

const levelColors: Record<string, string> = {
  debug: 'default',
  info: 'blue',
  warn: 'orange',
  error: 'red',
}

function StatCard({
  label,
  value,
  icon,
  color,
  suffix,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: string
  suffix?: string
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ background: `${color}15`, color }}>
        {icon}
      </div>
      <div className="stat-card-info">
        <div className="stat-card-label">{label}</div>
        <div className="stat-card-value" style={{ color }}>
          {value}{suffix && <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 2 }}>{suffix}</span>}
        </div>
      </div>
    </div>
  )
}

function upsert<T extends { id: string }>(list: T[], item: T) {
  const index = list.findIndex((entry) => entry.id === item.id)
  if (index < 0) return [...list, item]
  const next = [...list]
  next[index] = item
  return next
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [devices, setDevices] = useState<Device[]>([])
  const [tags, setTags] = useState<TagType[]>([])
  const [pushChannels, setPushChannels] = useState<PushChannel[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  
  // 新增：用于左右联动的选中设备 ID
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  const applyOverview = (data: Overview) => {
    setDevices(data.devices)
    setTags(data.tags)
    setPushChannels(data.pushChannels)
    setLogs(data.logs)
  }

  useEffect(() => {
    let cancelled = false
    api.overview()
      .then((data) => {
        if (!cancelled) applyOverview(data)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useRealtime((msg) => {
    if (msg.type === 'hello') {
      const data = msg.data as Overview
      if ('devices' in data) {
        setDevices(data.devices)
        setTags(data.tags)
        setPushChannels(data.pushChannels)
        setLogs(data.logs.slice(0, 50))
      }
      return
    }
    if (msg.type === 'device') setDevices((prev) => upsert(prev, msg.data))
    if (msg.type === 'tag') setTags((prev) => upsert(prev, msg.data))
    if (msg.type === 'push') setPushChannels((prev) => upsert(prev, msg.data))
    if (msg.type === 'log') setLogs((prev) => [msg.data, ...prev].slice(0, 50))
  })

  const onlineCount = devices.filter((d) => d.status === 'online').length
  const enabledTags = tags.filter((t) => t.enabled)
  const runningPush = pushChannels.filter((p) => p.status === 'running').length

  // 根据左侧选中的设备，过滤右侧的点位
  const displayTags = selectedDeviceId 
    ? enabledTags.filter(t => t.deviceId === selectedDeviceId) 
    : enabledTags

  const deviceColumns = [
    {
      title: '设备',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string) => <Text strong ellipsis>{name}</Text>,
    },
    {
      title: '协议',
      dataIndex: 'protocol',
      key: 'protocol',
      width: 100,
      render: (v: string) => {
        const p = protocolConfigs.find((c) => c.type === v)
        return <span style={{ color: '#666', fontSize: 13 }}>{p?.name ?? v}</span>
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (s: keyof typeof statusMap) => {
        const info = statusMap[s] || statusMap.unknown
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: info.color }} />
            {info.text}
          </span>
        )
      },
    },
    {
      title: '点位',
      dataIndex: 'tagCount',
      key: 'tagCount',
      width: 50,
      align: 'center' as const,
    },
  ]

  const tagColumns = [
    {
      title: '点位',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string) => <Text ellipsis>{name}</Text>,
    },
    {
      title: '当前值',
      dataIndex: 'currentValue',
      key: 'currentValue',
      width: 120,
      align: 'center' as const,
      render: (v: unknown, record: TagType) => {
        if (v === undefined || v === null) return <span style={{ color: '#bfbfbf' }}>-</span>
        // 如果是布尔值，用绿色(TRUE)或红色(FALSE)显示
        if (typeof v === 'boolean') {
          return <span style={{ color: v ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>{v ? 'TRUE' : 'FALSE'}</span>
        }
        // 数值用蓝色加粗
        return <Text strong style={{ color: '#1677ff' }}>{String(v)}{record.unit ?? ''}</Text>
      },
    },
    {
      title: '质量',
      dataIndex: 'quality',
      key: 'quality',
      width: 70,
      align: 'center' as const,
      render: (q: string) => (
        <Tag color={q === 'good' ? 'green' : q === 'bad' ? 'red' : 'default'} style={{ margin: 0 }}>
          {q === 'good' ? '好' : q === 'bad' ? '坏' : '未知'}
        </Tag>
      ),
    },
  ]

  return (
    <Spin spinning={loading}>
      <div className="dashboard-page">
        <div className="dashboard-stats">
          <StatCard label="设备总数" value={devices.length} icon={<HddOutlined />} color="#1677ff" suffix={` / ${onlineCount} 在线`} />
          <StatCard label="采集点位" value={enabledTags.length} icon={<NodeIndexOutlined />} color="#52c41a" suffix={` / ${tags.length}`} />
          <StatCard label="推送通道" value={runningPush} icon={<SendOutlined />} color="#722ed1" suffix={` / ${pushChannels.length}`} />
          <StatCard label="支持协议" value={protocolConfigs.length} icon={<ThunderboltOutlined />} color="#fa8c16" suffix=" 种" />
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-panel">
            <div className="dashboard-panel-header">
              <span className="dashboard-panel-title">设备状态</span>
              <Tag>{devices.length}</Tag>
            </div>
            <div className="dashboard-panel-body">
              <Table
                dataSource={devices}
                columns={deviceColumns}
                rowKey="id"
                pagination={false}
                size="middle"
                locale={{ emptyText: <Empty description="暂无设备，请先添加" /> }}
                // 增加行点击联动
                onRow={(record) => ({
                  onClick: () => setSelectedDeviceId(prev => prev === record.id ? null : record.id),
                  style: { 
                    cursor: 'pointer', 
                    background: selectedDeviceId === record.id ? '#e6f4ff' : undefined 
                  }
                })}
              />
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="dashboard-panel-header">
              <span className="dashboard-panel-title">
                实时数据
                {selectedDeviceId && <span style={{ fontSize: 13, color: '#1677ff', marginLeft: 8 }}>(已过滤)</span>}
              </span>
              <Tag color="processing">LIVE</Tag>
            </div>
            <div className="dashboard-panel-body">
              <Table
                dataSource={displayTags}
                columns={tagColumns}
                rowKey="id"
                pagination={false}
                size="middle"
                locale={{ emptyText: <Empty description="暂无启用点位" /> }}
              />
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="dashboard-panel-header">
              <span className="dashboard-panel-title">推送状态</span>
            </div>
            <div className="dashboard-panel-body">
              <Table
                dataSource={pushChannels}
                rowKey="id"
                pagination={false}
                size="middle"
                locale={{ emptyText: <Empty description="暂无推送通道" /> }}
                columns={[
                  { title: '通道', dataIndex: 'name', key: 'name', ellipsis: true },
                  {
                    title: '类型',
                    dataIndex: 'type',
                    key: 'type',
                    width: 70,
                    render: (v: string) => <Tag style={{ margin: 0 }}>{v.toUpperCase()}</Tag>,
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    key: 'status',
                    width: 70,
                    render: (s: string) => (
                      <Tag color={s === 'running' ? 'green' : s === 'error' ? 'red' : 'default'} style={{ margin: 0 }}>
                        {s === 'running' ? '运行' : s === 'error' ? '异常' : '停止'}
                      </Tag>
                    ),
                  },
                ]}
              />
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="dashboard-panel-header">
              <span className="dashboard-panel-title">最新日志</span>
              <Tag>{logs.length}</Tag>
            </div>
            <div className="dashboard-panel-body">
              <div className="log-list">
                {logs.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志" />}
                {logs.map((log) => (
                  <div key={log.id} className="log-item">
                    <div className="log-item-meta">
                      <Tag color={levelColors[log.level]} style={{ margin: 0, fontSize: 12, lineHeight: '18px' }}>
                        {log.level.toUpperCase()}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 13 }}>{(log.time ?? '').split(' ')[1] ?? ''}</Text>
                      <Tag style={{ margin: 0, fontSize: 12 }}>{log.source}</Tag>
                    </div>
                    <div className="log-item-msg">{log.message}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Spin>
  )
}