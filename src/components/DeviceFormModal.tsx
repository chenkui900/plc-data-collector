import { useMemo, useState } from 'react'
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
import type { Device, ProtocolType } from '../types'
import { protocolConfigs } from '../data/protocolConfigs'

interface Props {
  open: boolean
  device: Device | null
  onCancel: () => void
  onSave: (device: Device) => void
}

export default function DeviceFormModal({ open, device, onCancel, onSave }: Props) {
  const [form] = Form.useForm()
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolType | undefined>(
    device?.protocol
  )

  const protocolConfig = useMemo(
    () => protocolConfigs.find((p) => p.type === selectedProtocol),
    [selectedProtocol]
  )

  const handleOk = async () => {
    const values = await form.validateFields()
    onSave({
      ...device,
      ...values,
      tagCount: device?.tagCount ?? 0,
      status: device?.status ?? 'unknown',
    } as Device)
  }

  return (
    <Modal
      title={device ? '编辑设备' : '添加设备'}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      width={640}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (visible) {
          form.setFieldsValue(
            device ?? {
              enabled: true,
              timeout: 3000,
              pollInterval: 1000,
              port: 502,
              slaveId: 1,
              rack: 0,
              slot: 1,
            }
          )
          setSelectedProtocol(device?.protocol)
        }
      }}
    >
      <Form form={form} layout="vertical" size="large" style={{ marginTop: 12 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="设备名称"
              rules={[{ required: true, message: '请输入设备名称' }]}
            >
              <Input placeholder="例如：1号线 PLC" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="protocol"
              label="通讯协议"
              rules={[{ required: true, message: '请选择通讯协议' }]}
            >
              <Select
                placeholder="选择协议"
                showSearch
                optionFilterProp="label"
                onChange={(v) => setSelectedProtocol(v)}
                options={protocolConfigs.map((p) => ({
                  value: p.type,
                  label: p.name,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {protocolConfig?.connectionFields.map((field) => (
            <Col span={12} key={field.key}>
              <Form.Item
                name={field.key}
                label={field.label}
                rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : []}
                initialValue={field.defaultValue}
              >
                {field.type === 'select' ? (
                  <Select options={field.options?.map((o) => ({ value: o.value, label: o.label }))} />
                ) : field.type === 'number' ? (
                  <InputNumber style={{ width: '100%' }} />
                ) : (
                  <Input />
                )}
              </Form.Item>
            </Col>
          ))}
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="pollInterval" label="轮询间隔 (ms)">
              <InputNumber min={100} max={60000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="timeout" label="超时时间 (ms)">
              <InputNumber min={200} max={60000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item name="description" label="描述">
              <Input placeholder="可选" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="enabled" label="启用采集" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}
