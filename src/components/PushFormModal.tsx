import { useMemo } from 'react'
import {
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Row,
  Col,
  Switch,
} from 'antd'
import type { PushChannel, PushType } from '../types/push'

interface Props {
  open: boolean
  channel: PushChannel | null
  defaultType?: PushType
  onCancel: () => void
  onSave: (channel: PushChannel) => void
}

export default function PushFormModal({ open, channel, defaultType, onCancel, onSave }: Props) {
  const [form] = Form.useForm()
  const pushType = Form.useWatch('type', form) as PushType | undefined
  const tagFilter = Form.useWatch('tagFilter', form)

  const title = useMemo(() => {
    if (channel) return '编辑推送'
    const map: Record<PushType, string> = {
      mqtt: '添加 MQTT 推送',
      tcp: '添加 TCP 推送',
      http: '添加 HTTP 推送',
      mysql: '添加 MySQL 入库',
    }
    return defaultType ? map[defaultType] : '添加推送'
  }, [channel, defaultType])

  const handleOk = async () => {
    const values = await form.validateFields()
    onSave({
      ...channel,
      ...values,
      tagGroups: typeof values.tagGroups === 'string'
        ? values.tagGroups.split(',').map((item: string) => item.trim()).filter(Boolean)
        : values.tagGroups,
      status: channel?.status ?? 'stopped',
    } as PushChannel)
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      width={720}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (visible) {
          form.setFieldsValue(
            channel
              ? {
                  ...channel,
                  tagGroups: channel.tagGroups?.join(', '),
                }
              : {
                  type: defaultType ?? 'mqtt',
                  enabled: true,
                  pushInterval: 1000,
                  tagFilter: 'all',
                  qos: 1,
                  format: 'json',
                  method: 'POST',
                  dbPort: 3306,
                  port: 1883,
                }
          )
        }
      }}
    >
      <Form form={form} layout="vertical" size="large" style={{ marginTop: 12 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="name" label="通道名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="例如：MES 数据上报" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="type" label="推送类型" rules={[{ required: true }]}>
              <Select
                disabled={!!channel}
                options={[
                  { value: 'mqtt', label: 'MQTT' },
                  { value: 'tcp', label: 'TCP' },
                  { value: 'http', label: 'HTTP' },
                  { value: 'mysql', label: 'MySQL' },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="pushInterval" label="推送间隔 (ms)">
              <InputNumber min={100} max={60000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="tagFilter" label="点位范围">
              <Select
                options={[
                  { value: 'all', label: '全部启用点位' },
                  { value: 'group', label: '按分组' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="description" label="描述">
              <Input placeholder="可选" />
            </Form.Item>
          </Col>
        </Row>

        {tagFilter === 'group' && (
          <Form.Item name="tagGroups" label="点位分组" extra="多个分组用逗号分隔">
            <Input placeholder="工艺参数, 状态" />
          </Form.Item>
        )}

        {pushType === 'mqtt' && (
          <>
            <Row gutter={16}>
              <Col span={10}>
                <Form.Item name="broker" label="服务器地址" rules={[{ required: true, message: '请输入地址' }]}>
                  <Input placeholder="192.168.1.200" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="port" label="端口">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="topic" label="主题" rules={[{ required: true, message: '请输入主题' }]}>
                  <Input placeholder="factory/line1/data" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="clientId" label="客户端 ID">
                  <Input placeholder="可选" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="username" label="用户名">
                  <Input placeholder="可选" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="password" label="密码">
                  <Input.Password placeholder="可选" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}

        {pushType === 'tcp' && (
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="host" label="目标地址" rules={[{ required: true, message: '请输入地址' }]}>
                <Input placeholder="192.168.1.50" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="tcpPort" label="端口" rules={[{ required: true, message: '请输入端口' }]}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        )}

        {pushType === 'http' && (
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="url" label="请求地址" rules={[{ required: true, message: '请输入地址' }]}>
                <Input placeholder="http://192.168.1.10:8088/telemetry" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="method" label="请求方法">
                <Select options={[{ value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }]} />
              </Form.Item>
            </Col>
          </Row>
        )}

        {pushType === 'mysql' && (
          <>
            <Row gutter={16}>
              <Col span={10}>
                <Form.Item name="dbHost" label="数据库地址" rules={[{ required: true, message: '请输入地址' }]}>
                  <Input placeholder="192.168.1.10" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="dbPort" label="端口">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="database" label="数据库名" rules={[{ required: true, message: '请输入数据库名' }]}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="dbUsername" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="dbPassword" label="密码">
                  <Input.Password />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="table" label="数据表" rules={[{ required: true, message: '请输入表名' }]}>
                  <Input placeholder="tag_values" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}
      </Form>
    </Modal>
  )
}
