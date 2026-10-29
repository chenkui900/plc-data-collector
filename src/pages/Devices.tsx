import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Tag,
  Switch,
  Popconfirm,
  message,
  Typography,
} from 'antd'
import { PlusOutlined, ApiOutlined } from '@ant-design/icons'
import type { Device } from '../types'
import { protocolConfigs } from '../data/protocolConfigs'
import DeviceFormModal from '../components/DeviceFormModal'
import PageContainer, { TableWrapper } from '../components/PageContainer'
import { api } from '../api/http'
import { useRealtime } from '../api/realtime'

const { Text } = Typography

const statusMap = {
  online: { color: 'success', text: '在线' },
  offline: { color: 'default', text: '离线' },
  error: { color: 'error', text: '异常' },
  unknown: { color: 'warning', text: '未知' },
}

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDevice, setEditingDevice] = useState<Device | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const load = async () => {
    try {
      setDevices(await api.devices.list())
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  useEffect(() => { void load() }, [])

  useRealtime((msg) => {
    if (msg.type === 'device') {
      setDevices((prev) => {
        const index = prev.findIndex((item) => item.id === msg.data.id)
        if (index < 0) return [...prev, msg.data]
        const next = [...prev]
        next[index] = msg.data
        return next
      })
    }
    if (msg.type === 'hello' && 'devices' in msg.data) {
      setDevices(msg.data.devices)
    }
  })

  const getProtocolName = (type: string) =>
    protocolConfigs.find((p) => p.type === type)?.name ?? type

  const handleSave = async (device: Device) => {
    try {
      if (editingDevice) {
        await api.devices.update(editingDevice.id, device)
        message.success('设备已更新')
      } else {
        await api.devices.create(device)
        message.success('设备已添加')
      }
      setModalOpen(false)
      setEditingDevice(null)
      await load()
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const handleTest = async (record: Device) => {
    setTestingId(record.id)
    try {
      const result = await api.devices.test(record.id)
      message.success(result.message)
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setTestingId(null)
    }
  }

  const columns = [
    {
      title: '设备名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: Device) => (
        <div className="cell-text">
          <Text strong>{name}</Text>
          {record.description && (
            <Text type="secondary" className="cell-desc">{record.description}</Text>
          )}
        </div>
      ),
    },
    {
      title: '通讯协议',
      dataIndex: 'protocol',
      key: 'protocol',
      width: 180,
      render: (v: string) => <Tag color="blue">{getProtocolName(v)}</Tag>,
    },
    {
      title: '连接地址',
      key: 'address',
      width: 220,
      render: (_: unknown, record: Device) => (
        <Text className="mono-text">
          {record.host ? `${record.host}:${record.port}` : record.serialPort ?? '-'}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: keyof typeof statusMap) => (
        <Tag color={statusMap[s].color}>{statusMap[s].text}</Tag>
      ),
    },
    {
      title: '点位',
      dataIndex: 'tagCount',
      key: 'tagCount',
      width: 90,
      align: 'center' as const,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (enabled: boolean, record: Device) => (
        <Switch
          checked={enabled}
          onChange={async (v) => {
            try {
              await api.devices.patch(record.id, { enabled: v })
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
      width: 210,
      render: (_: unknown, record: Device) => (
        <Space size={8}>
          <Button
            type="link"
            className="action-link"
            icon={<ApiOutlined />}
            loading={testingId === record.id}
            onClick={() => void handleTest(record)}
          >
            测试
          </Button>
          <Button
            type="link"
            className="action-link"
            onClick={() => {
              setEditingDevice(record)
              setModalOpen(true)
            }}
          >
            编辑
          </Button>
          <Popconfirm title="确定删除该设备？" onConfirm={async () => {
            try {
              await api.devices.remove(record.id)
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
  ]

  return (
    <>
      <PageContainer
        title={`设备列表  ${devices.length}`}
        extra={
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingDevice(null)
              setModalOpen(true)
            }}
          >
            添加设备
          </Button>
        }
      >
        <TableWrapper>
          <Table
            dataSource={devices}
            columns={columns}
            rowKey="id"
            pagination={false}
          />
        </TableWrapper>
      </PageContainer>

      <DeviceFormModal
        open={modalOpen}
        device={editingDevice}
        onCancel={() => {
          setModalOpen(false)
          setEditingDevice(null)
        }}
        onSave={handleSave}
      />
    </>
  )
}
