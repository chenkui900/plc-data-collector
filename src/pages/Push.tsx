import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Space,
  Tag,
  Switch,
  Popconfirm,
  message,
  Typography,
  Tabs,
  Badge,
  Table,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { PushChannel, PushType } from '../types/push'
import { pushTypeLabels } from '../data/pushTypes'
import PageContainer, { TableWrapper } from '../components/PageContainer'
import PushFormModal from '../components/PushFormModal'
import { api } from '../api/http'
import { useRealtime } from '../api/realtime'

const { Text } = Typography

const statusMap = {
  running: { color: 'success', text: '运行中' },
  stopped: { color: 'default', text: '已停止' },
  error: { color: 'error', text: '异常' },
}

const typeTabs: { key: PushType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'mqtt', label: 'MQTT' },
  { key: 'tcp', label: 'TCP' },
  { key: 'http', label: 'HTTP' },
  { key: 'mysql', label: 'MySQL' },
]

export default function Push() {
  const [channels, setChannels] = useState<PushChannel[]>([])
  const [activeTab, setActiveTab] = useState<PushType | 'all'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<PushChannel | null>(null)
  const [addType, setAddType] = useState<PushType | undefined>()

  const load = async () => {
    try {
      setChannels(await api.push.list())
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  useEffect(() => { void load() }, [])

  useRealtime((msg) => {
    if (msg.type === 'push') {
      setChannels((prev) => {
        const index = prev.findIndex((item) => item.id === msg.data.id)
        if (index < 0) return [...prev, msg.data]
        const next = [...prev]
        next[index] = msg.data
        return next
      })
    }
    if (msg.type === 'hello' && 'pushChannels' in msg.data) {
      setChannels(msg.data.pushChannels)
    }
  })

  const filtered = activeTab === 'all' ? channels : channels.filter((c) => c.type === activeTab)

  const handleSave = async (channel: PushChannel) => {
    try {
      if (editingChannel) {
        await api.push.update(editingChannel.id, channel)
        message.success('推送已更新')
      } else {
        await api.push.create(channel)
        message.success('推送已添加')
      }
      setModalOpen(false)
      setEditingChannel(null)
      await load()
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const getTarget = (record: PushChannel) => {
    switch (record.type) {
      case 'mqtt':
        return `${record.broker}:${record.port}  ${record.topic}`
      case 'tcp':
        return `${record.host}:${record.tcpPort}`
      case 'http':
        return record.url ?? '-'
      case 'mysql':
        return `${record.dbHost}/${record.database}.${record.table}`
      default:
        return '-'
    }
  }

  const columns = useMemo(() => [
    {
      title: '通道名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: PushChannel) => (
        <div className="cell-text">
          <Text strong>{name}</Text>
          {record.description && (
            <Text type="secondary" className="cell-desc">{record.description}</Text>
          )}
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (v: PushType) => {
        const cfg = pushTypeLabels[v]
        return <Tag color={cfg.color}>{cfg.label}</Tag>
      },
    },
    {
      title: '推送目标',
      key: 'target',
      ellipsis: true,
      render: (_: unknown, record: PushChannel) => (
        <Text className="mono-text">{getTarget(record)}</Text>
      ),
    },
    {
      title: '间隔',
      dataIndex: 'pushInterval',
      key: 'pushInterval',
      width: 110,
      render: (v: number) => `${v} ms`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: keyof typeof statusMap) => (
        <Badge status={s === 'running' ? 'processing' : s === 'error' ? 'error' : 'default'} text={statusMap[s].text} />
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (enabled: boolean, record: PushChannel) => (
        <Switch
          checked={enabled}
          onChange={async (v) => {
            try {
              await api.push.patch(record.id, { enabled: v })
            } catch (error) {
              message.error((error as Error).message)
            }
          }}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: unknown, record: PushChannel) => (
        <Space size={8}>
          <Button
            type="link"
            className="action-link"
            onClick={() => {
              setEditingChannel(record)
              setModalOpen(true)
            }}
          >
            编辑
          </Button>
          <Popconfirm title="确定删除该通道？" onConfirm={async () => {
            try {
              await api.push.remove(record.id)
              message.success('已删除')
              await load()
            } catch (error) {
              message.error((error as Error).message)
            }
          }}>
            <Button type="link" danger className="action-link">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [])

  const openAdd = (type?: PushType) => {
    setEditingChannel(null)
    setAddType(type)
    setModalOpen(true)
  }

  return (
    <>
      <PageContainer
        title={`推送配置  ${filtered.length}`}
        extra={
          <Button
            onClick={() => openAdd(activeTab !== 'all' ? activeTab : undefined)}
            icon={<PlusOutlined />}
            type="primary"
            size="large"
          >
            添加推送
          </Button>
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as PushType | 'all')}
          size="large"
          style={{ flexShrink: 0 }}
          items={typeTabs.map((t) => ({
            key: t.key,
            label: t.key === 'all'
              ? t.label
              : `${t.label} ${channels.filter((c) => c.type === t.key).length}`,
          }))}
        />
        <TableWrapper>
          <Table
            dataSource={filtered}
            columns={columns}
            rowKey="id"
            pagination={false}
          />
        </TableWrapper>
      </PageContainer>

      <PushFormModal
        open={modalOpen}
        channel={editingChannel}
        defaultType={addType}
        onCancel={() => {
          setModalOpen(false)
          setEditingChannel(null)
        }}
        onSave={handleSave}
      />
    </>
  )
}
