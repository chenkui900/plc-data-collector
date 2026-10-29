import { useEffect, useState } from 'react'
import {
  Table,
  Tag,
  Space,
  Select,
  Button,
  Typography,
  Input,
  message,
} from 'antd'
import {
  PauseCircleOutlined,
  ClearOutlined,
  DownloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import type { LogEntry } from '../types'
import PageContainer, { TableWrapper, Toolbar } from '../components/PageContainer'
import { api } from '../api/http'
import { useRealtime } from '../api/realtime'

const { Text } = Typography

const levelColors: Record<string, string> = {
  debug: 'default',
  info: 'blue',
  warn: 'orange',
  error: 'red',
}

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [levelFilter, setLevelFilter] = useState<string | undefined>()
  const [sourceFilter, setSourceFilter] = useState<string | undefined>()
  const [searchText, setSearchText] = useState('')

  const load = async () => {
    try {
      setLogs(await api.logs.list())
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  useEffect(() => { void load() }, [])

  useRealtime((msg) => {
    if (paused) return
    if (msg.type === 'log') {
      setLogs((prev) => [msg.data, ...prev].slice(0, 500))
    }
  })

  const sources = [...new Set(logs.map((l) => l.source))]

  const filteredLogs = logs.filter((l) => {
    if (levelFilter && l.level !== levelFilter) return false
    if (sourceFilter && l.source !== sourceFilter) return false
    if (searchText && !l.message.toLowerCase().includes(searchText.toLowerCase())) return false
    return true
  })

  const columns = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (v: string) => <Text className="mono-text">{v}</Text>,
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 90,
      render: (v: string) => <Tag color={levelColors[v]} style={{ margin: 0 }}>{v.toUpperCase()}</Tag>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 120,
      render: (v: string) => <Tag style={{ margin: 0 }}>{v}</Tag>,
    },
    {
      title: '消息',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (v: string, record: LogEntry) => (
        <Text style={{ color: record.level === 'error' ? '#ff4d4f' : record.level === 'warn' ? '#fa8c16' : undefined }}>
          {v}
        </Text>
      ),
    },
  ]

  return (
    <PageContainer
      title={
        <Space>
          <span>实时日志</span>
          {!paused && <Tag color="processing">LIVE</Tag>}
          <Text type="secondary" style={{ fontSize: 14, fontWeight: 'normal' }}>{filteredLogs.length} 条</Text>
        </Space>
      }
    >
      <Toolbar>
        <Input
          placeholder="搜索"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 240 }}
          allowClear
          size="large"
        />
        <Select
          placeholder="级别"
          allowClear
          size="large"
          style={{ width: 120 }}
          value={levelFilter}
          onChange={setLevelFilter}
          options={['debug', 'info', 'warn', 'error'].map((v) => ({ value: v, label: v.toUpperCase() }))}
        />
        <Select
          placeholder="来源"
          allowClear
          size="large"
          style={{ width: 140 }}
          value={sourceFilter}
          onChange={setSourceFilter}
          options={sources.map((s) => ({ value: s, label: s }))}
        />
        <Button
          size="large"
          icon={<PauseCircleOutlined />}
          type={paused ? 'primary' : 'default'}
          onClick={() => setPaused(!paused)}
        >
          {paused ? '继续' : '暂停'}
        </Button>
        <Button size="large" icon={<ClearOutlined />} onClick={async () => {
          try {
            await api.logs.clear()
            setLogs([])
          } catch (error) {
            message.error((error as Error).message)
          }
        }}>清空</Button>
        <Button size="large" icon={<DownloadOutlined />} onClick={() => {
          const blob = new Blob([JSON.stringify(filteredLogs, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `logs_${Date.now()}.json`
          a.click()
          URL.revokeObjectURL(url)
        }}>导出</Button>
      </Toolbar>
      <TableWrapper>
        <Table
          dataSource={filteredLogs}
          columns={columns}
          rowKey="id"
          pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }}
          rowClassName={(record) =>
            record.level === 'error' ? 'log-row-error' : record.level === 'warn' ? 'log-row-warn' : ''
          }
        />
      </TableWrapper>
    </PageContainer>
  )
}
