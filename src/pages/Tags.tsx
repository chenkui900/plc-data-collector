import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Tag,
  Switch,
  Select,
  Input,
  Popconfirm,
  message,
  Typography,
  Badge,
  Modal,
} from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons'
import type { Device, Tag as TagType } from '../types'
import { combinedDataTypeLabel } from '../data/protocolConfigs'
import { downloadText, parseTagCsv, tagTemplateCsv, tagsToCsv } from '../data/tagCsv'
import TagFormDrawer from '../components/TagFormDrawer'
import PageContainer, { TableWrapper, Toolbar } from '../components/PageContainer'
import { api } from '../api/http'
import { useRealtime } from '../api/realtime'

const { Text } = Typography

export default function Tags() {
  const [tags, setTags] = useState<TagType[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<TagType | null>(null)
  const [searchText, setSearchText] = useState('')
  const [filterDevice, setFilterDevice] = useState<string | undefined>()
  const [writeTag, setWriteTag] = useState<TagType | null>(null)
  const [writeValue, setWriteValue] = useState('')
  const [writing, setWriting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    try {
      const [tagList, deviceList] = await Promise.all([api.tags.list(), api.devices.list()])
      setTags(tagList)
      setDevices(deviceList)
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  useEffect(() => { void load() }, [])

  useRealtime((msg) => {
    if (msg.type === 'tag') {
      setTags((prev) => {
        const index = prev.findIndex((item) => item.id === msg.data.id)
        if (index < 0) return [...prev, msg.data]
        const next = [...prev]
        next[index] = msg.data
        return next
      })
    }
    if (msg.type === 'hello' && 'tags' in msg.data) {
      setTags(msg.data.tags)
      if ('devices' in msg.data) setDevices(msg.data.devices)
    }
  })

  const filteredTags = useMemo(() => {
    return tags.filter((t) => {
      if (filterDevice && t.deviceId !== filterDevice) return false
      if (searchText) {
        const s = searchText.toLowerCase()
        return (
          t.name.toLowerCase().includes(s) ||
          t.address.toLowerCase().includes(s) ||
          t.deviceName.toLowerCase().includes(s)
        )
      }
      return true
    })
  }, [tags, filterDevice, searchText])

  const handleSave = async (tag: TagType) => {
    try {
      if (editingTag) {
        await api.tags.update(editingTag.id, tag)
        message.success('点位已更新')
      } else {
        await api.tags.create(tag)
        message.success('点位已添加')
      }
      setFormOpen(false)
      setEditingTag(null)
      await load()
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const handleExport = () => {
    downloadText(`tags_${Date.now()}.csv`, tagsToCsv(filteredTags))
    message.success(`已导出 ${filteredTags.length} 个点位`)
  }

  const handleTemplate = () => {
    downloadText('tags_template.csv', tagTemplateCsv())
  }

  const handleImportFile = async (file: File) => {
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = parseTagCsv(text, devices)
      if (!parsed.tags.length) {
        throw new Error(parsed.errors[0] || '没有可导入的点位')
      }
      const result = await api.tags.import(parsed.tags)
      const extra = [...parsed.errors, ...result.errors]
      if (result.created) message.success(`成功导入 ${result.created} 个点位`)
      if (extra.length) message.warning(extra.slice(0, 3).join('；'))
      await load()
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const handleWrite = async () => {
    if (!writeTag) return
    setWriting(true)
    try {
      let value: string | number | boolean = writeValue
      if (writeTag.dataType === 'bool') {
        value = writeValue === 'true' || writeValue === '1'
      } else if (writeTag.dataType !== 'string' && writeValue !== '') {
        value = Number(writeValue)
        if (Number.isNaN(value)) throw new Error('请输入有效数字')
      }
      await api.tags.write(writeTag.id, value)
      message.success('写入成功')
      setWriteTag(null)
      setWriteValue('')
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setWriting(false)
    }
  }

  const columns = [
    {
      title: '点位名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string) => (
        <Text strong>{name}</Text>
      ),
    },
    { title: '设备', dataIndex: 'deviceName', key: 'deviceName', width: 160, ellipsis: true },
    {
      title: '功能码',
      dataIndex: 'functionCode',
      key: 'functionCode',
      width: 110,
      render: (v?: string) => v ? <Tag color="cyan">{v}</Tag> : '-',
    },
    {
      title: '地址',
      dataIndex: 'address',
      key: 'address',
      width: 150,
      render: (v: string) => <Text className="mono-text">{v}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'dataType',
      key: 'dataType',
      width: 130,
      render: (v: string, record: TagType) => combinedDataTypeLabel(v, record.byteOrder),
    },
    {
      title: '当前值',
      dataIndex: 'currentValue',
      key: 'currentValue',
      width: 150,
      render: (v: unknown, record: TagType) => (
        <Badge
          status={record.quality === 'good' ? 'success' : record.quality === 'bad' ? 'error' : 'default'}
          text={<Text strong className="value-text">{v !== undefined && v !== null ? String(v) : '-'}{record.unit ?? ''}</Text>}
        />
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (enabled: boolean, record: TagType) => (
        <Switch
          checked={enabled}
          onClick={(_, e) => e.stopPropagation()}
          onChange={async (v) => {
            try {
              await api.tags.patch(record.id, { enabled: v })
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
      width: 180,
      render: (_: unknown, record: TagType) => (
        <Space size={8}>
          {record.accessMode !== 'read' && (
            <Button
              type="link"
              className="action-link"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                setWriteTag(record)
                setWriteValue(record.currentValue === undefined || record.currentValue === null ? '' : String(record.currentValue))
              }}
            >
              写入
            </Button>
          )}
          <Button
            type="link"
            className="action-link"
            onClick={(e) => {
              e.stopPropagation()
              setEditingTag(record)
              setFormOpen(true)
            }}
          >
            编辑
          </Button>
          <Popconfirm title="确定删除该点位？" onConfirm={async () => {
            try {
              await api.tags.remove(record.id)
              message.success('已删除')
              await load()
            } catch (error) {
              message.error((error as Error).message)
            }
          }}>
            <Button type="link" danger className="action-link" onClick={(e) => e.stopPropagation()}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <PageContainer
        title={`点位列表  ${filteredTags.length}`}
        extra={
          <Space>
            <Button size="large" icon={<DownloadOutlined />} onClick={handleTemplate}>模板</Button>
            <Button size="large" icon={<DownloadOutlined />} onClick={handleExport}>导出</Button>
            <Button size="large" icon={<UploadOutlined />} loading={importing} onClick={() => fileRef.current?.click()}>导入</Button>
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={() => { setEditingTag(null); setFormOpen(true) }}
            >
              添加点位
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void handleImportFile(file)
              }}
            />
          </Space>
        }
      >
        <Toolbar>
          <Input
            placeholder="搜索点位或地址"
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 280 }}
            allowClear
            size="large"
          />
          <Select
            placeholder="全部设备"
            allowClear
            size="large"
            style={{ width: 200 }}
            value={filterDevice}
            onChange={setFilterDevice}
            options={devices.map((d) => ({ value: d.id, label: d.name }))}
          />
        </Toolbar>
        <TableWrapper>
          <Table
            dataSource={filteredTags}
            columns={columns}
            rowKey="id"
            pagination={false}
            onRow={(record) => ({
              onClick: () => { setEditingTag(record); setFormOpen(true) },
              style: { cursor: 'pointer' },
            })}
          />
        </TableWrapper>
      </PageContainer>

      <TagFormDrawer
        open={formOpen}
        tag={editingTag}
        devices={devices}
        onClose={() => { setFormOpen(false); setEditingTag(null) }}
        onSave={handleSave}
      />

      <Modal
        title={writeTag ? `写入点位：${writeTag.name}` : '写入点位'}
        open={!!writeTag}
        onCancel={() => setWriteTag(null)}
        onOk={() => void handleWrite()}
        confirmLoading={writing}
        okText="写入"
        cancelText="取消"
      >
        <Input
          value={writeValue}
          onChange={(e) => setWriteValue(e.target.value)}
          placeholder={writeTag?.dataType === 'bool' ? 'true / false' : '输入要下发的值'}
        />
      </Modal>
    </>
  )
}
